package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"lexigene/internal/contracts"
	"lexigene/internal/wiktionary"
)

type mockResponse struct {
	status int
	body   string
	hang   bool
	delay  time.Duration
	// sse makes the mock answer with a flushed text/event-stream body. The
	// frames are written verbatim so tests control chunk boundaries.
	sse      []string
	frameGap time.Duration
	// gate blocks the stream after gateAfter frames until the test closes it,
	// which lets a test observe progress while the upstream call is open.
	gate      chan struct{}
	gateAfter int
}

type mockRequest struct {
	path    string
	query   string
	headers http.Header
	body    map[string]any
	rawBody string
}

type mockProvider struct {
	mu        sync.Mutex
	responses []mockResponse
	requests  []mockRequest
	canceled  chan struct{}
}

func newMockProvider(t *testing.T, responses ...mockResponse) (*mockProvider, *httptest.Server) {
	t.Helper()
	provider := &mockProvider{responses: responses, canceled: make(chan struct{}, 16)}
	server := httptest.NewServer(provider)
	t.Cleanup(server.Close)
	return provider, server
}

func (p *mockProvider) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	raw, _ := io.ReadAll(request.Body)
	recorded := mockRequest{
		path:    request.URL.Path,
		query:   request.URL.RawQuery,
		headers: request.Header.Clone(),
		rawBody: string(raw),
	}
	_ = json.Unmarshal(raw, &recorded.body)

	p.mu.Lock()
	p.requests = append(p.requests, recorded)
	next := mockResponse{status: http.StatusOK}
	if len(p.responses) > 0 {
		next = p.responses[0]
		p.responses = p.responses[1:]
	}
	p.mu.Unlock()

	if next.delay > 0 {
		select {
		case <-time.After(next.delay):
		case <-request.Context().Done():
			select {
			case p.canceled <- struct{}{}:
			default:
			}
			return
		}
	}
	if next.hang {
		<-request.Context().Done()
		select {
		case p.canceled <- struct{}{}:
		default:
		}
		return
	}
	if next.status == 0 {
		next.status = http.StatusOK
	}
	if len(next.sse) > 0 {
		writeMockStream(p, response, request, next)
		return
	}
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(next.status)
	_, _ = io.WriteString(response, next.body)
}

func writeMockStream(p *mockProvider, response http.ResponseWriter, request *http.Request, next mockResponse) {
	response.Header().Set("Content-Type", "text/event-stream")
	response.WriteHeader(next.status)
	flusher, _ := response.(http.Flusher)
	if flusher != nil {
		flusher.Flush()
	}
	reportCanceled := func() {
		select {
		case p.canceled <- struct{}{}:
		default:
		}
	}
	for index, frame := range next.sse {
		if next.gate != nil && index == next.gateAfter {
			select {
			case <-next.gate:
			case <-request.Context().Done():
				reportCanceled()
				return
			}
		}
		if next.frameGap > 0 && index > 0 {
			select {
			case <-time.After(next.frameGap):
			case <-request.Context().Done():
				reportCanceled()
				return
			}
		}
		if _, err := io.WriteString(response, frame); err != nil {
			return
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
}

func (p *mockProvider) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.requests)
}

func (p *mockProvider) request(index int) mockRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	if index >= len(p.requests) {
		return mockRequest{}
	}
	return p.requests[index]
}

func (p *mockProvider) waitForCalls(t *testing.T, expected int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for p.count() < expected {
		if time.Now().After(deadline) {
			t.Fatalf("upstream calls = %d, want at least %d", p.count(), expected)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func (p *mockProvider) waitCanceled(t *testing.T) {
	t.Helper()
	select {
	case <-p.canceled:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream request was not canceled")
	}
}

func testTimeouts() timeouts {
	return timeouts{
		dimension:  2 * time.Second,
		grade:      2 * time.Second,
		hints:      2 * time.Second,
		connection: 2 * time.Second,
		models:     2 * time.Second,
		heartbeat:  time.Hour,
		progress:   250 * time.Millisecond,
	}
}

func newTestServer(t *testing.T, options Options, budget timeouts) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(newHandler(options, budget))
	t.Cleanup(server.Close)
	return server
}

func fixture(name string) string {
	data, err := os.ReadFile(filepath.Join("..", "contracts", "testdata", name))
	if err != nil {
		panic(err)
	}
	return string(data)
}

func fixtureMap(t *testing.T, name string) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal([]byte(fixture(name)), &value); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	return value
}

func dimensionOneFixture(t *testing.T) contracts.DimensionOne {
	t.Helper()
	var value contracts.DimensionOne
	if err := json.Unmarshal([]byte(fixture("dimension-one.json")), &value); err != nil {
		t.Fatalf("decode dimension one: %v", err)
	}
	return value
}

func dimensionTwoFixture(t *testing.T) contracts.DimensionTwo {
	t.Helper()
	var value contracts.DimensionTwo
	if err := json.Unmarshal([]byte(fixture("dimension-two.json")), &value); err != nil {
		t.Fatalf("decode dimension two: %v", err)
	}
	return value
}

func dimensionThreeFixture(t *testing.T) contracts.DimensionThree {
	t.Helper()
	var value contracts.DimensionThree
	if err := json.Unmarshal([]byte(fixture("dimension-three.json")), &value); err != nil {
		t.Fatalf("decode dimension three: %v", err)
	}
	return value
}

func configFor(baseURL string) map[string]any {
	return map[string]any{"baseUrl": baseURL, "apiKey": "{{SECRET_api_test}}", "model": "gpt-4o-mini"}
}

func draftBody(dimensions map[string]any) map[string]any {
	if dimensions == nil {
		dimensions = map[string]any{}
	}
	return map[string]any{
		"schemaVersion": 1,
		"id":            "draft-1",
		"createdAt":     "2026-10-27T00:00:00.000Z",
		"target":        "nostalgia",
		"language":      "美式英语",
		"dimensions":    dimensions,
	}
}

func analyzeBody(baseURL string, dimensions map[string]any) map[string]any {
	return map[string]any{"config": configFor(baseURL), "draft": draftBody(dimensions)}
}

func completionOf(content string) mockResponse {
	envelope, _ := json.Marshal(map[string]any{
		"choices": []any{map[string]any{"message": map[string]any{"content": content}}},
	})
	return mockResponse{body: string(envelope)}
}

func completionFixture(name string) mockResponse { return completionOf(fixture(name)) }

func providerFailure(status int, body string) mockResponse {
	return mockResponse{status: status, body: body}
}

func parseJSONBody[T any](t *testing.T, response *http.Response) T {
	t.Helper()
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	var value T
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatalf("decode response %q: %v", data, err)
	}
	return value
}

func responseText(t *testing.T, response *http.Response) string {
	t.Helper()
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	return string(data)
}

func postJSON(t *testing.T, serverURL, path string, body any) *http.Response {
	t.Helper()
	return postJSONContext(t, context.Background(), serverURL, path, body)
}

func postJSONContext(t *testing.T, ctx context.Context, serverURL, path string, body any) *http.Response {
	t.Helper()
	var reader io.Reader
	if text, ok := body.(string); ok {
		reader = strings.NewReader(text)
	} else {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		reader = strings.NewReader(string(data))
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, serverURL+path, reader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("post %s: %v", path, err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func upstreamMessages(request mockRequest) []map[string]any {
	raw, _ := request.body["messages"].([]any)
	messages := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		record, _ := item.(map[string]any)
		messages = append(messages, record)
	}
	return messages
}

func upstreamPrompt(request mockRequest) string {
	var builder strings.Builder
	for _, message := range upstreamMessages(request) {
		content, _ := message["content"].(string)
		builder.WriteString(content)
		builder.WriteString("\n")
	}
	return builder.String()
}

type sseEvent struct {
	Type          string                 `json:"type"`
	Dimension     contracts.DimensionKey `json:"dimension"`
	Data          json.RawMessage        `json:"data"`
	Message       string                 `json:"message"`
	ReceivedChars *int                   `json:"receivedChars"`
	Phase         string                 `json:"phase"`
	// Raw keeps the decoded JSON payload so tests can assert the exact wire
	// shape of one event.
	Raw string `json:"-"`
}

// structuralEvents drops dimension-progress events so protocol tests can
// assert dimension ordering without depending on streaming cadence.
func structuralEvents(events []sseEvent) []sseEvent {
	filtered := make([]sseEvent, 0, len(events))
	for _, event := range events {
		if event.Type == "dimension-progress" {
			continue
		}
		filtered = append(filtered, event)
	}
	return filtered
}

func readStructuralSSE(t *testing.T, reader io.Reader) []sseEvent {
	t.Helper()
	return structuralEvents(readSSE(t, reader))
}

func readSSE(t *testing.T, reader io.Reader) []sseEvent {
	t.Helper()
	buffered := bufio.NewReader(reader)

	events := make([]sseEvent, 0, 8)
	for {
		event, ok := nextSSEEvent(t, buffered)
		if !ok {
			break
		}
		events = append(events, event)
	}
	return events
}

func nextSSEEvent(t *testing.T, reader *bufio.Reader) (sseEvent, bool) {
	t.Helper()
	event, ok, err := parseSSEEvent(reader)
	if err != nil {
		t.Fatalf("decode SSE event: %v", err)
	}
	return event, ok
}

func parseSSEEvent(reader *bufio.Reader) (sseEvent, bool, error) {
	dataLines := make([]string, 0, 1)
	for {
		line, err := reader.ReadString('\n')
		if err != nil && line == "" {
			if !errors.Is(err, io.EOF) {
				return sseEvent{}, false, err
			}
			return sseEvent{}, false, nil
		}
		line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
		if line == "" {
			if len(dataLines) == 0 {
				continue
			}
			payload := strings.Join(dataLines, "\n")
			dataLines = dataLines[:0]
			var event sseEvent
			event.Raw = payload
			if err := json.Unmarshal([]byte(payload), &event); err != nil {
				return sseEvent{}, false, err
			}
			return event, true, nil
		}
		if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
}

func sseData(payload any) string {
	data, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}
	return "data: " + string(data) + "\n\n"
}

func sseDelta(content string) string {
	return sseData(map[string]any{
		"choices": []any{map[string]any{"delta": map[string]any{"content": content}}},
	})
}

func sseFinish(reason string) []string {
	return []string{
		sseData(map[string]any{
			"choices": []any{map[string]any{"delta": map[string]any{}, "finish_reason": reason}},
		}),
		"data: [DONE]\n\n",
	}
}

// sseContentFrames splits content by runes so multi-byte characters are never
// cut inside an SSE frame, then closes the stream normally.
func sseContentFrames(content string, chunkRunes int) []string {
	runes := []rune(content)
	if chunkRunes <= 0 {
		chunkRunes = len(runes)
	}
	frames := make([]string, 0, len(runes)/chunkRunes+2)
	for start := 0; start < len(runes); start += chunkRunes {
		end := start + chunkRunes
		if end > len(runes) {
			end = len(runes)
		}
		frames = append(frames, sseDelta(string(runes[start:end])))
	}
	return append(frames, sseFinish("stop")...)
}

func sseContent(content string) []string { return sseContentFrames(content, 32) }

type wikiMode string

const (
	wikiSuccess wikiMode = "success"
	wikiEmpty   wikiMode = "empty"
	wikiFailure wikiMode = "failure"
)

func newWikiServer(t *testing.T, mode wikiMode) (*httptest.Server, func() int) {
	t.Helper()
	var mu sync.Mutex
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		mu.Lock()
		calls++
		mu.Unlock()
		response.Header().Set("Content-Type", "application/json")
		if mode == wikiFailure {
			response.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(response, `{"error":"unavailable"}`)
			return
		}
		if request.URL.Query().Get("prop") == "sections" {
			if mode == wikiEmpty {
				_, _ = io.WriteString(response, `{"parse":{"title":"nostalgia","sections":[]}}`)
				return
			}
			_, _ = io.WriteString(response, `{"parse":{"title":"nostalgia","sections":[
				{"toclevel":1,"level":"2","line":"English","number":"1","index":"1"},
				{"toclevel":2,"level":"3","line":"Etymology","number":"2","index":"2"}]}}`)
			return
		}
		_, _ = io.WriteString(response, `{"parse":{"title":"nostalgia","text":"<h3>Etymology</h3><p>WIKI_ETYMOLOGY_MARKER from Greek nostos (homecoming) and algos (pain).</p>"}}`)
	}))
	t.Cleanup(server.Close)
	return server, func() int {
		mu.Lock()
		defer mu.Unlock()
		return calls
	}
}

func wikiClient(t *testing.T, server *httptest.Server) *wiktionary.Client {
	t.Helper()
	return wiktionary.NewClient(wiktionary.Options{
		Endpoint:  server.URL,
		UserAgent: "LexiGene tests",
		Timeout:   2 * time.Second,
	})
}
