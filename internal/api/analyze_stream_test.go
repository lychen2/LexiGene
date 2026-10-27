package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"lexigene/internal/contracts"
)

type pumpedEvent struct {
	event sseEvent
	err   error
}

// pumpEvents parses SSE events as they arrive so a test can observe progress
// before the upstream stream has finished.
func pumpEvents(reader io.Reader) <-chan pumpedEvent {
	events := make(chan pumpedEvent, 64)
	go func() {
		defer close(events)
		buffered := bufio.NewReader(reader)
		for {
			event, ok, err := parseSSEEvent(buffered)
			if err != nil {
				events <- pumpedEvent{err: err}
				return
			}
			if !ok {
				return
			}
			events <- pumpedEvent{event: event}
		}
	}()
	return events
}

func nextEvent(t *testing.T, events <-chan pumpedEvent) sseEvent {
	t.Helper()
	select {
	case item, ok := <-events:
		if !ok {
			t.Fatal("SSE stream ended unexpectedly")
		}
		if item.err != nil {
			t.Fatalf("read SSE event: %v", item.err)
		}
		return item.event
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for an SSE event")
		return sseEvent{}
	}
}

func remainingEvents(t *testing.T, events <-chan pumpedEvent) []sseEvent {
	t.Helper()
	collected := make([]sseEvent, 0, 16)
	for item := range events {
		if item.err != nil {
			t.Fatalf("read SSE event: %v", item.err)
		}
		collected = append(collected, item.event)
	}
	return collected
}

func sseTruncatedAt(content string) []string {
	return append([]string{sseDelta(content)}, sseFinish("length")...)
}

func progressOf(events []sseEvent, dimension contracts.DimensionKey) []sseEvent {
	selected := make([]sseEvent, 0, 8)
	for _, event := range events {
		if event.Type == "dimension-progress" && event.Dimension == dimension {
			selected = append(selected, event)
		}
	}
	return selected
}

// assertProgressPayload checks the agreed wire shape and that no body,
// reasoning or prompt text is carried by a progress event.
func assertProgressPayload(t *testing.T, event sseEvent) {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal([]byte(event.Raw), &payload); err != nil {
		t.Fatalf("decode progress payload %q: %v", event.Raw, err)
	}
	wanted := map[string]bool{"type": true, "dimension": true, "receivedChars": true, "phase": true}
	for key := range payload {
		if !wanted[key] {
			t.Fatalf("progress payload has unexpected field %q: %s", key, event.Raw)
		}
	}
	for key := range wanted {
		if _, ok := payload[key]; !ok {
			t.Fatalf("progress payload misses %q: %s", key, event.Raw)
		}
	}
	if _, ok := payload["receivedChars"].(float64); !ok {
		t.Fatalf("receivedChars is not a number: %s", event.Raw)
	}
	phase, _ := payload["phase"].(string)
	if phase != "thinking" && phase != "generating" && phase != "repairing" {
		t.Fatalf("unexpected phase %q", phase)
	}
}

func bodyCharCount(content string) int {
	return utf8.RuneCountInString(strings.TrimSpace(content))
}

func TestAnalyzeReportsProgressBeforeCompletingADimension(t *testing.T) {
	gate := make(chan struct{})
	fixtureOne := fixture("dimension-one.json")
	provider, upstream := newMockProvider(t,
		mockResponse{sse: sseContentFrames(fixtureOne, 16), gate: gate, gateAfter: 1},
		mockResponse{sse: sseContent(fixture("dimension-two.json"))},
		mockResponse{sse: sseContent(fixture("dimension-three.json"))},
	)
	server := newTestServer(t, Options{}, testTimeouts())

	response := postJSON(t, server.URL, "/api/analyze", analyzeBody(upstream.URL+"/v1", nil))
	pumped := pumpEvents(response.Body)

	events := make([]sseEvent, 0, 24)
	var firstProgress sseEvent
	deadline := time.After(3 * time.Second)
waitProgress:
	for {
		select {
		case item, ok := <-pumped:
			if !ok {
				t.Fatal("analyze stream ended before any progress event")
			}
			if item.err != nil {
				t.Fatalf("read SSE event: %v", item.err)
			}
			events = append(events, item.event)
			if item.event.Type == "dimension-progress" {
				firstProgress = item.event
				break waitProgress
			}
		case <-deadline:
			t.Fatal("no progress event arrived while the upstream stream was still open")
		}
	}

	// The upstream call is still blocked at this point: progress has already
	// reached the client, proving it is streamed rather than emitted at the end.
	if firstProgress.Dimension != contracts.KeyOne || firstProgress.Phase != "generating" {
		t.Fatalf("first progress = %+v", firstProgress)
	}
	if firstProgress.ReceivedChars == nil || *firstProgress.ReceivedChars == 0 {
		t.Fatalf("first progress count = %v", firstProgress.ReceivedChars)
	}
	if *firstProgress.ReceivedChars >= bodyCharCount(fixtureOne) {
		t.Fatalf("progress %d already equals the final count", *firstProgress.ReceivedChars)
	}
	assertProgressPayload(t, firstProgress)

	close(gate)
	events = append(events, remainingEvents(t, pumped)...)

	if got := eventTypes(structuralEvents(events)); !reflect.DeepEqual(got, []string{
		"dimension-start", "dimension-complete",
		"dimension-start", "dimension-complete",
		"dimension-start", "dimension-complete",
		"complete",
	}) {
		t.Fatalf("structural events = %v", got)
	}

	for index, name := range []string{"dimension-one.json", "dimension-two.json", "dimension-three.json"} {
		dimension := contracts.DimensionOrder[index]
		progress := progressOf(events, dimension)
		if len(progress) == 0 {
			t.Fatalf("dimension %q reported no progress", dimension)
		}
		for _, event := range progress {
			assertProgressPayload(t, event)
		}
		final := progress[len(progress)-1]
		if final.Phase != "generating" {
			t.Fatalf("dimension %q final phase = %q", dimension, final.Phase)
		}
		if final.ReceivedChars == nil || *final.ReceivedChars != bodyCharCount(fixture(name)) {
			t.Fatalf("dimension %q final count = %v, want %d", dimension, final.ReceivedChars, bodyCharCount(fixture(name)))
		}
	}

	if provider.count() != 3 {
		t.Fatalf("upstream calls = %d", provider.count())
	}
	for index := 0; index < 3; index++ {
		request := provider.request(index)
		if request.body["stream"] != true {
			t.Fatalf("call %d stream = %v", index, request.body["stream"])
		}
		if request.body["max_tokens"] != float64(32_768) {
			t.Fatalf("call %d max_tokens = %v", index, request.body["max_tokens"])
		}
	}
}

func TestAnalyzeTruncatedStreamIsABudgetErrorWithoutRepair(t *testing.T) {
	provider, upstream := newMockProvider(t,
		mockResponse{sse: sseTruncatedAt(`{"overview":`)},
		mockResponse{sse: sseContent(fixture("dimension-two.json"))},
	)
	server := newTestServer(t, Options{}, testTimeouts())

	events := readSSE(t, postJSON(t, server.URL, "/api/analyze", analyzeBody(upstream.URL+"/v1", nil)).Body)
	structural := structuralEvents(events)
	if got := eventTypes(structural); !reflect.DeepEqual(got, []string{"dimension-start", "error"}) {
		t.Fatalf("events = %v", got)
	}
	if structural[1].Dimension != contracts.KeyOne {
		t.Fatalf("error dimension = %q", structural[1].Dimension)
	}
	if !strings.Contains(structural[1].Message, "32768") || !strings.Contains(structural[1].Message, "截断") {
		t.Fatalf("budget message = %q", structural[1].Message)
	}
	if provider.count() != 1 {
		t.Fatalf("upstream calls = %d, want no repair and no later dimension", provider.count())
	}
	for _, event := range events {
		if event.Type == "dimension-complete" || event.Type == "complete" {
			t.Fatalf("truncated generation reported %q", event.Type)
		}
	}
	partial := progressOf(events, contracts.KeyOne)
	if len(partial) == 0 || partial[len(partial)-1].ReceivedChars == nil || *partial[len(partial)-1].ReceivedChars == 0 {
		t.Fatalf("partial progress = %+v", partial)
	}
}

func TestAnalyzeRepairStreamsWithRepairingPhaseAndSameCap(t *testing.T) {
	provider, upstream := newMockProvider(t,
		mockResponse{sse: sseContent("not json")},
		mockResponse{sse: sseContent(fixture("dimension-one.json"))},
		mockResponse{sse: sseContent(fixture("dimension-two.json"))},
		mockResponse{sse: sseContent(fixture("dimension-three.json"))},
	)
	server := newTestServer(t, Options{}, testTimeouts())

	events := readSSE(t, postJSON(t, server.URL, "/api/analyze", analyzeBody(upstream.URL+"/v1", nil)).Body)
	if got := eventTypes(structuralEvents(events)); !reflect.DeepEqual(got, []string{
		"dimension-start", "dimension-complete",
		"dimension-start", "dimension-complete",
		"dimension-start", "dimension-complete",
		"complete",
	}) {
		t.Fatalf("structural events = %v", got)
	}
	if provider.count() != 4 {
		t.Fatalf("upstream calls = %d, want the three dimensions plus one repair", provider.count())
	}
	for index := 0; index < provider.count(); index++ {
		request := provider.request(index)
		if request.body["stream"] != true {
			t.Fatalf("call %d stream = %v", index, request.body["stream"])
		}
		if request.body["max_tokens"] != float64(32_768) {
			t.Fatalf("call %d max_tokens = %v", index, request.body["max_tokens"])
		}
	}
	if !strings.Contains(upstreamPrompt(provider.request(1)), "不是合法的 JSON 对象") {
		t.Fatal("the second call was not the repair round-trip")
	}

	oneProgress := progressOf(events, contracts.KeyOne)
	sawGenerating := false
	sawRepairingChars := false
	for _, event := range oneProgress {
		if event.Phase == "generating" {
			sawGenerating = true
		}
		if event.Phase == "repairing" && event.ReceivedChars != nil && *event.ReceivedChars > 0 {
			sawRepairingChars = true
		}
	}
	if !sawGenerating || !sawRepairingChars {
		t.Fatalf("dimension one progress = %+v", oneProgress)
	}
	final := oneProgress[len(oneProgress)-1]
	if final.Phase != "repairing" || final.ReceivedChars == nil ||
		*final.ReceivedChars != bodyCharCount(fixture("dimension-one.json")) {
		t.Fatalf("repair final progress = %+v", final)
	}
}

func TestAnalyzeThrottlesProgressButSendsPhaseChangesAndFinalCounts(t *testing.T) {
	budget := testTimeouts()
	budget.progress = time.Hour

	reasoning := sseData(map[string]any{
		"choices": []any{map[string]any{"delta": map[string]any{"reasoning_content": "SECRET_REASONING"}}},
	})
	frames := append([]string{reasoning}, sseContentFrames(fixture("dimension-one.json"), 16)...)
	provider, upstream := newMockProvider(t,
		mockResponse{sse: frames},
		completionFixture("dimension-two.json"),
		completionFixture("dimension-three.json"),
	)
	server := newTestServer(t, Options{}, budget)

	events := readSSE(t, postJSON(t, server.URL, "/api/analyze", analyzeBody(upstream.URL+"/v1", nil)).Body)
	if provider.count() != 3 {
		t.Fatalf("upstream calls = %d", provider.count())
	}

	oneProgress := progressOf(events, contracts.KeyOne)
	if len(oneProgress) != 3 {
		t.Fatalf("dimension one progress = %+v, want thinking, first generating and final", oneProgress)
	}
	if oneProgress[0].Phase != "thinking" || oneProgress[0].ReceivedChars == nil || *oneProgress[0].ReceivedChars != 0 {
		t.Fatalf("thinking progress = %+v", oneProgress[0])
	}
	if oneProgress[1].Phase != "generating" || oneProgress[1].ReceivedChars == nil {
		t.Fatalf("generating progress = %+v", oneProgress[1])
	}
	if *oneProgress[1].ReceivedChars != 16 {
		t.Fatalf("first generating count = %d, want the first chunk", *oneProgress[1].ReceivedChars)
	}
	if oneProgress[2].Phase != "generating" || oneProgress[2].ReceivedChars == nil ||
		*oneProgress[2].ReceivedChars != bodyCharCount(fixture("dimension-one.json")) {
		t.Fatalf("final progress = %+v", oneProgress[2])
	}
	for _, event := range oneProgress {
		if strings.Contains(event.Raw, "SECRET_REASONING") {
			t.Fatal("reasoning text leaked into a progress event")
		}
	}

	// Dimensions two and three answered with ordinary JSON: the final count is
	// still reported so consumers see generation progress.
	for _, dimension := range []contracts.DimensionKey{contracts.KeyTwo, contracts.KeyThree} {
		progress := progressOf(events, dimension)
		if len(progress) != 1 || progress[0].Phase != "generating" {
			t.Fatalf("dimension %q progress = %+v", dimension, progress)
		}
	}
	if got := progressOf(events, contracts.KeyTwo)[0].ReceivedChars; got == nil || *got != bodyCharCount(fixture("dimension-two.json")) {
		t.Fatalf("dimension two final count = %v", got)
	}
	if got := progressOf(events, contracts.KeyThree)[0].ReceivedChars; got == nil || *got != bodyCharCount(fixture("dimension-three.json")) {
		t.Fatalf("dimension three final count = %v", got)
	}
}

func TestAnalyzeStreamedDeadlineIsReportedAsASanitizedTimeout(t *testing.T) {
	gate := make(chan struct{})
	provider, upstream := newMockProvider(t,
		mockResponse{sse: sseContentFrames(fixture("dimension-one.json"), 16), gate: gate, gateAfter: 1},
	)
	budget := testTimeouts()
	budget.dimension = 250 * time.Millisecond
	server := newTestServer(t, Options{}, budget)

	events := readSSE(t, postJSON(t, server.URL, "/api/analyze", analyzeBody(upstream.URL+"/v1", nil)).Body)
	structural := structuralEvents(events)
	if got := eventTypes(structural); !reflect.DeepEqual(got, []string{"dimension-start", "error"}) {
		t.Fatalf("events = %v", got)
	}
	if structural[1].Dimension != contracts.KeyOne || !strings.Contains(structural[1].Message, "模型响应超时") {
		t.Fatalf("timeout error = %+v", structural[1])
	}
	if provider.count() != 1 {
		t.Fatalf("upstream calls = %d", provider.count())
	}
	provider.waitCanceled(t)
}

func TestAnalyzeClientCancelStopsStreamedProgressWithoutTerminalEvents(t *testing.T) {
	gate := make(chan struct{})
	provider, upstream := newMockProvider(t,
		mockResponse{sse: sseContentFrames(fixture("dimension-one.json"), 16), gate: gate, gateAfter: 1},
	)
	server := newTestServer(t, Options{}, testTimeouts())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	response := postJSONContext(t, ctx, server.URL, "/api/analyze", analyzeBody(upstream.URL+"/v1", nil))
	pumped := pumpEvents(response.Body)

	for {
		event := nextEvent(t, pumped)
		if event.Type == "dimension-progress" {
			break
		}
	}
	cancel()
	provider.waitCanceled(t)

	rest := make([]sseEvent, 0, 8)
	for item := range pumped {
		if item.err != nil {
			// The canceled client connection is the expected way this read ends.
			if errors.Is(item.err, context.Canceled) {
				continue
			}
			t.Fatalf("read SSE event: %v", item.err)
		}
		rest = append(rest, item.event)
	}
	for _, event := range rest {
		if event.Type == "error" || event.Type == "complete" {
			t.Fatalf("cancellation produced a terminal %q event", event.Type)
		}
	}
}
