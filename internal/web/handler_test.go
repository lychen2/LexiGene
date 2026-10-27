package web

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestStaticPreviewAndAPI(t *testing.T) {
	files := fstest.MapFS{
		"index.html":        {Data: []byte("<html lang=\"zh-CN\"><body>词汇研究台</body></html>")},
		"assets/app-123.js": {Data: []byte("console.log('LexiGene')")},
	}
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"type\":\"complete\"}\n\n"))
		w.(http.Flusher).Flush()
	})
	handler := NewHandler(files, api)
	request := httptest.NewRequest("GET", "/", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 200 || response.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("static response: %d %v", response.Code, response.Header())
	}
	reader, err := gzip.NewReader(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	body, err := io.ReadAll(reader)
	if err != nil || !strings.Contains(string(body), "词汇研究台") {
		t.Fatalf("invalid compressed HTML: %s, %v", body, err)
	}
	request = httptest.NewRequest("POST", "/api/analyze", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Header().Get("Content-Encoding") != "" || !response.Flushed || !strings.Contains(response.Body.String(), "complete") {
		t.Fatalf("SSE was modified: %v %s", response.Header(), response.Body.String())
	}
	for _, target := range []struct{ url, cache string }{
		{"/assets/app-123.js", "public, max-age=31536000, immutable"},
		{"/", "no-cache"},
		{"/api/health", "no-store"},
	} {
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", target.url, nil))
		if response.Code != 200 || response.Header().Get("Cache-Control") != target.cache {
			t.Fatalf("%s: %d %v", target.url, response.Code, response.Header())
		}
	}
}
