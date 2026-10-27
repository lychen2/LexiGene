package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Validator is a JSON Schema contract used for prompting and validation.
type Validator interface {
	// Document returns the JSON Schema document included in the prompt.
	Document() any
	// Validate returns human-readable issues; an empty slice means valid.
	Validate(value any) []string
}

// JSONRequest is one structured completion request.
type JSONRequest struct {
	Config      Config
	Messages    []Message
	Schema      Validator
	Context     context.Context
	Timeout     time.Duration
	Temperature *float64
	MaxTokens   int
	// Stream asks the provider to stream the completion so callers can report
	// incremental progress. The initial and repair calls both stream.
	Stream bool
	// Progress is optional and receives visible body progress only.
	Progress func(Progress)
}

// CallJSON asks the model for JSON, validates it against the schema, and
// allows exactly one repair round-trip for malformed JSON or a schema
// violation.
func CallJSON[T any](request JSONRequest) (T, error) {
	var zero T

	instruction := schemaInstruction(request.Schema)
	messages := withSchemaInstruction(request.Messages, instruction)
	maxTokens := request.MaxTokens
	if maxTokens <= 0 {
		maxTokens = DefaultMaxTokens
	}

	raw, err := Chat(ChatRequest{
		Config:      request.Config,
		Messages:    messages,
		Context:     request.Context,
		Timeout:     request.Timeout,
		Temperature: request.Temperature,
		MaxTokens:   maxTokens,
		Stream:      request.Stream,
		Progress:    request.Progress,
	})
	if err != nil {
		return zero, err
	}

	value, ok := parseJSON(raw)
	if ok {
		if issues := request.Schema.Validate(value); len(issues) == 0 {
			decoded, err := decodeJSON[T](value)
			if err != nil {
				return zero, NewError(KindFormat)
			}
			return decoded, nil
		} else {
			return repair[T](request, messages, raw, "结构校验失败："+joinIssues(issues), maxTokens)
		}
	}

	return repair[T](request, messages, raw, "输出不是合法的 JSON 对象", maxTokens)
}

func repair[T any](request JSONRequest, messages []Message, raw string, reason string, maxTokens int) (T, error) {
	var zero T

	repairMessages := make([]Message, 0, len(messages)+2)
	repairMessages = append(repairMessages, messages...)
	repairMessages = append(repairMessages,
		Message{Role: RoleAssistant, Content: raw},
		Message{
			Role: RoleUser,
			Content: strings.Join([]string{
				fmt.Sprintf("你上一次的输出没有通过校验：%s。", reason),
				"请重新生成完整结果，严格只输出一个符合上述 JSON Schema 的 JSON 对象。",
				"不要解释、不要道歉、不要使用 Markdown 代码围栏，也不要省略任何必填字段。",
			}, "\n"),
		},
	)

	repairedRaw, err := Chat(ChatRequest{
		Config:      request.Config,
		Messages:    repairMessages,
		Context:     request.Context,
		Timeout:     request.Timeout,
		Temperature: Temperature(0),
		MaxTokens:   maxTokens,
		Stream:      request.Stream,
		Progress:    repairProgress(request.Progress),
	})
	if err != nil {
		return zero, err
	}

	value, ok := parseJSON(repairedRaw)
	if !ok {
		return zero, NewError(KindFormat)
	}
	if issues := request.Schema.Validate(value); len(issues) > 0 {
		return zero, NewError(KindFormat)
	}

	decoded, err := decodeJSON[T](value)
	if err != nil {
		return zero, NewError(KindFormat)
	}
	return decoded, nil
}

// repairProgress relabels visible body deltas of the repair round-trip so the
// caller can show a repairing phase. Reasoning deltas stay in thinking.
func repairProgress(progress func(Progress)) func(Progress) {
	if progress == nil {
		return nil
	}
	return func(event Progress) {
		if event.Phase == PhaseGenerating {
			event.Phase = PhaseRepairing
		}
		progress(event)
	}
}

// decodeJSON converts the already-parsed JSON value into the typed result.
// Marshaling the parsed value first normalizes integral numbers (8.0 -> 8), so
// JSON such as 8.0 still decodes into Go int fields just as Zod's number().int()
// accepts it.
func decodeJSON[T any](value any) (T, error) {
	var target T
	data, err := json.Marshal(value)
	if err != nil {
		return target, err
	}
	err = json.Unmarshal(data, &target)
	return target, err
}

func joinIssues(issues []string) string {
	if len(issues) > 8 {
		issues = issues[:8]
	}
	return strings.Join(issues, "; ")
}

// schemaInstruction is the text sent to the model so JSON prompting matches
// the embedded JSON Schema exactly.
func schemaInstruction(schema Validator) string {
	document, err := json.MarshalIndent(schema.Document(), "", "  ")
	if err != nil {
		document = []byte("{}")
	}
	return strings.Join([]string{
		"输出要求（必须严格遵守）：",
		"只输出一个 JSON 对象，不要输出 Markdown 代码围栏、前后解释、注释或多余文本。",
		"对象必须包含 schema 中所有必填字段；数组长度、数值范围、枚举取值和嵌套结构必须符合 schema。",
		"无法确定的内容不要编造，改用保守、诚实的表述；不要为了凑数捏造事实。",
		"JSON Schema:",
		string(document),
	}, "\n")
}

func withSchemaInstruction(messages []Message, instruction string) []Message {
	systemIndex := -1
	for index, message := range messages {
		if message.Role == RoleSystem {
			systemIndex = index
			break
		}
	}

	result := make([]Message, 0, len(messages)+1)
	if systemIndex == -1 {
		result = append(result, Message{Role: RoleSystem, Content: instruction})
		result = append(result, messages...)
		return result
	}

	result = append(result, messages[:systemIndex]...)
	augmented := messages[systemIndex]
	augmented.Content = augmented.Content + "\n\n" + instruction
	result = append(result, augmented)
	result = append(result, messages[systemIndex+1:]...)
	return result
}

var outerFence = regexp.MustCompile("(?s)^```[a-zA-Z0-9_-]*[ \t]*\r?\n?(.*?)\r?\n?```$")

// stripOuterFence strips one Markdown fence if (and only if) it wraps the
// whole output. JSON is never extracted from surrounding prose.
func stripOuterFence(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if match := outerFence.FindStringSubmatch(trimmed); match != nil {
		return strings.TrimSpace(match[1])
	}
	return trimmed
}

func parseJSON(raw string) (any, bool) {
	var value any
	if err := json.Unmarshal([]byte(stripOuterFence(raw)), &value); err != nil {
		return nil, false
	}
	return value, true
}
