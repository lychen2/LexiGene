// Package api serves the LexiGene HTTP endpoints.
//
// The routes preserve the old Next.js API contract: the same paths, request
// bodies, status codes, cache headers and sanitized Chinese error messages.
// Model calls are delegated to internal/llm, prompts to internal/prompts,
// validation to internal/contracts, etymology references to internal/wiktionary
// and Anki packaging to internal/anki.
package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"lexigene/internal/contracts"
	"lexigene/internal/llm"
	"lexigene/internal/wiktionary"
)

// Options configures the API handler. Wiktionary is optional: when nil the
// analyze endpoint follows the original prompt path without etymology
// references.
type Options struct {
	Wiktionary *wiktionary.Client
}

// timeouts keeps the endpoint budgets in one place so tests can exercise
// timeout paths without waiting for production durations.
type timeouts struct {
	dimension  time.Duration
	grade      time.Duration
	hints      time.Duration
	connection time.Duration
	models     time.Duration
	heartbeat  time.Duration
	// progress throttles dimension-progress events.
	progress time.Duration
}

func defaultTimeouts() timeouts {
	return timeouts{
		// One total budget per dimension covers the streamed call and its one
		// repair, sized for the 32768-token output allowance.
		dimension:  600 * time.Second,
		grade:      90 * time.Second,
		hints:      45 * time.Second,
		connection: 30 * time.Second,
		models:     15 * time.Second,
		heartbeat:  15 * time.Second,
		progress:   250 * time.Millisecond,
	}
}

type handler struct {
	wiktionary *wiktionary.Client
	timeouts   timeouts
}

// NewHandler returns the HTTP handler for every LexiGene API route.
func NewHandler(options Options) http.Handler {
	return newHandler(options, defaultTimeouts())
}

func newHandler(options Options, budget timeouts) http.Handler {
	h := &handler{wiktionary: options.Wiktionary, timeouts: budget}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/analyze", h.analyze)
	mux.HandleFunc("POST /api/connection-test", h.connectionTest)
	mux.HandleFunc("POST /api/models", h.models)
	mux.HandleFunc("POST /api/grade", h.grade)
	mux.HandleFunc("POST /api/quiz-hints", h.quizHints)
	mux.HandleFunc("POST /api/export/anki", h.exportAnki)
	return mux
}

// readJSON decodes a strict JSON document. Trailing data is rejected, matching
// JSON.parse in the old routes.
func readJSON(request *http.Request) (any, bool) {
	data, err := io.ReadAll(request.Body)
	if err != nil {
		return nil, false
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, false
	}
	return value, true
}

func writeJSON(response http.ResponseWriter, status int, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		response.Header().Set("Content-Type", "application/json; charset=utf-8")
		response.Header().Set("Cache-Control", "no-store")
		response.WriteHeader(http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(status)
	_, _ = response.Write(data)
}

type errorResponse struct {
	Error string `json:"error"`
}

func writeError(response http.ResponseWriter, status int, message string) {
	writeJSON(response, status, errorResponse{Error: message})
}

func writeEmpty(response http.ResponseWriter, status int) {
	response.WriteHeader(status)
}

func llmConfig(config contracts.Config) llm.Config {
	return llm.Config{BaseURL: config.BaseURL, APIKey: config.APIKey, Model: config.Model}
}

func decodeValue[T any](value any) (T, bool) {
	var target T
	data, err := json.Marshal(value)
	if err != nil {
		return target, false
	}
	if err := json.Unmarshal(data, &target); err != nil {
		return target, false
	}
	return target, true
}

func objectOf(value any) (map[string]any, bool) {
	object, ok := value.(map[string]any)
	return object, ok
}

func trimStringField(object map[string]any, key string) {
	if text, ok := object[key].(string); ok {
		object[key] = strings.TrimSpace(text)
	}
}

// trimConfigBaseURL trims only the provider URL. Zod's URL parser ignores
// surrounding whitespace, so the Go validation must accept the same input.
func trimConfigBaseURL(value any) {
	object, ok := objectOf(value)
	if !ok {
		return
	}
	config, ok := objectOf(object["config"])
	if !ok {
		return
	}
	trimStringField(config, "baseUrl")
}

// valid reports whether value satisfies the contract.
func valid(schema *contracts.Schema, value any) bool {
	return len(schema.Issues(value)) == 0
}
