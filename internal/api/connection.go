package api

import (
	"net/http"
	"time"

	"lexigene/internal/contracts"
	"lexigene/internal/llm"
)

type connectionTestRequest struct {
	Config contracts.Config `json:"config"`
}

type connectionSuccess struct {
	OK        bool   `json:"ok"`
	Model     string `json:"model"`
	LatencyMS int64  `json:"latencyMs"`
}

type connectionFailure struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

// connectionTest performs a minimal real model request and reports latency.
func (h *handler) connectionTest(response http.ResponseWriter, request *http.Request) {
	value, ok := readJSON(request)
	if !ok {
		writeJSON(response, http.StatusBadRequest, connectionFailure{Error: "请求体必须是 JSON。"})
		return
	}
	trimConfigBaseURL(value)
	if !valid(contracts.Lookup(contracts.NameConnectionTestRequest), value) {
		writeJSON(response, http.StatusBadRequest, connectionFailure{Error: "接口配置不完整或格式不正确。"})
		return
	}
	parsed, ok := decodeValue[connectionTestRequest](value)
	if !ok {
		writeJSON(response, http.StatusBadRequest, connectionFailure{Error: "接口配置不完整或格式不正确。"})
		return
	}

	startedAt := time.Now()
	err := llm.Ping(request.Context(), llm.Config{
		BaseURL: parsed.Config.BaseURL,
		APIKey:  parsed.Config.APIKey,
		Model:   parsed.Config.Model,
	}, h.timeouts.connection)
	if err != nil {
		if llm.IsAborted(err) {
			writeEmpty(response, 499)
			return
		}
		// The body never contains the API key, request headers or upstream
		// text. A non-2xx status lets the settings panel surface the failure.
		writeJSON(response, llm.StatusFor(err), connectionFailure{Error: llm.PublicMessage(err)})
		return
	}

	writeJSON(response, http.StatusOK, connectionSuccess{
		OK:        true,
		Model:     parsed.Config.Model,
		LatencyMS: time.Since(startedAt).Milliseconds(),
	})
}
