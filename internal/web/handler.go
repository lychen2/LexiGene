// Package web serves the browser preview using the same Go API as the desktop app.
package web

import (
	"compress/gzip"
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

func NewHandler(frontend fs.FS, api http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]string{"runtime": "go", "desktop": "mygo"})
	})
	mux.Handle("/api/", api)
	files := http.FileServerFS(frontend)
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		ext := path.Ext(r.URL.Path)
		text := ext == "" || ext == ".html" || ext == ".css" || ext == ".js" || ext == ".svg" || ext == ".json"
		w.Header().Add("Vary", "Accept-Encoding")
		if text && r.Method != http.MethodHead && r.Header.Get("Range") == "" && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			writer := gzip.NewWriter(w)
			defer writer.Close()
			w.Header().Set("Content-Encoding", "gzip")
			files.ServeHTTP(&gzipWriter{ResponseWriter: w, writer: writer}, r)
			return
		}
		files.ServeHTTP(w, r)
	}))
	return mux
}

type gzipWriter struct {
	http.ResponseWriter
	writer *gzip.Writer
}

func (w *gzipWriter) WriteHeader(status int) {
	w.Header().Del("Content-Length")
	if status >= 400 {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipWriter) Write(data []byte) (int, error) {
	w.Header().Del("Content-Length")
	return w.writer.Write(data)
}
