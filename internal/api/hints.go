package api

import (
	"net/http"
	"strings"

	"lexigene/internal/contracts"
	"lexigene/internal/llm"
	"lexigene/internal/prompts"
)

const (
	hintsMaxTokens = 1_600
	maxHints       = 8
)

type quizHintsRequest struct {
	Config   contracts.Config `json:"config"`
	Target   string           `json:"target"`
	Language string           `json:"language"`
	Question hintQuestion     `json:"question"`
}

type hintQuestion struct {
	ID        string `json:"id"`
	Scenario  string `json:"scenario"`
	Challenge string `json:"challenge"`
}

type quizHintsOutput struct {
	Hints []contracts.VocabularyHint `json:"hints"`
}

type quizHintsResponse struct {
	Hints []contracts.VocabularyHint `json:"hints"`
}

// quizHints returns contextual vocabulary annotations. Only the scenario and
// challenge text are accepted, so the reference answer cannot leak back.
func (h *handler) quizHints(response http.ResponseWriter, request *http.Request) {
	value, ok := readJSON(request)
	if !ok {
		writeError(response, http.StatusBadRequest, "请求体必须是 JSON。")
		return
	}
	trimConfigBaseURL(value)
	if object, ok := objectOf(value); ok {
		trimStringField(object, "target")
		trimStringField(object, "language")
		if question, ok := objectOf(object["question"]); ok {
			trimStringField(question, "id")
			trimStringField(question, "scenario")
			trimStringField(question, "challenge")
		}
	}
	if !valid(contracts.Lookup(contracts.NameQuizHintsRequest), value) {
		writeError(response, http.StatusBadRequest, "词汇提示请求不完整或格式不正确。")
		return
	}
	parsed, ok := decodeValue[quizHintsRequest](value)
	if !ok {
		writeError(response, http.StatusBadRequest, "词汇提示请求不完整或格式不正确。")
		return
	}

	output, err := llm.CallJSON[quizHintsOutput](llm.JSONRequest{
		Config: llmConfig(parsed.Config),
		Messages: prompts.BuildHintMessages(prompts.HintPromptInput{
			Target:   parsed.Target,
			Language: parsed.Language,
			Question: prompts.HintQuestion{
				ID:        parsed.Question.ID,
				Scenario:  parsed.Question.Scenario,
				Challenge: parsed.Question.Challenge,
			},
		}),
		Schema:    contracts.Lookup(contracts.NameQuizHintsOutput),
		Context:   request.Context(),
		Timeout:   h.timeouts.hints,
		MaxTokens: hintsMaxTokens,
	})
	if err != nil {
		if llm.IsAborted(err) {
			writeEmpty(response, 499)
			return
		}
		writeError(response, llm.StatusFor(err), llm.PublicMessage(err))
		return
	}

	writeJSON(response, http.StatusOK, quizHintsResponse{
		Hints: selectHints(output.Hints, parsed.Target, parsed.Question.Scenario, parsed.Question.Challenge),
	})
}

// selectHints keeps only hints whose term is a literal substring of the
// scenario/challenge, drops duplicates (case-insensitive) and the target word
// itself, then caps the list.
func selectHints(hints []contracts.VocabularyHint, target, scenario, challenge string) []contracts.VocabularyHint {
	corpus := scenario + "\n" + challenge
	normalizedTarget := strings.ToLower(strings.TrimSpace(target))
	seen := make(map[string]struct{}, len(hints))
	selected := make([]contracts.VocabularyHint, 0, maxHints)

	for _, hint := range hints {
		term := strings.TrimSpace(hint.Term)
		english := strings.TrimSpace(hint.EN)
		if term == "" || english == "" {
			continue
		}
		if !strings.Contains(corpus, term) {
			continue
		}
		if normalizedTarget != "" && strings.ToLower(term) == normalizedTarget {
			continue
		}
		key := strings.ToLower(term)
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		selected = append(selected, contracts.VocabularyHint{Term: term, EN: english})
		if len(selected) >= maxHints {
			break
		}
	}

	return selected
}
