package api

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func exportCard(id, kind, front, back string, tags []string) map[string]any {
	tagValues := make([]any, 0, len(tags))
	for _, tag := range tags {
		tagValues = append(tagValues, tag)
	}
	return map[string]any{
		"id":    id,
		"type":  kind,
		"front": front,
		"back":  back,
		"tags":  tagValues,
	}
}

func exportCards() []any {
	return []any{
		exportCard("card-core", "core", "nostalgia", "核心义\n释义", []string{"lexigene", "type::core"}),
		exportCard("card-chunk", "chunk", "a wave of nostalgia", "一阵怀念\nA wave hit me.", []string{"lexigene", "type::chunk"}),
	}
}

func readBytes(t *testing.T, response *http.Response) []byte {
	t.Helper()
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	return data
}

func archiveNotes(t *testing.T, archive []byte) []string {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	var collection []byte
	names := make([]string, 0, len(reader.File))
	for _, file := range reader.File {
		names = append(names, file.Name)
		if file.Name != "collection.anki2" {
			continue
		}
		handle, err := file.Open()
		if err != nil {
			t.Fatalf("open collection: %v", err)
		}
		collection, err = io.ReadAll(handle)
		handle.Close()
		if err != nil {
			t.Fatalf("read collection: %v", err)
		}
	}
	if collection == nil {
		t.Fatalf("collection.anki2 missing; entries = %v", names)
	}

	path := filepath.Join(t.TempDir(), "collection.anki2")
	if err := os.WriteFile(path, collection, 0o600); err != nil {
		t.Fatalf("write collection: %v", err)
	}
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer database.Close()
	rows, err := database.Query("SELECT flds FROM notes ORDER BY id")
	if err != nil {
		t.Fatalf("query notes: %v", err)
	}
	defer rows.Close()
	var notes []string
	for rows.Next() {
		var fields string
		if err := rows.Scan(&fields); err != nil {
			t.Fatalf("scan note: %v", err)
		}
		notes = append(notes, fields)
	}
	return notes
}

func TestExportAnkiReturnsDownloadablePackage(t *testing.T) {
	server := newTestServer(t, Options{}, testTimeouts())
	body := map[string]any{
		"deckName": "LexiGene",
		"cards":    exportCards(),
		"apiKey":   apiKeySentinel,
	}
	response := postJSON(t, server.URL, "/api/export/anki", body)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.StatusCode, responseText(t, response))
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "application/octet-stream" {
		t.Fatalf("content type = %q", contentType)
	}
	disposition := response.Header.Get("Content-Disposition")
	if !strings.Contains(disposition, "attachment") || !strings.Contains(disposition, "LexiGene.apkg") {
		t.Fatalf("content disposition = %q", disposition)
	}

	archive := readBytes(t, response)
	if response.Header.Get("Content-Length") != "" && response.Header.Get("Content-Length") != itoa(len(archive)) {
		t.Fatalf("content length = %q, actual %d", response.Header.Get("Content-Length"), len(archive))
	}
	if len(archive) < 2 || archive[0] != 0x50 || archive[1] != 0x4b {
		t.Fatalf("archive is not a ZIP: %x", archive[:2])
	}
	if bytes.Contains(archive, []byte(apiKeySentinel)) {
		t.Fatal("archive contains API credentials")
	}

	notes := archiveNotes(t, archive)
	if len(notes) != 2 {
		t.Fatalf("notes = %d", len(notes))
	}
	joined := strings.Join(notes, "\n")
	if !strings.Contains(joined, "核心义<br>释义") {
		t.Fatalf("note fields were not converted: %s", joined)
	}
	if !strings.Contains(joined, "a wave of nostalgia") {
		t.Fatalf("note fields missing card content: %s", joined)
	}
}

func itoa(value int) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func TestExportAnkiEscapesHTMLExactlyOnce(t *testing.T) {
	server := newTestServer(t, Options{}, testTimeouts())
	body := map[string]any{
		"deckName": "Safe",
		"cards": []any{
			exportCard("xss-card", "core", `<script>alert("x")</script>`, "first & second\nthird \"quoted\"", []string{"lexigene"}),
		},
	}
	archive := readBytes(t, postJSON(t, server.URL, "/api/export/anki", body))
	notes := archiveNotes(t, archive)
	if len(notes) != 1 {
		t.Fatalf("notes = %d", len(notes))
	}
	fields := strings.Split(notes[0], "\x1f")
	if fields[0] != "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;" {
		t.Fatalf("front = %q", fields[0])
	}
	if fields[1] != "first &amp; second<br>third &quot;quoted&quot;" {
		t.Fatalf("back = %q", fields[1])
	}
	if strings.Contains(notes[0], "<script>") {
		t.Fatal("unescaped script tag reached the archive")
	}
}

func TestExportAnkiDefaultsDeckName(t *testing.T) {
	server := newTestServer(t, Options{}, testTimeouts())
	response := postJSON(t, server.URL, "/api/export/anki", map[string]any{"cards": exportCards()})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if disposition := response.Header.Get("Content-Disposition"); !strings.Contains(disposition, "LexiGene.apkg") {
		t.Fatalf("content disposition = %q", disposition)
	}
	_ = readBytes(t, response)
}

func TestExportAnkiRejectsInvalidPayloads(t *testing.T) {
	server := newTestServer(t, Options{}, testTimeouts())

	longTags := make([]string, 0, 31)
	for index := 0; index < 31; index++ {
		longTags = append(longTags, "tag"+itoa(index))
	}
	manyCards := make([]any, 0, 1001)
	for index := 0; index < 1001; index++ {
		manyCards = append(manyCards, exportCard("card-"+itoa(index), "core", "front", "back", []string{}))
	}
	oversized := make([]any, 0, 140)
	for index := 0; index < 140; index++ {
		oversized = append(oversized, exportCard("bulk-"+itoa(index), "core", "front", strings.Repeat("y", 30_000), []string{}))
	}

	invalid := []any{
		map[string]any{},
		map[string]any{"cards": []any{}},
		map[string]any{"deckName": "", "cards": exportCards()},
		map[string]any{"deckName": "   ", "cards": exportCards()},
		map[string]any{"deckName": strings.Repeat("x", 81), "cards": exportCards()},
		map[string]any{"deckName": "bad\x00name", "cards": exportCards()},
		map[string]any{"cards": []any{exportCard("bad-type", "bogus", "front", "back", []string{})}},
		map[string]any{"cards": []any{exportCard("empty-front", "core", "", "back", []string{})}},
		map[string]any{"cards": []any{exportCard("control-front", "core", "\x00", "back", []string{})}},
		map[string]any{"cards": []any{exportCard("long-back", "core", "front", strings.Repeat("x", 30_001), []string{})}},
		map[string]any{"cards": []any{exportCard("many-tags", "core", "front", "back", longTags)}},
		map[string]any{"cards": manyCards},
		map[string]any{"cards": oversized},
		map[string]any{"cards": []any{exportCard("control-tag", "core", "front", "back", []string{"bad\x00tag"})}},
	}

	for _, body := range invalid {
		response := postJSON(t, server.URL, "/api/export/anki", body)
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("body %+v status = %d", body, response.StatusCode)
		}
		if contentType := response.Header.Get("Content-Type"); !strings.Contains(contentType, "application/json") {
			t.Fatalf("content type = %q", contentType)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(responseText(t, response)), &payload); err != nil {
			t.Fatalf("decode error response: %v", err)
		}
		if message, _ := payload["error"].(string); message == "" {
			t.Fatalf("missing error for %+v", body)
		}
	}

	nonJSON := postJSON(t, server.URL, "/api/export/anki", "not json")
	if nonJSON.StatusCode != http.StatusBadRequest {
		t.Fatalf("non-json status = %d", nonJSON.StatusCode)
	}
	if text := responseText(t, nonJSON); !strings.Contains(text, "Request body must be valid JSON") {
		t.Fatalf("non-json body = %s", text)
	}
}

func TestExportAnkiValidationIssuesCarryPaths(t *testing.T) {
	server := newTestServer(t, Options{}, testTimeouts())
	body := map[string]any{
		"deckName": "bad\x00name",
		"cards":    []any{exportCard("card-1", "core", "front", "back", []string{"bad\x00tag"})},
	}
	response := postJSON(t, server.URL, "/api/export/anki", body)
	var payload struct {
		Error  string        `json:"error"`
		Issues []exportIssue `json:"issues"`
	}
	data := []byte(responseText(t, response))
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("decode issues: %v", err)
	}
	if payload.Error != "Invalid export request" {
		t.Fatalf("error = %q", payload.Error)
	}
	paths := make([]string, 0, len(payload.Issues))
	for _, issue := range payload.Issues {
		paths = append(paths, issue.Path)
	}
	if !strings.Contains(strings.Join(paths, ","), "deckName") || !strings.Contains(strings.Join(paths, ","), "cards.0.tags.0") {
		t.Fatalf("issue paths = %v", paths)
	}
}

func TestExportFilenameHelpers(t *testing.T) {
	if safe := fileSafeName("词汇/牌组"); safe != "词汇_牌组" {
		t.Fatalf("fileSafeName = %q", safe)
	}
	if safe := fileSafeName("..."); safe != "LexiGene" {
		t.Fatalf("dot-only fileSafeName = %q", safe)
	}
	if ascii := asciiFilename("词汇.apkg"); ascii != "__.apkg" {
		t.Fatalf("asciiFilename = %q", ascii)
	}
	if encoded := encodeURIComponent("词汇.apkg"); encoded != "%E8%AF%8D%E6%B1%87.apkg" {
		t.Fatalf("encodeURIComponent = %q", encoded)
	}
	if path := dotPath("cards[0].tags[1]"); path != "cards.0.tags.1" {
		t.Fatalf("dotPath = %q", path)
	}
}

func TestExportAnkiClientCancel(t *testing.T) {
	handler := newHandler(Options{}, testTimeouts())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(http.MethodPost, "/api/export/anki", strings.NewReader(
		mustMarshal(t, map[string]any{"cards": exportCards()}),
	))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request.WithContext(ctx))

	if recorder.Code != 499 {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestHandlerRouting(t *testing.T) {
	server := newTestServer(t, Options{}, testTimeouts())

	method := postJSON(t, server.URL, "/api/unknown", map[string]any{})
	if method.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown path status = %d", method.StatusCode)
	}
	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/models", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET models: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("GET status = %d", response.StatusCode)
	}
}
