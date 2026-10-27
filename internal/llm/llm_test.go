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

type recordedRequest struct {
	path    string
	headers http.Header
	body    map[string]any
	rawBody string
}

type providerResponse struct {
	status int
	body   string
	hang   bool
}

type provider struct {
	t         *testing.T
	mu        sync.Mutex
	requests  []recordedRequest
	responses []providerResponse
}

func newProvider(t *testing.T, responses ...providerResponse) (*provider, string) {
	t.Helper()
	instance := &provider{t: t, responses: responses}
	server := httptest.NewServer(instance)
	t.Cleanup(server.Close)
	return instance, server.URL
}

func (p *provider) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	raw, _ := io.ReadAll(request.Body)
	recorded := recordedRequest{path: request.URL.Path, headers: request.Header.Clone(), rawBody: string(raw)}
	_ = json.Unmarshal(raw, &recorded.body)

	p.mu.Lock()
	p.requests = append(p.requests, recorded)
	var next providerResponse
	if len(p.responses) > 0 {
		next = p.responses[0]
		p.responses = p.responses[1:]
	}
	p.mu.Unlock()

	if next.hang {
		<-request.Context().Done()
		return
	}
	if next.status == 0 {
		next.status = http.StatusOK
	}
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(next.status)
	_, _ = io.WriteString(response, next.body)
}

func (p *provider) record(index int) recordedRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	if index >= len(p.requests) {
		p.t.Fatalf("request %d missing; have %d", index, len(p.requests))
	}
	return p.requests[index]
}

func (p *provider) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.requests)
}

func success(content string) providerResponse {
	payload, _ := json.Marshal(map[string]any{
		"choices": []any{map[string]any{"message": map[string]any{"content": content}}},
	})
	return providerResponse{body: string(payload)}
}

func messagesOf(request recordedRequest) []Message {
	raw, _ := request.body["messages"].([]any)
	messages := make([]Message, 0, len(raw))
	for _, item := range raw {
		record, _ := item.(map[string]any)
		role, _ := record["role"].(string)
		content, _ := record["content"].(string)
		messages = append(messages, Message{Role: Role(role), Content: content})
	}
	return messages
}

type mapValidator struct {
	document any
	required []string
}

func (v mapValidator) Document() any { return v.document }
func (v mapValidator) Validate(value any) []string {
	object, ok := value.(map[string]any)
	if !ok {
		return []string{"(root): expected object"}
	}
	issues := make([]string, 0, len(v.required))
	for _, key := range v.required {
		if _, ok := object[key]; !ok {
			issues = append(issues, key+": required")
		}
	}
	return issues
}

func validator() mapValidator {
	return mapValidator{
		document: map[string]any{
			"type":       "object",
			"properties": map[string]any{"value": map[string]any{"type": "string"}},
			"required":   []string{"value"},
		},
		required: []string{"value"},
	}
}

func TestCompletionURL(t *testing.T) {
	cases := map[string]string{
		"https://api.example.com/v1":                    "https://api.example.com/v1/chat/completions",
		"https://api.example.com/v1/":                   "https://api.example.com/v1/chat/completions",
		"https://api.example.com/v1///":                 "https://api.example.com/v1/chat/completions",
		"https://api.deepseek.com/v1/chat/completions":  "https://api.deepseek.com/v1/chat/completions",
		"https://api.deepseek.com/v1/chat/COMPLETIONS/": "https://api.deepseek.com/v1/chat/COMPLETIONS",
		" http://127.0.0.1:11434/v1/ ":                  "http://127.0.0.1:11434/v1/chat/completions",
	}
	for baseURL, expected := range cases {
		if actual := completionURL(baseURL); actual != expected {
			t.Fatalf("completionURL(%q) = %q, want %q", baseURL, actual, expected)
		}
	}
}

func TestReasoningModelDetection(t *testing.T) {
	cases := map[string]bool{
		"gpt-4o-mini":        false,
		"gpt-5-mini":         true,
		"gpt-5.1":            true,
		"gpt-6.1-terra":      true,
		"openai/gpt-5.1":     true,
		"o1":                 true,
		"o3-mini":            true,
		"o10":                false,
		"deepseek-reasoner":  false,
		"anthropic/o4-mini":  true,
		"  openai/o4-mini  ": true,
	}
	for model, expected := range cases {
		if actual := isReasoningModel(model); actual != expected {
			t.Fatalf("isReasoningModel(%q) = %v, want %v", model, actual, expected)
		}
	}
}

func TestChatSendsReasoningAndLegacyTokenFields(t *testing.T) {
	instance, baseURL := newProvider(t, success("OK"), success("OK"), success("OK"))

	if _, err := Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL + "/v1", APIKey: "key", Model: "openai/gpt-5.1"},
		Messages: []Message{{Role: RoleUser, Content: "ping"}},
		Context:  context.Background(), MaxTokens: 1_024,
	}); err != nil {
		t.Fatalf("reasoning chat: %v", err)
	}
	reasoning := instance.record(0)
	if reasoning.path != "/v1/chat/completions" {
		t.Fatalf("path = %q", reasoning.path)
	}
	if reasoning.headers.Get("Authorization") != "Bearer key" {
		t.Fatalf("authorization = %q", reasoning.headers.Get("Authorization"))
	}
	if _, ok := reasoning.body["temperature"]; ok {
		t.Fatal("reasoning model received temperature")
	}
	if _, ok := reasoning.body["max_tokens"]; ok {
		t.Fatal("reasoning model received legacy max_tokens")
	}
	if reasoning.body["max_completion_tokens"] != float64(1_024) {
		t.Fatalf("max_completion_tokens = %v", reasoning.body["max_completion_tokens"])
	}

	if _, err := Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "ping"}},
		Context:  context.Background(), MaxTokens: 1_024,
	}); err != nil {
		t.Fatalf("legacy chat: %v", err)
	}
	legacy := instance.record(1)
	if legacy.body["temperature"] != 0.4 {
		t.Fatalf("temperature = %v", legacy.body["temperature"])
	}
	if legacy.body["max_tokens"] != float64(1_024) {
		t.Fatalf("max_tokens = %v", legacy.body["max_tokens"])
	}
	if _, ok := legacy.body["max_completion_tokens"]; ok {
		t.Fatal("legacy model received max_completion_tokens")
	}

	if _, err := Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "ping"}},
		Context:  context.Background(), Temperature: Temperature(0),
	}); err != nil {
		t.Fatalf("zero temperature chat: %v", err)
	}
	zero := instance.record(2)
	if zero.body["temperature"] != float64(0) {
		t.Fatalf("explicit zero temperature = %v", zero.body["temperature"])
	}
	if _, ok := zero.body["max_tokens"]; ok {
		t.Fatal("omitted max tokens was sent")
	}
	if instance.count() != 3 {
		t.Fatalf("requests = %d", instance.count())
	}
}

func TestChatExtractsContentShapes(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		content string
		kind    ErrorKind
		message string
	}{
		{
			name:    "content parts",
			body:    `{"choices":[{"message":{"content":[{"type":"text","text":"A"},"B"]}}]}`,
			content: "AB",
		},
		{
			name:    "legacy text fallback",
			body:    `{"choices":[{"message":{"content":""},"text":"fallback"}]}`,
			content: "fallback",
		},
		{
			name:    "length budget exhausted",
			body:    `{"choices":[{"finish_reason":"length","message":{"content":null,"reasoning_content":"hidden"}}]}`,
			kind:    KindUpstream,
			message: "耗尽了输出额度",
		},
		{
			name:    "reasoning only",
			body:    `{"choices":[{"finish_reason":"stop","message":{"content":"","reasoning_content":"hidden"}}]}`,
			kind:    KindUpstream,
			message: "只返回了推理内容",
		},
		{
			name:    "empty",
			body:    `{"choices":[]}`,
			kind:    KindUpstream,
			message: "没有返回有效内容",
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, baseURL := newProvider(t, providerResponse{body: test.body})
			content, err := Chat(ChatRequest{
				Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
				Messages: []Message{{Role: RoleUser, Content: "go"}},
				Context:  context.Background(),
			})
			if test.kind == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if content != test.content {
					t.Fatalf("content = %q, want %q", content, test.content)
				}
				return
			}
			var llmError *Error
			if err == nil || !asError(err, &llmError) {
				t.Fatalf("error = %v", err)
			}
			if llmError.Kind != test.kind || !strings.Contains(llmError.Message, test.message) {
				t.Fatalf("error = %+v, want %s containing %q", llmError, test.kind, test.message)
			}
			if strings.Contains(llmError.Message, "hidden") {
				t.Fatal("reasoning content leaked into public message")
			}
		})
	}
}

func asError(err error, target **Error) bool {
	llmError, ok := err.(*Error)
	if ok {
		*target = llmError
	}
	return ok
}

func TestChatSanitizesHTTPFailures(t *testing.T) {
	const secret = "sk-secret-value"
	cases := []struct {
		status  int
		kind    ErrorKind
		message string
	}{
		{http.StatusUnauthorized, KindAuth, "API Key 无效"},
		{http.StatusForbidden, KindAuth, "API Key 无效"},
		{http.StatusTooManyRequests, KindRateLimit, "请求过于频繁"},
		{http.StatusNotFound, KindUpstream, "模型或接口地址不存在"},
		{http.StatusInternalServerError, KindUpstream, "模型服务暂时不可用"},
		{http.StatusBadRequest, KindUpstream, "拒绝了请求"},
	}
	for _, test := range cases {
		_, baseURL := newProvider(t, providerResponse{status: test.status, body: `{"error":"` + secret + `"}`})
		_, err := Chat(ChatRequest{
			Config:   Config{BaseURL: baseURL, APIKey: secret, Model: "gpt-4o-mini"},
			Messages: []Message{{Role: RoleUser, Content: "go"}},
			Context:  context.Background(),
		})
		if err == nil {
			t.Fatalf("status %d accepted", test.status)
		}
		if PublicMessage(err) == "" || !strings.Contains(PublicMessage(err), test.message) {
			t.Fatalf("status %d message = %q", test.status, PublicMessage(err))
		}
		if strings.Contains(PublicMessage(err), secret) || strings.Contains(PublicMessage(err), "sk-secret") {
			t.Fatalf("status %d leaked credentials: %q", test.status, PublicMessage(err))
		}
		var llmError *Error
		if !asError(err, &llmError) || llmError.Kind != test.kind {
			t.Fatalf("status %d kind = %v", test.status, err)
		}
	}
}

func TestChatDistinguishesTimeoutAndAbort(t *testing.T) {
	_, baseURL := newProvider(t, providerResponse{hang: true}, providerResponse{hang: true}, providerResponse{hang: true})

	started := time.Now()
	_, err := Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  context.Background(),
		Timeout:  30 * time.Millisecond,
	})
	var llmError *Error
	if !asError(err, &llmError) || llmError.Kind != KindTimeout {
		t.Fatalf("timeout error = %v", err)
	}
	if time.Since(started) > 2*time.Second {
		t.Fatal("timeout was not bounded")
	}
	if StatusFor(err) != http.StatusGatewayTimeout {
		t.Fatalf("timeout status = %d", StatusFor(err))
	}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()
	_, err = Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  ctx,
		Timeout:  5 * time.Second,
	})
	if !asError(err, &llmError) || llmError.Kind != KindAborted {
		t.Fatalf("abort error = %v", err)
	}
	if !IsAborted(err) || StatusFor(err) != 499 {
		t.Fatalf("abort classification: %v", err)
	}

	alreadyCanceled, cancelImmediately := context.WithCancel(context.Background())
	cancelImmediately()
	_, err = Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  alreadyCanceled,
	})
	if !IsAborted(err) {
		t.Fatalf("pre-canceled context = %v", err)
	}

	deadline, cancelDeadline := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancelDeadline()
	_, err = Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  deadline,
		Timeout:  5 * time.Second,
	})
	if !asError(err, &llmError) || llmError.Kind != KindTimeout {
		t.Fatalf("caller deadline = %v, want timeout", err)
	}
	if IsAborted(err) {
		t.Fatal("caller deadline was misclassified as an abort")
	}

	expired, cancelExpired := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancelExpired()
	_, err = Chat(ChatRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "go"}},
		Context:  expired,
	})
	if !asError(err, &llmError) || llmError.Kind != KindTimeout {
		t.Fatalf("expired deadline = %v, want timeout", err)
	}
}

func TestStripOuterFence(t *testing.T) {
	cases := map[string]string{
		"```json\n{\"a\":1}\n```":                    `{"a":1}`,
		"```\n{\"a\":1}\n```":                        `{"a":1}`,
		"  ```JSON \r\n{\"a\":1}\r\n```  ":           `{"a":1}`,
		"{\"a\":1}":                                  `{"a":1}`,
		"Here is the JSON:\n```json\n{\"a\":1}\n```": "Here is the JSON:\n```json\n{\"a\":1}\n```",
	}
	for raw, expected := range cases {
		if actual := stripOuterFence(raw); actual != expected {
			t.Fatalf("stripOuterFence(%q) = %q, want %q", raw, actual, expected)
		}
	}
}

func TestCallJSONRepairsMalformedOutputOnce(t *testing.T) {
	instance, baseURL := newProvider(t,
		success(`Sure! Here is the JSON you asked for: {"value":"first"}`),
		success(`{"value":"repaired"}`),
	)

	result, err := CallJSON[map[string]any](JSONRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleSystem, Content: "system"}, {Role: RoleUser, Content: "user"}},
		Schema:   validator(),
		Context:  context.Background(),
	})
	if err != nil {
		t.Fatalf("CallJSON: %v", err)
	}
	if result["value"] != "repaired" {
		t.Fatalf("result = %+v", result)
	}
	if instance.count() != 2 {
		t.Fatalf("calls = %d", instance.count())
	}

	first := messagesOf(instance.record(0))
	if len(first) != 2 {
		t.Fatalf("first messages = %d", len(first))
	}
	if !strings.Contains(first[0].Content, "JSON Schema:") {
		t.Fatal("schema instruction missing from system message")
	}

	repairMessages := messagesOf(instance.record(1))
	joined := ""
	for _, message := range repairMessages {
		joined += message.Content + "\n"
	}
	if !strings.Contains(joined, "不是合法的 JSON 对象") {
		t.Fatalf("repair prompt missing reason: %s", joined)
	}
	if !strings.Contains(joined, "Sure! Here is the JSON") {
		t.Fatal("repair prompt missing assistant output")
	}
	repair := instance.record(1)
	if repair.body["temperature"] != float64(0) {
		t.Fatalf("repair temperature = %v", repair.body["temperature"])
	}
	if repair.body["max_tokens"] != float64(DefaultMaxTokens) {
		t.Fatalf("repair max_tokens = %v", repair.body["max_tokens"])
	}
}

func TestCallJSONRepairsSchemaViolationOnce(t *testing.T) {
	instance, baseURL := newProvider(t,
		success(`{"other":"value"}`),
		success(`{"value":"ok"}`),
	)
	result, err := CallJSON[map[string]any](JSONRequest{
		Config:   Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "user"}},
		Schema:   validator(),
		Context:  context.Background(),
	})
	if err != nil {
		t.Fatalf("CallJSON: %v", err)
	}
	if result["value"] != "ok" || instance.count() != 2 {
		t.Fatalf("result = %+v, calls = %d", result, instance.count())
	}
	first := messagesOf(instance.record(0))
	if first[0].Role != RoleSystem || !strings.Contains(first[0].Content, "JSON Schema:") {
		t.Fatal("schema instruction was not prepended")
	}
	repairMessages := messagesOf(instance.record(1))
	if !strings.Contains(repairMessages[len(repairMessages)-1].Content, "结构校验失败") ||
		!strings.Contains(repairMessages[len(repairMessages)-1].Content, "value") {
		t.Fatalf("repair prompt = %q", repairMessages[len(repairMessages)-1].Content)
	}
}

func TestCallJSONStaysSanitizedAfterFailedRepair(t *testing.T) {
	const secret = "sk-repair-secret"
	instance, baseURL := newProvider(t,
		success("not json at all"),
		success("still not json "+secret),
	)
	_, err := CallJSON[map[string]any](JSONRequest{
		Config:   Config{BaseURL: baseURL, APIKey: secret, Model: "gpt-4o-mini"},
		Messages: []Message{{Role: RoleUser, Content: "user"}},
		Schema:   validator(),
		Context:  context.Background(),
	})
	if instance.count() != 2 {
		t.Fatalf("calls = %d", instance.count())
	}
	if err == nil || PublicMessage(err) != "模型返回的内容格式不正确，请重试。" {
		t.Fatalf("error = %v", err)
	}
	if strings.Contains(PublicMessage(err), secret) {
		t.Fatal("secret leaked")
	}
	if StatusFor(err) != http.StatusBadGateway {
		t.Fatalf("status = %d", StatusFor(err))
	}
}

func TestDecodeJSONAcceptsIntegralFloats(t *testing.T) {
	type scored struct {
		Score int `json:"score"`
	}
	decoded, err := decodeJSON[scored](map[string]any{"score": float64(8)})
	if err != nil {
		t.Fatalf("decode integral float: %v", err)
	}
	if decoded.Score != 8 {
		t.Fatalf("score = %d", decoded.Score)
	}
}

func TestPingUsesReasoningSafeBudget(t *testing.T) {
	instance, baseURL := newProvider(t, success("OK"))
	if err := Ping(context.Background(), Config{BaseURL: baseURL, APIKey: "key", Model: "gpt-5-mini"}, 0); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	request := instance.record(0)
	messages := messagesOf(request)
	if len(messages) != 2 {
		t.Fatalf("messages = %d", len(messages))
	}
	if request.body["max_completion_tokens"] != float64(1_024) {
		t.Fatalf("max_completion_tokens = %v", request.body["max_completion_tokens"])
	}
	if _, ok := request.body["temperature"]; ok {
		t.Fatal("reasoning probe sent temperature")
	}
}

func TestPublicErrorMapping(t *testing.T) {
	if PublicMessage(NewError(KindNetwork)) != "无法连接模型服务，请检查接口地址与网络。" {
		t.Fatal("network message changed")
	}
	if PublicMessage(NewError(KindAborted)) != "请求已取消。" {
		t.Fatal("abort message changed")
	}
	if PublicMessage(context.Canceled) != "模型调用失败，请稍后重试。" {
		t.Fatal("unknown error message changed")
	}
	if StatusFor(NewError(KindRateLimit)) != http.StatusTooManyRequests {
		t.Fatal("rate-limit status changed")
	}
	if StatusFor(context.Canceled) != http.StatusBadGateway {
		t.Fatal("unknown error status changed")
	}
}
