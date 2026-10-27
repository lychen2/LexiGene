package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"

	"lexigene/internal/contracts"
	"lexigene/internal/llm"
	"lexigene/internal/prompts"
)

const gradeMaxTokens = 4_000

type gradeRequest struct {
	Config   contracts.Config       `json:"config"`
	Target   string                 `json:"target"`
	Language string                 `json:"language"`
	Question contracts.QuizQuestion `json:"question"`
	Answer   string                 `json:"answer"`
	Context  gradeRequestContext    `json:"context"`
}

type gradeRequestContext struct {
	Core     string `json:"core"`
	Register any    `json:"register"`
	Subtext  string `json:"subtext"`
	Chunks   []any  `json:"chunks"`
}

func (h *handler) grade(response http.ResponseWriter, request *http.Request) {
	value, ok := readJSON(request)
	if !ok {
		writeError(response, http.StatusBadRequest, "请求体必须是 JSON。")
		return
	}
	trimConfigBaseURL(value)
	if object, ok := objectOf(value); ok {
		trimStringField(object, "target")
		trimStringField(object, "language")
		trimStringField(object, "answer")
	}
	if !valid(contracts.Lookup(contracts.NameGradeRequest), value) {
		writeError(response, http.StatusBadRequest, "批改请求不完整或格式不正确。")
		return
	}
	parsed, ok := decodeValue[gradeRequest](value)
	if !ok {
		writeError(response, http.StatusBadRequest, "批改请求不完整或格式不正确。")
		return
	}

	context := prompts.GradeContext{
		Core:     strings.TrimSpace(parsed.Context.Core),
		Register: parsed.Context.Register,
		Subtext:  strings.TrimSpace(parsed.Context.Subtext),
		Chunks:   make([]string, 0, 8),
	}
	for _, chunk := range parsed.Context.Chunks {
		label := chunkLabel(chunk)
		if label == "" {
			continue
		}
		context.Chunks = append(context.Chunks, label)
		if len(context.Chunks) >= 8 {
			break
		}
	}

	grade, err := llm.CallJSON[contracts.Grade](llm.JSONRequest{
		Config: llmConfig(parsed.Config),
		Messages: prompts.BuildGradeMessages(prompts.GradePromptInput{
			Target:   parsed.Target,
			Language: parsed.Language,
			Question: parsed.Question,
			Answer:   parsed.Answer,
			Context:  context,
		}),
		Schema:    contracts.Lookup(contracts.NameGrade),
		Context:   request.Context(),
		Timeout:   h.timeouts.grade,
		MaxTokens: gradeMaxTokens,
	})
	if err != nil {
		if llm.IsAborted(err) {
			writeEmpty(response, 499)
			return
		}
		writeError(response, llm.StatusFor(err), llm.PublicMessage(err))
		return
	}

	writeJSON(response, http.StatusOK, grade)
}

// chunkLabel mirrors the old route's normalization of learned context chunks.
func chunkLabel(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case map[string]any:
		phrase, ok := typed["phrase"].(string)
		if !ok {
			return marshalJSONValue(value)
		}
		if meaning, ok := typed["meaning"].(string); ok {
			return phrase + "（" + meaning + "）"
		}
		return phrase
	case []any, float64, bool:
		return marshalJSONValue(typed)
	default:
		return ""
	}
}

// marshalJSONValue matches JavaScript's JSON.stringify for one decoded chunk.
func marshalJSONValue(value any) string {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return ""
	}
	return strings.TrimSuffix(buffer.String(), "\n")
}
