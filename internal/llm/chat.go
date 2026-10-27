package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Role is one chat message role.
type Role string

const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

// Message is one chat completion message.
type Message struct {
	Role    Role   `json:"role"`
	Content string `json:"content"`
}

// Config is the provider configuration shared by the model-backed endpoints.
type Config struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
}

const (
	// DefaultTimeout bounds one model call when no explicit budget is given.
	DefaultTimeout = 120 * time.Second
	// DefaultMaxTokens bounds one JSON generation call.
	DefaultMaxTokens = 8_000
	// DefaultPingTimeout bounds the connection probe.
	DefaultPingTimeout = 30 * time.Second
)

// Temperature returns a pointer usable in a ChatRequest.
func Temperature(value float64) *float64 { return &value }

// Phase is the generation phase reported by streamed progress.
type Phase string

const (
	// PhaseThinking means the provider is still producing hidden reasoning or
	// has not produced visible body text yet.
	PhaseThinking Phase = "thinking"
	// PhaseGenerating means visible body text is being streamed.
	PhaseGenerating Phase = "generating"
	// PhaseRepairing means visible body text of the single repair round-trip
	// is being streamed.
	PhaseRepairing Phase = "repairing"
)

// Progress reports incremental generation progress. ReceivedChars counts
// Unicode characters of visible body text only; reasoning, prompts and the
// raw provider body are never carried.
type Progress struct {
	Phase Phase
	// ReceivedChars is the number of visible body characters received so far.
	ReceivedChars int
	// Final marks the last progress report of one completion call.
	Final bool
}

// ChatRequest is one completion request.
type ChatRequest struct {
	Config      Config
	Messages    []Message
	Context     context.Context
	Timeout     time.Duration
	Temperature *float64
	MaxTokens   int
	// Stream asks the provider for a streamed SSE completion. Providers that
	// ignore the flag and answer with one JSON document are still supported.
	Stream bool
	// Progress is optional. It is invoked for streamed responses and, when a
	// provider ignored Stream, once with the final body character count.
	Progress func(Progress)
}

// httpClient has no client-level timeout: every call carries a context
// deadline, and tests inject upstreams with httptest servers.
var httpClient = &http.Client{}

type chatBody struct {
	Model               string    `json:"model"`
	Messages            []Message `json:"messages"`
	Stream              bool      `json:"stream"`
	Temperature         *float64  `json:"temperature,omitempty"`
	MaxTokens           *int      `json:"max_tokens,omitempty"`
	MaxCompletionTokens *int      `json:"max_completion_tokens,omitempty"`
}

var reasoningModel = regexp.MustCompile(`(?i)^(o[1-9](\b|-)|gpt-5|gpt-6)`)

func completionURL(baseURL string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(strings.ToLower(trimmed), "/chat/completions") {
		return trimmed
	}
	return trimmed + "/chat/completions"
}

// Reasoning models reject sampling parameters and the legacy max_tokens field.
// Configs may prefix the model with a provider path (e.g. "openai/gpt-5.1").
func isReasoningModel(model string) bool {
	name := strings.TrimSpace(model)
	if index := strings.LastIndex(name, "/"); index >= 0 {
		name = name[index+1:]
	}
	return reasoningModel.MatchString(name)
}

func statusError(status int) *Error {
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return NewStatusError(KindAuth, "", status)
	case status == http.StatusTooManyRequests:
		return NewStatusError(KindRateLimit, "", status)
	case status == http.StatusNotFound:
		return NewStatusError(KindUpstream, "模型或接口地址不存在，请检查接口配置。", status)
	case status >= 500:
		return NewStatusError(KindUpstream, "", status)
	default:
		return NewStatusError(KindUpstream, "模型服务拒绝了请求，请检查模型名称与参数。", status)
	}
}

// parentContextError classifies the caller's context. A deadline is a timeout,
// including deadlines imposed by the API's per-dimension budget; only an
// explicit cancellation is a caller abort.
func parentContextError(parent context.Context) *Error {
	if parent == nil {
		return nil
	}
	if errors.Is(parent.Err(), context.DeadlineExceeded) {
		return NewError(KindTimeout)
	}
	if parent.Err() != nil {
		return NewError(KindAborted)
	}
	return nil
}

// cancellation maps a context cancellation to the documented error without
// confusing a caller abort with a timeout.
func cancellation(parent, bounded context.Context) *Error {
	if canceled := parentContextError(parent); canceled != nil {
		return canceled
	}
	if errors.Is(bounded.Err(), context.DeadlineExceeded) {
		return NewError(KindTimeout)
	}
	return nil
}

// Chat performs one OpenAI-compatible chat completion and returns the text
// content. It never forwards an upstream error body or hidden reasoning text.
func Chat(request ChatRequest) (string, error) {
	parent := request.Context
	if parent == nil {
		parent = context.Background()
	}
	if err := parentContextError(parent); err != nil {
		return "", err
	}

	timeout := request.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	bounded, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	body := chatBody{
		Model:    request.Config.Model,
		Messages: request.Messages,
		Stream:   request.Stream,
	}
	if !isReasoningModel(request.Config.Model) {
		temperature := 0.4
		if request.Temperature != nil {
			temperature = *request.Temperature
		}
		body.Temperature = &temperature
		if request.MaxTokens > 0 {
			body.MaxTokens = &request.MaxTokens
		}
	} else if request.MaxTokens > 0 {
		body.MaxCompletionTokens = &request.MaxTokens
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return "", NewStatusError(KindUpstream, "", 0)
	}

	httpRequest, err := http.NewRequestWithContext(bounded, http.MethodPost, completionURL(request.Config.BaseURL), bytes.NewReader(payload))
	if err != nil {
		return "", NewError(KindNetwork)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer "+request.Config.APIKey)

	response, err := httpClient.Do(httpRequest)
	if err != nil {
		if canceled := cancellation(parent, bounded); canceled != nil {
			return "", canceled
		}
		return "", NewError(KindNetwork)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// Never read or forward the upstream body: it may echo credentials.
		return "", statusError(response.StatusCode)
	}

	if request.Stream && isEventStream(response.Header.Get("Content-Type")) {
		return readStream(parent, bounded, response.Body, request)
	}

	return readCompletion(parent, bounded, response.Body, request)
}

// readCompletion handles the ordinary single-document response. When streaming
// was requested and the provider labeled an event stream with the wrong content
// type, the buffered body is parsed as SSE instead.
func readCompletion(parent, bounded context.Context, body io.Reader, request ChatRequest) (string, error) {
	raw, err := io.ReadAll(body)
	if err != nil {
		if canceled := cancellation(parent, bounded); canceled != nil {
			return "", canceled
		}
		return "", NewStatusError(KindUpstream, "模型服务返回了无法解析的响应，请稍后重试。", 0)
	}

	var completion completionResponse
	if err := json.Unmarshal(raw, &completion); err != nil {
		if request.Stream {
			return readStream(parent, bounded, bytes.NewReader(raw), request)
		}
		if canceled := cancellation(parent, bounded); canceled != nil {
			return "", canceled
		}
		return "", NewStatusError(KindUpstream, "模型服务返回了无法解析的响应，请稍后重试。", 0)
	}

	content, err := extractContent(completion, request.MaxTokens)
	if err != nil {
		return "", err
	}
	if request.Stream {
		notify(request.Progress, Progress{
			Phase:         PhaseGenerating,
			ReceivedChars: utf8.RuneCountInString(content),
			Final:         true,
		})
	}
	return content, nil
}

// errStreamDone ends the SSE scan without being an error.
var errStreamDone = errors.New("llm: stream done")

type streamChunk struct {
	Choices []streamChoice  `json:"choices"`
	Error   json.RawMessage `json:"error"`
}

type streamChoice struct {
	Delta        *streamDelta       `json:"delta"`
	Message      *completionMessage `json:"message"`
	Text         *string            `json:"text"`
	FinishReason string             `json:"finish_reason"`
}

type streamDelta struct {
	Content          json.RawMessage `json:"content"`
	ReasoningContent json.RawMessage `json:"reasoning_content"`
	Reasoning        json.RawMessage `json:"reasoning"`
}

// readStream consumes an SSE completion, reporting visible body progress and
// returning the concatenated visible content. Comments, usage-only frames,
// multiline data frames and arbitrary byte splits are tolerated.
func readStream(parent, bounded context.Context, body io.Reader, request ChatRequest) (string, error) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)

	var content strings.Builder
	chars := 0
	sawFrame := false
	sawDone := false
	sawFinish := false
	sawReasoning := false
	dataLines := make([]string, 0, 4)
	done := false

	appendDelta := func(text string) {
		if text == "" {
			return
		}
		content.WriteString(text)
		chars += utf8.RuneCountInString(text)
		notify(request.Progress, Progress{Phase: PhaseGenerating, ReceivedChars: chars})
	}

	flush := func() error {
		if len(dataLines) == 0 {
			return nil
		}
		payload := strings.Join(dataLines, "\n")
		dataLines = dataLines[:0]
		trimmed := strings.TrimSpace(payload)
		if trimmed == "" {
			return nil
		}
		if trimmed == "[DONE]" {
			sawDone = true
			return errStreamDone
		}

		var chunk streamChunk
		if err := json.Unmarshal([]byte(trimmed), &chunk); err != nil {
			// Keep-alive payloads and provider-specific frames are ignored.
			return nil
		}
		// Any successfully parsed chunk means the provider speaks SSE even if
		// it never emits choices (usage-only frames).
		sawFrame = true

		if len(chunk.Error) > 0 && string(chunk.Error) != "null" {
			return NewStatusError(KindUpstream, "模型服务在生成过程中出错，请稍后重试。", 0)
		}
		if len(chunk.Choices) == 0 {
			return nil
		}

		choice := chunk.Choices[0]
		delta := ""
		reasoning := ""
		if choice.Delta != nil {
			delta = contentText(choice.Delta.Content)
			reasoning = contentText(choice.Delta.ReasoningContent)
			if strings.TrimSpace(reasoning) == "" {
				reasoning = contentText(choice.Delta.Reasoning)
			}
		} else if choice.Message != nil {
			delta = contentText(choice.Message.Content)
		}
		if strings.TrimSpace(delta) == "" && choice.Text != nil {
			delta = *choice.Text
		}

		if strings.TrimSpace(reasoning) != "" {
			sawReasoning = true
			if chars == 0 {
				notify(request.Progress, Progress{Phase: PhaseThinking})
			}
		}
		appendDelta(delta)

		if choice.FinishReason != "" {
			sawFinish = true
			if isTruncatedFinish(choice.FinishReason) {
				// A non-empty partial body is a truncation, not a formatting
				// problem: fail now so no repair call is spent on it.
				if chars > 0 {
					return truncatedError(request.MaxTokens)
				}
				return NewStatusError(KindUpstream, "模型在返回正文前耗尽了输出额度，请重试或更换模型。", 0)
			}
		}
		return nil
	}

	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if err := flush(); err != nil {
				if errors.Is(err, errStreamDone) {
					done = true
					break
				}
				return "", err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, ok := strings.Cut(line, ":")
		if !ok || field != "data" {
			continue
		}
		dataLines = append(dataLines, strings.TrimPrefix(value, " "))
	}

	if !done {
		if err := flush(); err != nil {
			if !errors.Is(err, errStreamDone) {
				return "", err
			}
			done = true
		}
	}

	if canceled := cancellation(parent, bounded); canceled != nil {
		return "", canceled
	}
	if err := scanner.Err(); err != nil {
		return "", NewStatusError(KindUpstream, "模型服务的响应在完成前中断，请重试。", 0)
	}

	if !sawDone && !sawFinish {
		if !sawFrame {
			return "", NewStatusError(KindUpstream, "模型服务返回了无法解析的响应，请稍后重试。", 0)
		}
		// Ending without [DONE] or a finish reason means the body is
		// incomplete; never feed a truncated body to the repair round-trip.
		return "", NewStatusError(KindUpstream, "模型服务的响应在完成前中断，请重试。", 0)
	}

	text := strings.TrimSpace(content.String())
	if text == "" {
		if sawReasoning {
			return "", NewStatusError(KindUpstream, "模型只返回了推理内容，没有返回答案正文。请检查服务商的模型设置。", 0)
		}
		return "", NewStatusError(KindUpstream, "模型没有返回有效内容，请重试。", 0)
	}

	notify(request.Progress, Progress{
		Phase:         PhaseGenerating,
		ReceivedChars: utf8.RuneCountInString(text),
		Final:         true,
	})
	return text, nil
}

func isEventStream(contentType string) bool {
	return strings.Contains(strings.ToLower(contentType), "text/event-stream")
}

// isTruncatedFinish reports whether the provider stopped at the output cap.
func isTruncatedFinish(reason string) bool {
	switch strings.ToLower(strings.TrimSpace(reason)) {
	case "length", "max_tokens", "max_completion_tokens", "max_output_tokens":
		return true
	default:
		return false
	}
}

func truncatedError(maxTokens int) *Error {
	message := "模型输出达到上限，返回内容被截断，请重试或更换模型。"
	if maxTokens > 0 {
		message = fmt.Sprintf("模型输出达到 %d token 上限，返回内容被截断，请重试或更换模型。", maxTokens)
	}
	return NewStatusError(KindBudget, message, 0)
}

func notify(progress func(Progress), event Progress) {
	if progress != nil {
		progress(event)
	}
}

type completionResponse struct {
	Choices []completionChoice `json:"choices"`
}

type completionChoice struct {
	Message      *completionMessage `json:"message"`
	Text         *string            `json:"text"`
	FinishReason string             `json:"finish_reason"`
}

type completionMessage struct {
	Content          json.RawMessage `json:"content"`
	ReasoningContent json.RawMessage `json:"reasoning_content"`
}

func extractContent(completion completionResponse, maxTokens int) (string, error) {
	if len(completion.Choices) == 0 {
		return "", NewStatusError(KindUpstream, "模型没有返回有效内容，请重试。", 0)
	}
	first := completion.Choices[0]

	content := ""
	if first.Message != nil {
		content = contentText(first.Message.Content)
	}
	if strings.TrimSpace(content) == "" && first.Text != nil {
		content = *first.Text
	}

	if strings.TrimSpace(content) != "" {
		if isTruncatedFinish(first.FinishReason) {
			return "", truncatedError(maxTokens)
		}
		return strings.TrimSpace(content), nil
	}

	if isTruncatedFinish(first.FinishReason) {
		return "", NewStatusError(KindUpstream, "模型在返回正文前耗尽了输出额度，请重试或更换模型。", 0)
	}
	if first.Message != nil && strings.TrimSpace(stringValue(first.Message.ReasoningContent)) != "" {
		return "", NewStatusError(KindUpstream, "模型只返回了推理内容，没有返回答案正文。请检查服务商的模型设置。", 0)
	}
	return "", NewStatusError(KindUpstream, "模型没有返回有效内容，请重试。", 0)
}

func contentText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}

	var parts []any
	if err := json.Unmarshal(raw, &parts); err != nil {
		return ""
	}
	var builder strings.Builder
	for _, part := range parts {
		switch value := part.(type) {
		case string:
			builder.WriteString(value)
		case map[string]any:
			if text, ok := value["text"].(string); ok {
				builder.WriteString(text)
			}
		}
	}
	return builder.String()
}

func stringValue(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}
	return value
}

// Ping performs the minimal real request used by /api/connection-test. It
// deliberately does not request JSON so it works with the widest range of
// compatible endpoints.
func Ping(ctx context.Context, config Config, timeout time.Duration) error {
	if timeout <= 0 {
		timeout = DefaultPingTimeout
	}
	_, err := Chat(ChatRequest{
		Config: config,
		Messages: []Message{
			{Role: RoleSystem, Content: "You are a connectivity probe. Reply with the single word OK."},
			{Role: RoleUser, Content: "ping"},
		},
		Context:     ctx,
		Timeout:     timeout,
		Temperature: Temperature(0),
		// Reasoning tokens share this budget with the visible answer on many APIs.
		MaxTokens: 1_024,
	})
	return err
}
