// Package llm performs OpenAI-compatible chat completions for LexiGene.
//
// Errors returned by this package are safe to surface to the browser: messages
// are fixed, sanitized Chinese strings and never contain the API key, request
// headers or an upstream body. Upstream bodies are never read or forwarded
// because they may echo credentials.
package llm

import "errors"

// ErrorKind classifies a model call failure.
type ErrorKind string

const (
	KindAuth      ErrorKind = "auth"
	KindRateLimit ErrorKind = "rate-limit"
	KindNetwork   ErrorKind = "network"
	KindTimeout   ErrorKind = "timeout"
	KindUpstream  ErrorKind = "upstream"
	KindFormat    ErrorKind = "format"
	// KindBudget means the provider stopped at the output-token cap and
	// returned truncated (or no) body content.
	KindBudget  ErrorKind = "budget"
	KindAborted ErrorKind = "aborted"
)

const abortedMessage = "请求已取消。"

var publicMessages = map[ErrorKind]string{
	KindAuth:      "API Key 无效或没有访问权限，请检查接口配置。",
	KindRateLimit: "模型服务请求过于频繁，请稍后再试。",
	KindNetwork:   "无法连接模型服务，请检查接口地址与网络。",
	KindTimeout:   "模型响应超时，请稍后重试或更换模型。",
	KindUpstream:  "模型服务暂时不可用，请稍后重试。",
	KindFormat:    "模型返回的内容格式不正确，请重试。",
	KindBudget:    "模型输出达到上限，返回内容被截断，请重试或更换模型。",
}

// Error is a model call failure with a browser-safe message.
type Error struct {
	Kind    ErrorKind
	Message string
	Status  int
}

func (e *Error) Error() string { return e.Message }

// NewError returns an Error carrying the fixed public message for kind.
func NewError(kind ErrorKind) *Error {
	message := publicMessages[kind]
	if kind == KindAborted {
		message = abortedMessage
	}
	return &Error{Kind: kind, Message: message}
}

// NewStatusError returns an Error with an optional custom public message and
// the upstream HTTP status. An empty message uses the fixed message for kind.
func NewStatusError(kind ErrorKind, message string, status int) *Error {
	if message == "" {
		message = publicMessages[kind]
	}
	return &Error{Kind: kind, Message: message, Status: status}
}

// IsAborted reports whether err is a client cancellation.
func IsAborted(err error) bool {
	var llmError *Error
	return errors.As(err, &llmError) && llmError.Kind == KindAborted
}

// PublicMessage turns any error into a message that is safe to show in the UI.
func PublicMessage(err error) string {
	var llmError *Error
	if errors.As(err, &llmError) {
		return llmError.Message
	}
	return "模型调用失败，请稍后重试。"
}

// StatusFor maps an error to the documented HTTP status.
func StatusFor(err error) int {
	var llmError *Error
	if !errors.As(err, &llmError) {
		return 502
	}
	switch llmError.Kind {
	case KindAborted:
		return 499
	case KindRateLimit:
		return 429
	case KindTimeout:
		return 504
	default:
		return 502
	}
}
