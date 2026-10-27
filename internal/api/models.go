package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"

	"lexigene/internal/contracts"
	"lexigene/internal/llm"
)

type modelsRequest struct {
	Config contracts.Credentials `json:"config"`
}

type modelsResponse struct {
	Models []string `json:"models"`
}

// modelsURL keeps the configured base path and appends /models. Configs that
// already store the chat completion endpoint are unwrapped first.
func modelsURL(baseURL string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	lower := strings.ToLower(base)
	if strings.HasSuffix(lower, "/chat/completions") {
		base = strings.TrimRight(base[:len(base)-len("/chat/completions")], "/")
	}
	if strings.HasSuffix(strings.ToLower(base), "/models") {
		return base
	}
	return base + "/models"
}

func modelsStatusError(status int) *llm.Error {
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return llm.NewStatusError(llm.KindAuth, "", status)
	case status == http.StatusTooManyRequests:
		return llm.NewStatusError(llm.KindRateLimit, "", status)
	case status == http.StatusNotFound:
		return llm.NewStatusError(llm.KindUpstream, "模型列表接口不可用，请检查接口地址是否支持 /v1/models。", status)
	case status >= 500:
		return llm.NewStatusError(llm.KindUpstream, "", status)
	default:
		return llm.NewStatusError(llm.KindUpstream, "模型服务拒绝了模型列表请求，请检查接口配置。", status)
	}
}

// readModelIDs accepts only the documented OpenAI list shape: {data: [{id}]}.
// Entries without a usable string id are skipped; a non-array payload is an
// error. IDs are trimmed, deduplicated and sorted.
func readModelIDs(payload any) ([]string, *llm.Error) {
	object, ok := payload.(map[string]any)
	if !ok {
		return nil, llm.NewStatusError(llm.KindUpstream, "模型列表格式不正确，请检查接口地址。", 0)
	}
	data, ok := object["data"].([]any)
	if !ok {
		return nil, llm.NewStatusError(llm.KindUpstream, "模型列表格式不正确，请检查接口地址。", 0)
	}

	ids := make(map[string]struct{}, len(data))
	for _, entry := range data {
		record, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		id, ok := record["id"].(string)
		if !ok {
			continue
		}
		trimmed := strings.TrimSpace(id)
		if trimmed != "" {
			ids[trimmed] = struct{}{}
		}
	}

	models := make([]string, 0, len(ids))
	for id := range ids {
		models = append(models, id)
	}
	sort.Strings(models)
	return models, nil
}

// modelsHTTPClient has no client-level timeout: the discovery budget is
// enforced with a context deadline.
var modelsHTTPClient = &http.Client{}

func modelsCancellation(parent, bounded context.Context) *llm.Error {
	if parent != nil && parent.Err() != nil {
		return llm.NewError(llm.KindAborted)
	}
	if errors.Is(bounded.Err(), context.DeadlineExceeded) {
		return llm.NewError(llm.KindTimeout)
	}
	return nil
}

func listModels(ctx, parent context.Context, config contracts.Credentials) ([]string, *llm.Error) {
	if ctx.Err() != nil {
		return nil, llm.NewError(llm.KindAborted)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsURL(config.BaseURL), nil)
	if err != nil {
		return nil, llm.NewError(llm.KindNetwork)
	}
	request.Header.Set("Authorization", "Bearer "+config.APIKey)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Cache-Control", "no-store")

	response, err := modelsHTTPClient.Do(request)
	if err != nil {
		if canceled := modelsCancellation(parent, ctx); canceled != nil {
			return nil, canceled
		}
		return nil, llm.NewError(llm.KindNetwork)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// Never read or forward the upstream body: it may echo credentials.
		return nil, modelsStatusError(response.StatusCode)
	}

	raw, err := io.ReadAll(response.Body)
	if err != nil {
		if canceled := modelsCancellation(parent, ctx); canceled != nil {
			return nil, canceled
		}
		return nil, llm.NewStatusError(llm.KindUpstream, "模型服务返回了无法解析的响应，请稍后重试。", 0)
	}
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, llm.NewStatusError(llm.KindUpstream, "模型服务返回了无法解析的响应，请稍后重试。", 0)
	}

	return readModelIDs(payload)
}

func (h *handler) models(response http.ResponseWriter, request *http.Request) {
	value, ok := readJSON(request)
	if !ok {
		writeError(response, http.StatusBadRequest, "请求体必须是 JSON。")
		return
	}
	trimConfigBaseURL(value)
	if !valid(contracts.Lookup(contracts.NameModelsRequest), value) {
		writeError(response, http.StatusBadRequest, "接口配置不完整或格式不正确。")
		return
	}
	parsed, ok := decodeValue[modelsRequest](value)
	if !ok {
		writeError(response, http.StatusBadRequest, "接口配置不完整或格式不正确。")
		return
	}

	parent := request.Context()
	ctx, cancel := context.WithTimeout(parent, h.timeouts.models)
	defer cancel()

	models, modelError := listModels(ctx, parent, parsed.Config)
	if modelError != nil {
		if modelError.Kind == llm.KindAborted {
			response.Header().Set("Cache-Control", "no-store")
			writeEmpty(response, 499)
			return
		}
		writeError(response, llm.StatusFor(modelError), llm.PublicMessage(modelError))
		return
	}

	writeJSON(response, http.StatusOK, modelsResponse{Models: models})
}
