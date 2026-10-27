package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type chatRecorder struct {
	mu      sync.Mutex
	bodies  []map[string]any
	headers []http.Header
}

func (r *chatRecorder) wrap(next http.HandlerFunc) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		raw, _ := io.ReadAll(request.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		r.mu.Lock()
		r.bodies = append(r.bodies, body)
		r.headers = append(r.headers, request.Header.Clone())
		r.mu.Unlock()
		next(response, request)
	}
}

func (r *chatRecorder) body(index int) map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	if index >= len(r.bodies) {
		return nil
	}
	return r.bodies[index]
}

func (r *chatRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.bodies)
}

// streamText writes the raw SSE body in fixed byte slices so parsing must
// tolerate frame splits at any byte boundary, including inside a rune.
func streamText(text string, split int) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "text/event-stream")
		response.WriteHeader(http.StatusOK)
		flusher, _ := response.(http.Flusher)
		if flusher != nil {
			flusher.Flush()
		}
		step := split
		if step <= 0 {
			step = len(text)
		}
		for start := 0; start < len(text); start += step {
			end := start + step
			if end > len(text) {
				end = len(text)
			}
			if _, err := io.WriteString(response, text[start:end]); err != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
}

func newChatStreamServer(t *testing.T, handler http.HandlerFunc) (*chatRecorder, string) {
	t.Helper()
	recorder := &chatRecorder{}
	server := httptest.NewServer(recorder.wrap(handler))
	t.Cleanup(server.Close)
	return recorder, server.URL
}

func collectProgress() (func(Progress), func() []Progress) {
	events := make([]Progress, 0, 16)
	return func(event Progress) {
			events = append(events, event)
		}, func() []Progress {
			return events
		}
}

func sseJSON(payload any) string {
	data, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}
	return "data: " + string(data) + "\n\n"
}

func sseDelta(content string) string {
	return sseJSON(map[string]any{
		"choices": []any{map[string]any{"delta": map[string]any{"content": content}}},
	})
}

func sseFinish(reason string) string {
	return sseJSON(map[string]any{
		"choices": []any{map[string]any{"delta": map[string]any{}, "finish_reason": reason}},
	}) + "data: [DONE]\n\n"
}

func sseBody(content, finishReason string) string {
	return sseDelta(content) + sseFinish(finishReason)
}

func TestChatParsesStreamedSSEAcrossByteSplits(t *testing.T) {
	reasoning := sseJSON(map[string]any{
		"choices": []any{map[string]any{"delta": map[string]any{"reasoning_content": "SECRET_REASONING"}}},
	})
	usage := sseJSON(map[string]any{"choices": []any{}, "usage": map[string]any{"total_tokens": 12}})
	multiline := "data: {\"choices\":\n" +
		"data: [{\"delta\":{\"content\":\", world\"},\"finish_reason\":null}]}\n\n"
	body := ": provider comment\n\n" +
		reasoning +
		usage +
		sseDelta("你好") +
		multiline +
		sseFinish("stop")

	recorder, baseURL := newChatStreamServer(t, streamText(body, 7))
	progress, events := collectProgress()

	content, err := Chat(ChatRequest{
		Config:    Config{BaseURL: baseURL + "/v1", APIKey: "key", Model: "gpt-4o-mini"},
		Messages:  []Message{{Role: RoleUser, Content: "go"}},
		Context:   context.Background(),
		MaxTokens: 32_768,
		Stream:    true,
		Progress:  progress,
	})
	if err != nil {
		t.Fatalf("streamed chat: %v", err)
	}
	if content != "你好, world" {
		t.Fatalf("content = %q", content)
	}
	if strings.Contains(content, "SECRET_REASONING") {
		t.Fatal("reasoning text leaked into the body")
	}

	request := recorder.body(0)
	if request["stream"] != true {
		t.Fatalf("stream = %v", request["stream"])
	}
	if request["max_tokens"] != float64(32_768) {
		t.Fatalf("max_tokens = %v", request["max_tokens"])
	}
	if recorder.count() != 1 {
		t.Fatalf("calls = %d", recorder.count())
	}

	reported := events()
	if len(reported) == 0 {
		t.Fatal("no progress reported")
	}
	if reported[0].Phase != PhaseThinking || reported[0].ReceivedChars != 0 || reported[0].Final {
		t.Fatalf("first progress = %+v, want thinking with 0 chars", reported[0])
	}
	sawTwo := false
	sawNine := false
	for _, event := range reported {
		if event.Phase != PhaseGenerating {
			continue
		}
		if event.ReceivedChars == 2 {
			sawTwo = true
		}
		if event.ReceivedChars == 9 {
			sawNine = true
		}
	}
	if !sawTwo || !sawNine {
		t.Fatalf("generating progress = %+v, want 2 and 9 characters", reported)
	}
	final := reported[len(reported)-1]
	if !final.Final || final.Phase != PhaseGenerating || final.ReceivedChars != 9 {
		t.Fatalf("final progress = %+v", final)
	}
}

func TestChatIgnoresStreamFlagWhenProviderReturnsJSON(t *testing.T) {
	handler := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		constructJSONCompletion(response, "fallback body")
	})
	recorder, baseURL := newChatStreamServer(t, handler)
	progress, events := collectProgress()

	content, err := Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  context.Background(),
		Stream:   true,
		Progress: progress,
	})
	if err != nil {
		t.Fatalf("fallback chat: %v", err)
	}
	if content != "fallback body" {
		t.Fatalf("content = %q", content)
	}
	if recorder.body(0)["stream"] != true {
		t.Fatal("stream flag was not sent")
	}
	if recorder.count() != 1 {
		t.Fatalf("calls = %d, want exactly the one call", recorder.count())
	}

	reported := events()
	if len(reported) != 1 {
		t.Fatalf("progress = %+v, want one final event", reported)
	}
	if !reported[0].Final || reported[0].Phase != PhaseGenerating || reported[0].ReceivedChars != 13 {
		t.Fatalf("final progress = %+v", reported[0])
	}
}

func TestChatParsesEventStreamServedWithWrongContentType(t *testing.T) {
	handler := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(response, sseBody(`{"value":"ok"}`, "stop"))
	})
	_, baseURL := newChatStreamServer(t, handler)

	content, err := Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  context.Background(),
		Stream:   true,
	})
	if err != nil {
		t.Fatalf("mislabelled stream: %v", err)
	}
	if content != `{"value":"ok"}` {
		t.Fatalf("content = %q", content)
	}
}

func TestStreamedPartialContentAtLengthLimitIsABudgetErrorWithoutRepair(t *testing.T) {
	body := sseDelta(`{"value":"part`) + sseFinish("length")
	recorder, baseURL := newChatStreamServer(t, streamText(body, 11))
	progress, events := collectProgress()

	_, err := CallJSON[map[string]any](JSONRequest{
		Config:    Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages:  []Message{{Role: RoleUser, Content: "go"}},
		Schema:    validator(),
		Context:   context.Background(),
		MaxTokens: 32_768,
		Stream:    true,
		Progress:  progress,
	})

	var llmError *Error
	if !asError(err, &llmError) || llmError.Kind != KindBudget {
		t.Fatalf("error = %v, want a budget error", err)
	}
	if !strings.Contains(llmError.Message, "32768") || !strings.Contains(llmError.Message, "截断") {
		t.Fatalf("budget message = %q", llmError.Message)
	}
	if recorder.count() != 1 {
		t.Fatalf("calls = %d, want no repair call for a truncated body", recorder.count())
	}
	reported := events()
	if len(reported) == 0 || reported[len(reported)-1].ReceivedChars == 0 {
		t.Fatalf("progress = %+v, want partial characters before the error", reported)
	}
}

func TestStreamedTruncationBeforeBodyIsSanitized(t *testing.T) {
	body := sseFinish("length")
	recorder, baseURL := newChatStreamServer(t, streamText(body, 5))

	_, err := Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  context.Background(),
		Stream:   true,
	})
	var llmError *Error
	if !asError(err, &llmError) || llmError.Kind != KindUpstream {
		t.Fatalf("error = %v", err)
	}
	if !strings.Contains(llmError.Message, "耗尽了输出额度") {
		t.Fatalf("message = %q", llmError.Message)
	}
	if recorder.count() != 1 {
		t.Fatalf("calls = %d", recorder.count())
	}
}

func TestStreamedUpstreamErrorFrameIsSanitized(t *testing.T) {
	const secret = "sk-stream-secret"
	body := sseJSON(map[string]any{"error": map[string]any{"message": "broken " + secret}}) +
		"data: [DONE]\n\n"
	_, baseURL := newChatStreamServer(t, streamText(body, 9))

	_, err := Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: secret, Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  context.Background(),
		Stream:   true,
	})
	if err == nil {
		t.Fatal("stream error frame was accepted")
	}
	if strings.Contains(PublicMessage(err), secret) || strings.Contains(err.Error(), secret) {
		t.Fatalf("error leaked the upstream body: %q", err)
	}
	var llmError *Error
	if !asError(err, &llmError) || llmError.Kind != KindUpstream {
		t.Fatalf("error = %v", err)
	}
}

func TestStreamedReasoningOnlyIsReportedWithoutLeaking(t *testing.T) {
	reasoning := sseJSON(map[string]any{
		"choices": []any{map[string]any{"delta": map[string]any{"reasoning_content": "SECRET_REASONING"}}},
	})
	body := reasoning + sseFinish("stop")
	_, baseURL := newChatStreamServer(t, streamText(body, 6))

	_, err := Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  context.Background(),
		Stream:   true,
	})
	var llmError *Error
	if !asError(err, &llmError) || llmError.Kind != KindUpstream {
		t.Fatalf("error = %v", err)
	}
	if !strings.Contains(llmError.Message, "只返回了推理内容") {
		t.Fatalf("message = %q", llmError.Message)
	}
	if strings.Contains(llmError.Message, "SECRET_REASONING") {
		t.Fatal("reasoning text leaked into the public message")
	}
}

func TestStreamedIncompleteBodyIsNotTreatedAsFormatting(t *testing.T) {
	body := sseDelta(`{"value":"ok"}`)
	recorder, baseURL := newChatStreamServer(t, streamText(body, 4))

	_, err := CallJSON[map[string]any](JSONRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Schema:   validator(),
		Context:  context.Background(),
		Stream:   true,
	})
	var llmError *Error
	if !asError(err, &llmError) || llmError.Kind != KindUpstream {
		t.Fatalf("error = %v", err)
	}
	if !strings.Contains(llmError.Message, "中断") {
		t.Fatalf("message = %q", llmError.Message)
	}
	if recorder.count() != 1 {
		t.Fatalf("calls = %d, want no repair for a truncated stream", recorder.count())
	}
}

func TestStreamedCompletionHonoursTimeoutAndAbort(t *testing.T) {
	hang := func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "text/event-stream")
		response.WriteHeader(http.StatusOK)
		flusher, _ := response.(http.Flusher)
		if flusher != nil {
			flusher.Flush()
		}
		_, _ = io.WriteString(response, sseDelta(`{"value":`))
		if flusher != nil {
			flusher.Flush()
		}
		<-request.Context().Done()
	}
	recorder, baseURL := newChatStreamServer(t, hang)

	_, err := Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  context.Background(),
		Timeout:  30 * time.Millisecond,
		Stream:   true,
	})
	var llmError *Error
	if !asError(err, &llmError) || llmError.Kind != KindTimeout {
		t.Fatalf("timeout error = %v", err)
	}
	if StatusFor(err) != http.StatusGatewayTimeout {
		t.Fatalf("timeout status = %d", StatusFor(err))
	}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(30 * time.Millisecond)
		cancel()
	}()
	_, err = Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  ctx,
		Timeout:  5 * time.Second,
		Stream:   true,
	})
	if !asError(err, &llmError) || llmError.Kind != KindAborted || !IsAborted(err) {
		t.Fatalf("abort error = %v", err)
	}
	if recorder.count() != 2 {
		t.Fatalf("calls = %d, want one call per attempt without retries", recorder.count())
	}

	canceled, cancelImmediately := context.WithCancel(context.Background())
	cancelImmediately()
	_, err = Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  canceled,
		Stream:   true,
	})
	if !IsAborted(err) {
		t.Fatalf("pre-canceled stream = %v", err)
	}
}

func TestCallJSONRepairStreamsWithRepairingPhaseAndSameCap(t *testing.T) {
	recorder := &chatRecorder{}
	responses := []string{
		sseBody("not json", "stop"),
		sseBody(`{"value":"repaired"}`, "stop"),
	}
	index := 0
	server := httptest.NewServer(recorder.wrap(func(response http.ResponseWriter, request *http.Request) {
		body := responses[len(responses)-1]
		if index < len(responses) {
			body = responses[index]
		}
		index++
		response.Header().Set("Content-Type", "text/event-stream")
		response.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(response, body)
	}))
	t.Cleanup(server.Close)

	progress, events := collectProgress()
	result, err := CallJSON[map[string]any](JSONRequest{
		Config:    Config{BaseURL: server.URL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages:  []Message{{Role: RoleUser, Content: "go"}},
		Schema:    validator(),
		Context:   context.Background(),
		MaxTokens: 32_768,
		Stream:    true,
		Progress:  progress,
	})
	if err != nil {
		t.Fatalf("CallJSON: %v", err)
	}
	if result["value"] != "repaired" {
		t.Fatalf("result = %+v", result)
	}
	if recorder.count() != 2 {
		t.Fatalf("calls = %d, want one repair", recorder.count())
	}
	for index := 0; index < 2; index++ {
		body := recorder.body(index)
		if body["stream"] != true {
			t.Fatalf("call %d did not stream: %v", index, body["stream"])
		}
		if body["max_tokens"] != float64(32_768) {
			t.Fatalf("call %d max_tokens = %v", index, body["max_tokens"])
		}
	}

	reported := events()
	sawGenerating := false
	sawRepairing := false
	for _, event := range reported {
		switch event.Phase {
		case PhaseGenerating:
			sawGenerating = true
		case PhaseRepairing:
			sawRepairing = true
		}
	}
	if !sawGenerating || !sawRepairing {
		t.Fatalf("progress phases = %+v, want generating and repairing", reported)
	}
	final := reported[len(reported)-1]
	if final.Phase != PhaseRepairing || !final.Final || final.ReceivedChars != len(`{"value":"repaired"}`) {
		t.Fatalf("final progress = %+v", final)
	}
}

func TestCallJSONRepairTruncationDoesNotStartAnotherRepair(t *testing.T) {
	recorder := &chatRecorder{}
	responses := []string{
		sseBody("not json", "stop"),
		sseDelta(`{"value":"part`) + sseFinish("length"),
	}
	index := 0
	server := httptest.NewServer(recorder.wrap(func(response http.ResponseWriter, request *http.Request) {
		body := responses[len(responses)-1]
		if index < len(responses) {
			body = responses[index]
		}
		index++
		response.Header().Set("Content-Type", "text/event-stream")
		response.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(response, body)
	}))
	t.Cleanup(server.Close)

	_, err := CallJSON[map[string]any](JSONRequest{
		Config:    Config{BaseURL: server.URL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages:  []Message{{Role: RoleUser, Content: "go"}},
		Schema:    validator(),
		Context:   context.Background(),
		MaxTokens: 32_768,
		Stream:    true,
	})
	var llmError *Error
	if !asError(err, &llmError) || llmError.Kind != KindBudget {
		t.Fatalf("error = %v, want budget", err)
	}
	if recorder.count() != 2 {
		t.Fatalf("calls = %d, want the initial call and exactly one repair", recorder.count())
	}
}

func TestReasoningModelStreamsWithMaxCompletionTokens(t *testing.T) {
	recorder, baseURL := newChatStreamServer(t, streamText(sseBody(`{"value":"ok"}`, "stop"), 8))

	_, err := Chat(ChatRequest{
		Config:    Config{BaseURL: baseURL, APIKey: "key", Model: "openai/gpt-5.1"},
		Messages:  []Message{{Role: RoleUser, Content: "go"}},
		Context:   context.Background(),
		MaxTokens: 32_768,
		Stream:    true,
	})
	if err != nil {
		t.Fatalf("reasoning stream: %v", err)
	}
	body := recorder.body(0)
	if body["stream"] != true {
		t.Fatal("reasoning stream flag was not sent")
	}
	if body["max_completion_tokens"] != float64(32_768) {
		t.Fatalf("max_completion_tokens = %v", body["max_completion_tokens"])
	}
	if _, ok := body["max_tokens"]; ok {
		t.Fatal("reasoning model received legacy max_tokens")
	}
	if _, ok := body["temperature"]; ok {
		t.Fatal("reasoning model received temperature")
	}
}

func TestChatIgnoresStreamFlagWhenProviderReturnsTruncatedJSON(t *testing.T) {
	handler := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(response, `{"choices":[{"finish_reason":"length","message":{"content":"{\"value\":\"part"}}]}`)
	})
	recorder, baseURL := newChatStreamServer(t, handler)

	_, err := CallJSON[map[string]any](JSONRequest{
		Config:    Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages:  []Message{{Role: RoleUser, Content: "go"}},
		Schema:    validator(),
		Context:   context.Background(),
		MaxTokens: 32_768,
		Stream:    true,
	})
	var llmError *Error
	if !asError(err, &llmError) || llmError.Kind != KindBudget {
		t.Fatalf("error = %v, want a budget error for the truncated JSON fallback", err)
	}
	if recorder.count() != 1 {
		t.Fatalf("calls = %d, want no repair call", recorder.count())
	}
}

func TestNonStreamingRequestsAreUnchanged(t *testing.T) {
	handler := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		constructJSONCompletion(response, `{"value":"ok"}`)
	})
	recorder, baseURL := newChatStreamServer(t, handler)
	progress, events := collectProgress()

	content, err := Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  context.Background(),
		Progress: progress,
	})
	if err != nil || content != `{"value":"ok"}` {
		t.Fatalf("content = %q, err = %v", content, err)
	}
	if recorder.body(0)["stream"] != false {
		t.Fatalf("non-streaming request sent stream = %v", recorder.body(0)["stream"])
	}
	if reported := events(); len(reported) != 0 {
		t.Fatalf("non-streaming call reported progress: %+v", reported)
	}
}

func constructJSONCompletion(response http.ResponseWriter, content string) {
	payload, _ := json.Marshal(map[string]any{
		"choices": []any{map[string]any{"message": map[string]any{"content": content}, "finish_reason": "stop"}},
	})
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(payload)
}
