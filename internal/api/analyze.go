package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"lexigene/internal/contracts"
	"lexigene/internal/llm"
	"lexigene/internal/prompts"
)

const (
	eventDimensionStart    = "dimension-start"
	eventDimensionProgress = "dimension-progress"
	eventDimensionComplete = "dimension-complete"
	eventComplete          = "complete"
	eventError             = "error"
)

const (
	dimensionMaxTokens = 32_768
)

type analyzeRequest struct {
	Config contracts.Config `json:"config"`
	Draft  contracts.Draft  `json:"draft"`
}

type analysisEvent struct {
	Type      string                 `json:"type"`
	Dimension contracts.DimensionKey `json:"dimension,omitempty"`
	Data      any                    `json:"data,omitempty"`
	Message   string                 `json:"message,omitempty"`
	// ReceivedChars and Phase are set on dimension-progress events only. The
	// count covers visible body characters; no body or reasoning text is sent.
	ReceivedChars *int   `json:"receivedChars,omitempty"`
	Phase         string `json:"phase,omitempty"`
}

func (h *handler) analyze(response http.ResponseWriter, request *http.Request) {
	value, ok := readJSON(request)
	if !ok {
		writeError(response, http.StatusBadRequest, "请求体必须是 JSON。")
		return
	}
	trimConfigBaseURL(value)
	if !valid(contracts.Lookup(contracts.NameAnalyzeRequest), value) {
		writeError(response, http.StatusBadRequest, "接口配置或分析草稿不完整、格式不正确。")
		return
	}
	analysis, ok := decodeValue[analyzeRequest](value)
	if !ok {
		writeError(response, http.StatusBadRequest, "接口配置或分析草稿不完整、格式不正确。")
		return
	}

	header := response.Header()
	header.Set("Content-Type", "text/event-stream; charset=utf-8")
	header.Set("Cache-Control", "no-cache, no-transform")
	header.Set("Connection", "keep-alive")
	header.Set("X-Accel-Buffering", "no")
	response.WriteHeader(http.StatusOK)

	writer := &sseWriter{response: response}
	if flusher, ok := response.(http.Flusher); ok {
		writer.flusher = flusher
		flusher.Flush()
	}

	clientContext := request.Context()
	upstreamContext, cancelUpstream := context.WithCancel(clientContext)
	defer cancelUpstream()

	events := make(chan analysisEvent)
	go h.runDimensions(upstreamContext, analysis, events)

	var ticker *time.Ticker
	var heartbeat <-chan time.Time
	if h.timeouts.heartbeat > 0 {
		ticker = time.NewTicker(h.timeouts.heartbeat)
		heartbeat = ticker.C
		defer ticker.Stop()
	}

	for {
		select {
		case event, open := <-events:
			if !open {
				return
			}
			if !writer.event(event) {
				return
			}
		case <-heartbeat:
			if !writer.comment(": keep-alive\n\n") {
				return
			}
		case <-clientContext.Done():
			return
		}
	}
}

// runDimensions generates each missing dimension sequentially. Existing
// dimensions are never regenerated, so a failed or retried request resumes
// from the first missing dimension.
func (h *handler) runDimensions(ctx context.Context, request analyzeRequest, events chan<- analysisEvent) {
	defer close(events)

	dimensions := request.Draft.Dimensions

	for _, dimension := range contracts.DimensionOrder {
		if ctx.Err() != nil {
			return
		}
		if hasDimension(dimensions, dimension) {
			continue
		}

		if !sendEvent(ctx, events, analysisEvent{Type: eventDimensionStart, Dimension: dimension}) {
			return
		}

		payload, err := h.generateDimension(ctx, request, &dimensions, dimension, progressReporter(ctx, events, dimension, h.timeouts.progress))
		if err != nil {
			if llm.IsAborted(err) || ctx.Err() != nil {
				return
			}
			sendEvent(ctx, events, analysisEvent{
				Type:      eventError,
				Dimension: dimension,
				Message:   llm.PublicMessage(err),
			})
			return
		}

		if !sendEvent(ctx, events, analysisEvent{
			Type:      eventDimensionComplete,
			Dimension: dimension,
			Data:      payload,
		}) {
			return
		}
	}

	sendEvent(ctx, events, analysisEvent{Type: eventComplete})
}

// generateDimension runs one dimension under a single total budget. The
// deadline covers the optional entry lookup, the streamed model call and
// the one repair round-trip; it is never restarted for the repair call.
func (h *handler) generateDimension(ctx context.Context, request analyzeRequest, completed *contracts.Dimensions, dimension contracts.DimensionKey, progress func(llm.Progress)) (any, error) {
	dimensionContext, cancel := context.WithTimeout(ctx, h.timeouts.dimension)
	defer cancel()

	input := prompts.DimensionPromptInput{
		Draft:     request.Draft,
		Dimension: dimension,
		Completed: *completed,
	}
	// Word references ground dimension one in the queried entry's pronunciation
	// and senses as well as its etymology. Failed or empty lookups remain optional.
	if dimension == contracts.KeyOne {
		input.References = h.wordReferences(dimensionContext, request.Draft.Target)
	}
	messages := prompts.BuildDimensionMessages(input)

	switch dimension {
	case contracts.KeyOne:
		data, err := callDimension[contracts.DimensionOne](dimensionContext, request.Config, messages, contracts.NameDimensionOne, h.timeouts.dimension, progress)
		if err != nil {
			return nil, err
		}
		completed.One = &data
		return data, nil
	case contracts.KeyTwo:
		data, err := callDimension[contracts.DimensionTwo](dimensionContext, request.Config, messages, contracts.NameDimensionTwo, h.timeouts.dimension, progress)
		if err != nil {
			return nil, err
		}
		completed.Two = &data
		return data, nil
	case contracts.KeyThree:
		data, err := callDimension[contracts.DimensionThree](dimensionContext, request.Config, messages, contracts.NameDimensionThree, h.timeouts.dimension, progress)
		if err != nil {
			return nil, err
		}
		completed.Three = &data
		return data, nil
	default:
		return nil, fmt.Errorf("api: unknown dimension %q", dimension)
	}
}

func callDimension[T any](ctx context.Context, config contracts.Config, messages []llm.Message, schemaName contracts.Name, timeout time.Duration, progress func(llm.Progress)) (T, error) {
	return llm.CallJSON[T](llm.JSONRequest{
		Config:    llmConfig(config),
		Messages:  messages,
		Schema:    contracts.Lookup(schemaName),
		Context:   ctx,
		Timeout:   timeout,
		MaxTokens: dimensionMaxTokens,
		Stream:    true,
		Progress:  progress,
	})
}

// wordReferences preserves the source headword and section of retrieved facts.
// An error or empty result is non-fatal and returns nil.
func (h *handler) wordReferences(ctx context.Context, target string) []prompts.EtymologyReference {
	if h.wiktionary == nil {
		return nil
	}
	references, err := h.wiktionary.LookupEntry(ctx, target)
	if err != nil || len(references) == 0 {
		return nil
	}
	converted := make([]prompts.EtymologyReference, 0, len(references))
	for _, reference := range references {
		if strings.TrimSpace(reference.Text) == "" {
			continue
		}
		converted = append(converted, prompts.EtymologyReference{
			Headword: reference.Headword,
			Section:  reference.Section,
			Text:     reference.Text,
			URL:      reference.URL,
		})
	}
	return converted
}

func hasDimension(dimensions contracts.Dimensions, dimension contracts.DimensionKey) bool {
	switch dimension {
	case contracts.KeyOne:
		return dimensions.One != nil
	case contracts.KeyTwo:
		return dimensions.Two != nil
	case contracts.KeyThree:
		return dimensions.Three != nil
	default:
		return false
	}
}

func sendEvent(ctx context.Context, events chan<- analysisEvent, event analysisEvent) bool {
	select {
	case events <- event:
		return true
	case <-ctx.Done():
		return false
	}
}

// progressReporter throttles the streaming progress of one dimension. It
// counts visible body characters only, always forwards a phase change, always
// emits the final count and stops as soon as the client goes away.
func progressReporter(ctx context.Context, events chan<- analysisEvent, dimension contracts.DimensionKey, interval time.Duration) func(llm.Progress) {
	reporter := &dimensionProgress{
		ctx:       ctx,
		events:    events,
		dimension: dimension,
		interval:  interval,
	}
	return reporter.report
}

type dimensionProgress struct {
	ctx       context.Context
	events    chan<- analysisEvent
	dimension contracts.DimensionKey
	interval  time.Duration

	stopped   bool
	sent      bool
	lastSent  time.Time
	lastChars int
	lastPhase llm.Phase
}

func (p *dimensionProgress) report(progress llm.Progress) {
	if p == nil || p.stopped {
		return
	}

	phaseChanged := progress.Phase != p.lastPhase
	if !progress.Final && !phaseChanged && p.sent && time.Since(p.lastSent) < p.interval {
		return
	}
	if progress.Final && !phaseChanged && p.sent && progress.ReceivedChars == p.lastChars {
		return
	}

	p.send(progress.Phase, progress.ReceivedChars)
}

func (p *dimensionProgress) send(phase llm.Phase, receivedChars int) {
	p.lastPhase = phase
	p.lastChars = receivedChars
	p.lastSent = time.Now()
	p.sent = true

	count := receivedChars
	if !sendEvent(p.ctx, p.events, analysisEvent{
		Type:          eventDimensionProgress,
		Dimension:     p.dimension,
		ReceivedChars: &count,
		Phase:         string(phase),
	}) {
		p.stopped = true
	}
}

type sseWriter struct {
	response http.ResponseWriter
	flusher  http.Flusher
	closed   bool
}

func (w *sseWriter) event(event analysisEvent) bool {
	data, err := json.Marshal(event)
	if err != nil {
		w.closed = true
		return false
	}
	return w.writeLine("data: " + string(data) + "\n\n")
}

func (w *sseWriter) comment(text string) bool {
	return w.writeLine(text)
}

func (w *sseWriter) writeLine(line string) bool {
	if w.closed {
		return false
	}
	if _, err := io.WriteString(w.response, line); err != nil {
		w.closed = true
		return false
	}
	if w.flusher != nil {
		w.flusher.Flush()
	}
	return true
}
