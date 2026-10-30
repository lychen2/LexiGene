package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Exercise the real outbound HTTP boundary without a paid model call.
// This establishes request binding, not model correctness or incident causality.
func TestFreshAnalysisKeepsQueryAtProviderBoundary(t *testing.T) {
	for _, references := range []bool{false, true} {
		name := "without_references"
		if references {
			name = "with_dingleberry_reference"
		}
		t.Run(name, func(t *testing.T) {
			provider, upstream := newMockProvider(t, providerFailure(http.StatusBadRequest, "{}"))
			options := Options{}
			if references {
				wiki := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Query().Get("page") != "dingleberry" {
						t.Errorf("dictionary query changed to %q", r.URL.Query().Get("page"))
					}
					w.Header().Set("Content-Type", "application/json")
					if r.URL.Query().Get("prop") == "sections" {
						_, _ = io.WriteString(w, `{"parse":{"title":"dingleberry","sections":[{"level":"2","line":"English","index":"1"},{"level":"3","line":"Etymology","index":"2"},{"level":"3","line":"Pronunciation","index":"3"},{"level":"3","line":"Noun","index":"4"}]}}`)
						return
					}
					// Public Wiktionary excerpts retrieved during investigation.
					switch r.URL.Query().Get("section") {
					case "2":
						_, _ = io.WriteString(w, `{"parse":{"title":"dingleberry","text":"<h3>Etymology</h3><p>A (possibly dialectal) alteration of <i>dangleberry</i>.</p>"}}`)
					case "3":
						_, _ = io.WriteString(w, `{"parse":{"title":"dingleberry","text":"<h3>Pronunciation</h3><ul><li>IPA: /ˈdɪŋɡəɫbɛɹi/</li></ul>"}}`)
					case "4":
						_, _ = io.WriteString(w, `{"parse":{"title":"dingleberry","text":"<h3>Noun</h3><ol><li>Vaccinium erythrocarpum, the southern mountain cranberry.</li><li>(slang, derogatory) A stupid or foolish person.</li><li>(slang) Dried fecal matter adhering to anal hair.</li></ol>"}}`)
					}
				}))
				t.Cleanup(wiki.Close)
				options.Wiktionary = wikiClient(t, wiki)
			}
			server := newTestServer(t, options, testTimeouts())
			body := analyzeBody(upstream.URL, nil)
			body["draft"].(map[string]any)["target"] = "dingleberry"
			body["config"].(map[string]any)["model"] = "deepseek-v4.1-flash"
			events := readStructuralSSE(t, postJSON(t, server.URL, "/api/analyze", body).Body)
			if provider.count() != 1 || len(events) != 2 || events[1].Type != "error" {
				t.Fatalf("expected one intercepted outbound request: calls %d, events %v", provider.count(), eventTypes(events))
			}
			request := provider.request(0)
			messages := upstreamMessages(request)
			if request.body["model"] != "deepseek-v4.1-flash" || len(messages) != 2 {
				t.Fatalf("model or conversation changed: model %v, messages %d", request.body["model"], len(messages))
			}
			if !strings.Contains(messages[0]["content"].(string), "目标词：dingleberry") ||
				!strings.Contains(messages[1]["content"].(string), "请生成目标词「dingleberry」的第 一 维内容") {
				t.Fatal("query was lost before reaching provider")
			}
			prompt := upstreamPrompt(request)
			if strings.Contains(prompt, "anatomical") || strings.Contains(prompt, "nostalgia") {
				t.Fatal("another headword entered the outbound prompt")
			}
			if references != strings.Contains(prompt, "dangleberry") {
				t.Fatal("reference was changed or injected unexpectedly")
			}
			if references {
				for _, fact := range []string{"headword: dingleberry", "section: Pronunciation", "/ˈdɪŋɡəɫbɛɹi/", "section: Noun", "(slang, derogatory) A stupid or foolish person.", "(slang) Dried fecal matter adhering to anal hair.", "section: Etymology", "A (possibly dialectal) alteration of dangleberry."} {
					if !strings.Contains(prompt, fact) {
						t.Fatalf("queried entry fact missing from provider request: %q", fact)
					}
				}
			}
			t.Logf("model=%s, target=dingleberry in system and user messages, messages=%d, other-headword=false, calls=1", request.body["model"], len(messages))
		})
	}
}
