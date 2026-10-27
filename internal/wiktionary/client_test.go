package wiktionary

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

const testUserAgent = "LexiGeneTest/1.0 (etymology client tests; https://example.invalid/lexigene)"

// stubRequest records the parts of an API request the tests care about.
type stubRequest struct {
	action        string
	prop          string
	page          string
	section       string
	formatversion string
	redirects     string
	disableEdit   string
	userAgent     string
	accept        string
	rawQuery      string
}

type wikiStub struct {
	mu            sync.Mutex
	title         string
	sections      []map[string]any
	texts         map[string]string
	sectionStatus map[string]int
	status        int
	delay         time.Duration
	textDelay     time.Duration
	requests      []stubRequest
}

func (s *wikiStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	record := stubRequest{
		action:        query.Get("action"),
		prop:          query.Get("prop"),
		page:          query.Get("page"),
		section:       query.Get("section"),
		formatversion: query.Get("formatversion"),
		redirects:     query.Get("redirects"),
		disableEdit:   query.Get("disableeditsection"),
		userAgent:     r.Header.Get("User-Agent"),
		accept:        r.Header.Get("Accept"),
		rawQuery:      r.URL.RawQuery,
	}
	s.mu.Lock()
	s.requests = append(s.requests, record)
	textDelay := s.textDelay
	s.mu.Unlock()

	delay := s.delay
	if record.prop == "text" {
		delay += textDelay
	}
	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-r.Context().Done():
			return
		}
	}
	if s.status != 0 {
		w.WriteHeader(s.status)
		return
	}
	if record.action != "parse" {
		http.Error(w, "unsupported action", http.StatusBadRequest)
		return
	}

	switch record.prop {
	case "sections":
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"parse": map[string]any{
				"title":     s.title,
				"pageid":    61308,
				"redirects": []any{},
				"sections":  s.sections,
			},
		})
	case "text":
		if code := s.sectionStatus[record.section]; code != 0 {
			w.WriteHeader(code)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"parse": map[string]any{
				"title":  s.title,
				"pageid": 61308,
				"text":   s.texts[record.section],
			},
		})
	default:
		http.Error(w, "unsupported prop", http.StatusBadRequest)
	}
}

func (s *wikiStub) snapshot() []stubRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]stubRequest(nil), s.requests...)
}

func startStub(t *testing.T, stub *wikiStub) (*httptest.Server, *Client) {
	t.Helper()
	server := httptest.NewServer(stub)
	t.Cleanup(server.Close)
	client := NewClient(Options{
		Endpoint:   server.URL + "/w/api.php",
		UserAgent:  testUserAgent,
		HTTPClient: server.Client(),
		Timeout:    2 * time.Second,
	})
	return server, client
}

func newClientWithHandler(t *testing.T, handler http.Handler) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return NewClient(Options{
		Endpoint:   server.URL + "/w/api.php",
		UserAgent:  testUserAgent,
		HTTPClient: server.Client(),
		Timeout:    time.Second,
	})
}

// stubSection builds a formatversion=2 sections entry.
func stubSection(level int, line, index, anchor string) map[string]any {
	return map[string]any{
		"toclevel":   level - 1,
		"level":      fmt.Sprintf("%d", level),
		"line":       line,
		"number":     "1",
		"index":      index,
		"fromtitle":  "stub",
		"byteoffset": 0,
		"anchor":     anchor,
		"linkAnchor": anchor,
	}
}

func fetchedSectionIndexes(requests []stubRequest) []string {
	var indexes []string
	for _, request := range requests {
		if request.prop == "text" {
			indexes = append(indexes, request.section)
		}
	}
	return indexes
}

func hasSection(indexes []string, want string) bool {
	for _, index := range indexes {
		if index == want {
			return true
		}
	}
	return false
}

func requireNoReference(t *testing.T, references []Reference, err error) {
	t.Helper()
	if references != nil {
		t.Fatalf("references = %#v, want nil", references)
	}
	if err == nil {
		t.Fatal("error = nil, want a non-nil error")
	}
}

// bailSections mirrors the real page, which carries etymology headings for
// several languages after the English boundary.
func bailSections() []map[string]any {
	return []map[string]any{
		stubSection(2, "English", "1", "English"),
		stubSection(3, "Pronunciation", "2", "Pronunciation"),
		stubSection(3, "Etymology 1", "3", "Etymology_1"),
		stubSection(4, "Noun", "4", "Noun"),
		stubSection(4, "Translations", "5", "Translations"),
		stubSection(3, "Etymology 2", "6", "Etymology_2"),
		stubSection(4, "Verb", "7", "Verb"),
		stubSection(3, "Etymology 3", "8", "Etymology_3"),
		stubSection(4, "Noun", "9", "Noun_2"),
		stubSection(3, "Etymology 4", "10", "Etymology_4"),
		stubSection(3, "Anagrams", "11", "Anagrams"),
		stubSection(2, "Bouyei", "12", "Bouyei"),
		stubSection(3, "Etymology", "13", "Etymology"),
		stubSection(2, "Cimbrian", "14", "Cimbrian"),
		stubSection(3, "Etymology", "15", "Etymology"),
		stubSection(2, "French", "16", "French"),
		stubSection(3, "Etymology 1", "17", "Etymology_1"),
		stubSection(3, "Etymology 2", "18", "Etymology_2"),
		stubSection(2, "Latvian", "19", "Latvian"),
		stubSection(3, "Etymology", "20", "Etymology"),
		stubSection(2, "Palauan", "21", "Palauan"),
		stubSection(3, "Etymology", "22", "Etymology"),
	}
}

func TestLookupSelectsOnlyEnglishEtymologySections(t *testing.T) {
	stub := &wikiStub{
		title:    "bail",
		sections: bailSections(),
		texts: map[string]string{
			"3": `<div class="mw-content-ltr mw-parser-output" lang="en" dir="ltr"><meta property="mw:PageProp/toc" />
<div class="mw-heading mw-heading3"><h3 id="Etymology_1">Etymology 1</h3><span class="mw-editsection">[edit]</span></div>
<p>From <span class="etyl"><a href="https://en.wikipedia.org/wiki/Middle_English">Middle English</a></span> <i>baille</i>, from Old French <i>bailler</i>.</p>
<p>Doublet of <i>bailiff</i>.<sup id="cite_ref-1" class="reference"><a href="#cite_note-1">[1]</a></sup></p>
<div class="mw-heading mw-heading4"><h4 id="Noun">Noun</h4><span class="mw-editsection">[edit]</span></div>
<p>DEFINITION SHOULD NOT APPEAR</p>
<ul><li>descendant should not appear</li></ul>
<script>window.evil = "SCRIPT SHOULD NOT APPEAR";</script>
<style>.evil { content: "STYLE SHOULD NOT APPEAR"; }</style>
<div class="mw-heading mw-heading4"><h4 id="Translations">Translations</h4></div>
<p>TRANSLATION SHOULD NOT APPEAR</p>
</div>`,
			"6":  `<div><div class="mw-heading mw-heading3"><h3 id="Etymology_2">Etymology 2</h3></div><p>Etymology 2 body.</p><div class="mw-heading mw-heading4"><h4>Verb</h4></div><p>DEFINITION SHOULD NOT APPEAR</p></div>`,
			"8":  `<div><div class="mw-heading mw-heading3"><h3 id="Etymology_3">Etymology 3</h3></div><p>Etymology 3 body.</p></div>`,
			"10": `<div><div class="mw-heading mw-heading3"><h3 id="Etymology_4">Etymology 4</h3></div><p>Etymology 4 body.</p></div>`,
			"13": `<p>BOUYEI ETYMOLOGY SHOULD NOT APPEAR</p>`,
			"15": `<p>CIMBRIAN ETYMOLOGY SHOULD NOT APPEAR</p>`,
			"17": `<p>FRENCH ETYMOLOGY SHOULD NOT APPEAR</p>`,
			"18": `<p>FRENCH ETYMOLOGY 2 SHOULD NOT APPEAR</p>`,
			"20": `<p>LATVIAN ETYMOLOGY SHOULD NOT APPEAR</p>`,
			"22": `<p>PALAUAN ETYMOLOGY SHOULD NOT APPEAR</p>`,
		},
	}
	server, client := startStub(t, stub)

	references, err := client.Lookup(context.Background(), "bail")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if len(references) != 4 {
		t.Fatalf("got %d references, want 4: %#v", len(references), references)
	}
	wantSections := []string{"Etymology 1", "Etymology 2", "Etymology 3", "Etymology 4"}
	for i, want := range wantSections {
		if references[i].Section != want {
			t.Errorf("reference %d section = %q, want %q", i, references[i].Section, want)
		}
	}
	if references[0].Text != "From Middle English baille, from Old French bailler.\n\nDoublet of bailiff." {
		t.Errorf("unexpected etymology 1 text: %q", references[0].Text)
	}
	for _, reference := range references {
		if strings.Contains(reference.Text, "SHOULD NOT APPEAR") || strings.Contains(reference.Text, "edit") {
			t.Errorf("reference %q leaked non-etymology content: %q", reference.Section, reference.Text)
		}
	}
	if wantURL := server.URL + "/wiki/bail#Etymology_1"; references[0].URL != wantURL {
		t.Errorf("reference 0 URL = %q, want %q", references[0].URL, wantURL)
	}

	requests := stub.snapshot()
	if len(requests) != 5 {
		t.Fatalf("got %d requests, want 1 sections request plus 4 section requests", len(requests))
	}
	indexes := fetchedSectionIndexes(requests)
	for _, want := range []string{"3", "6", "8", "10"} {
		if !hasSection(indexes, want) {
			t.Errorf("English etymology section %q was not fetched; fetched %v", want, indexes)
		}
	}
	for _, unwanted := range []string{"13", "15", "17", "18", "20", "22"} {
		if hasSection(indexes, unwanted) {
			t.Errorf("other-language etymology section %q was fetched; fetched %v", unwanted, indexes)
		}
	}
	for _, request := range requests {
		if request.action != "parse" || request.formatversion != "2" {
			t.Errorf("unexpected request shape: %+v", request)
		}
		if request.redirects != "1" {
			t.Errorf("redirects = %q, want 1", request.redirects)
		}
		if request.userAgent != testUserAgent {
			t.Errorf("User-Agent = %q, want %q", request.userAgent, testUserAgent)
		}
		if !strings.Contains(request.accept, "application/json") {
			t.Errorf("Accept = %q, want application/json", request.accept)
		}
		if request.prop == "text" && request.disableEdit != "1" {
			t.Errorf("text request did not disable edit sections: %+v", request)
		}
	}
}

func TestLookupGaslightUsesEnglishNotFirstPageEtymology(t *testing.T) {
	stub := &wikiStub{
		title: "gaslight",
		sections: []map[string]any{
			stubSection(2, "Dutch", "1", "Dutch"),
			stubSection(3, "Etymology", "2", "Etymology"),
			stubSection(2, "English", "3", "English"),
			stubSection(3, "Pronunciation", "4", "Pronunciation"),
			stubSection(3, "Etymology 1", "5", "Etymology_1"),
			stubSection(4, "Noun", "6", "Noun"),
			stubSection(3, "Etymology 2", "7", "Etymology_2"),
			stubSection(4, "Verb", "8", "Verb"),
		},
		texts: map[string]string{
			"2": `<div><div class="mw-heading mw-heading3"><h3>Etymology</h3></div><p>DUTCH ETYMOLOGY SHOULD NOT APPEAR</p></div>`,
			"5": `<div class="mw-content-ltr mw-parser-output" lang="en" dir="ltr"><div class="mw-heading mw-heading3"><h3 id="Etymology_1">Etymology 1</h3><span class="mw-editsection">[edit]</span></div>
<p>From <i class="Latn mention" lang="en">gas</i> + <i class="Latn mention" lang="en">light</i>.<sup id="cite_ref-1" class="reference"><a href="#cite_note-1">[1]</a></sup></p>
<div class="mw-heading mw-heading4"><h4 id="Noun">Noun</h4></div>
<p>A DEFINITION SHOULD NOT APPEAR</p></div>`,
			"7": `<div><div class="mw-heading mw-heading3"><h3 id="Etymology_2">Etymology 2</h3></div><p>Etymology 2 body.</p></div>`,
		},
	}
	server, client := startStub(t, stub)

	references, err := client.Lookup(context.Background(), "gaslight")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if len(references) != 2 {
		t.Fatalf("got %d references, want 2: %#v", len(references), references)
	}
	if references[0].Section != "Etymology 1" || references[1].Section != "Etymology 2" {
		t.Fatalf("unexpected sections: %#v", references)
	}
	if references[0].Text != "From gas + light." {
		t.Errorf("etymology 1 text = %q, want %q", references[0].Text, "From gas + light.")
	}
	for _, reference := range references {
		if strings.Contains(reference.Text, "SHOULD NOT APPEAR") {
			t.Errorf("reference leaked definition or first-page etymology: %q", reference.Text)
		}
	}
	if wantURL := server.URL + "/wiki/gaslight#Etymology_1"; references[0].URL != wantURL {
		t.Errorf("reference 0 URL = %q, want %q", references[0].URL, wantURL)
	}

	indexes := fetchedSectionIndexes(stub.snapshot())
	if hasSection(indexes, "2") {
		t.Errorf("Dutch (first page) etymology section was fetched: %v", indexes)
	}
	if len(indexes) != 2 || !hasSection(indexes, "5") || !hasSection(indexes, "7") {
		t.Errorf("fetched section indexes = %v, want [5 7]", indexes)
	}
}

func TestLookupNoEtymologyReturnsNilNil(t *testing.T) {
	stub := &wikiStub{
		title: "hang out",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Pronunciation", "2", "Pronunciation"),
			stubSection(3, "Verb", "3", "Verb"),
			stubSection(4, "Synonyms", "4", "Synonyms"),
			stubSection(4, "Derived terms", "5", "Derived_terms"),
			stubSection(4, "Related terms", "6", "Related_terms"),
			stubSection(4, "Translations", "7", "Translations"),
			stubSection(3, "See also", "8", "See_also"),
			stubSection(3, "Anagrams", "9", "Anagrams"),
		},
	}
	_, client := startStub(t, stub)

	references, err := client.Lookup(context.Background(), "hang out")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if references != nil {
		t.Fatalf("references = %#v, want nil", references)
	}
	requests := stub.snapshot()
	if len(requests) != 1 {
		t.Fatalf("got %d requests, want only the sections request", len(requests))
	}
	if requests[0].prop != "sections" {
		t.Errorf("first request prop = %q, want sections", requests[0].prop)
	}
}

func TestLookupMissingEnglishReturnsNilNil(t *testing.T) {
	stub := &wikiStub{
		title: "bail",
		sections: []map[string]any{
			stubSection(2, "Bouyei", "1", "Bouyei"),
			stubSection(3, "Etymology", "2", "Etymology"),
			stubSection(2, "French", "3", "French"),
			stubSection(3, "Etymology 1", "4", "Etymology_1"),
		},
	}
	_, client := startStub(t, stub)

	references, err := client.Lookup(context.Background(), "bail")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if references != nil {
		t.Fatalf("references = %#v, want nil", references)
	}
	if requests := stub.snapshot(); len(requests) != 1 {
		t.Fatalf("got %d requests, want 1", len(requests))
	}
}

func TestLookupBlankEtymologyContentReturnsNilNil(t *testing.T) {
	stub := &wikiStub{
		title: "gaslight",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Etymology 1", "2", "Etymology_1"),
		},
		texts: map[string]string{
			"2": `<div><div class="mw-heading mw-heading3"><h3>Etymology 1</h3><span class="mw-editsection">[edit]</span></div><div class="mw-heading mw-heading4"><h4>Noun</h4></div><p>ONLY DEFINITION SHOULD NOT APPEAR</p><p> </p></div>`,
		},
	}
	_, client := startStub(t, stub)

	references, err := client.Lookup(context.Background(), "gaslight")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if references != nil {
		t.Fatalf("references = %#v, want nil", references)
	}
	if requests := stub.snapshot(); len(requests) != 2 {
		t.Fatalf("got %d requests, want sections plus one text request", len(requests))
	}
}

func TestLookupBlankTargetReturnsNilNilWithoutRequests(t *testing.T) {
	stub := &wikiStub{title: "x"}
	_, client := startStub(t, stub)
	for _, target := range []string{"", "   ", "\n\t"} {
		references, err := client.Lookup(context.Background(), target)
		if err != nil {
			t.Fatalf("Lookup(%q) returned error: %v", target, err)
		}
		if references != nil {
			t.Fatalf("Lookup(%q) references = %#v, want nil", target, references)
		}
	}
	if requests := stub.snapshot(); len(requests) != 0 {
		t.Fatalf("blank targets issued %d requests", len(requests))
	}
}

func TestLookupEncodesTargetAndReferenceURL(t *testing.T) {
	stub := &wikiStub{
		title: "hang out",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Etymology 1", "2", "Etymology_1"),
		},
		texts: map[string]string{
			"2": `<div><div class="mw-heading mw-heading3"><h3>Etymology 1</h3></div><p>From <i>hang</i> + <i>out</i>.</p></div>`,
		},
	}
	server, client := startStub(t, stub)

	references, err := client.Lookup(context.Background(), "hang out")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if len(references) != 1 {
		t.Fatalf("got %d references, want 1", len(references))
	}
	if strings.Contains(references[0].URL, "hang out") {
		t.Errorf("reference URL is not encoded: %q", references[0].URL)
	}
	if want := server.URL + "/wiki/hang_out#Etymology_1"; references[0].URL != want {
		t.Errorf("reference URL = %q, want %q", references[0].URL, want)
	}
	for _, request := range stub.snapshot() {
		if request.page != "hang out" {
			t.Errorf("decoded page = %q, want %q", request.page, "hang out")
		}
		if strings.Contains(request.rawQuery, "page=hang out") {
			t.Errorf("page was not query-encoded: %q", request.rawQuery)
		}
	}

	// A title with reserved characters must be encoded in the query and in
	// the article URL.
	stub = &wikiStub{
		title: "AT&T #1",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Etymology", "2", "Etymology"),
		},
		texts: map[string]string{
			"2": `<div><div class="mw-heading mw-heading3"><h3>Etymology</h3></div><p>Body.</p></div>`,
		},
	}
	_, client = startStub(t, stub)

	references, err = client.Lookup(context.Background(), "AT&T #1")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if len(references) != 1 {
		t.Fatalf("got %d references, want 1", len(references))
	}
	requests := stub.snapshot()
	if !strings.Contains(requests[0].rawQuery, "page=AT%26T+%231") {
		t.Errorf("reserved characters were not query-encoded: %q", requests[0].rawQuery)
	}
	parsed, err := url.Parse(references[0].URL)
	if err != nil {
		t.Fatalf("reference URL does not parse: %v", err)
	}
	if parsed.Fragment != "Etymology" {
		t.Errorf("reference fragment = %q, want Etymology", parsed.Fragment)
	}
	if parsed.Path != "/wiki/AT&T_#1" {
		t.Errorf("reference path = %q, want %q", parsed.Path, "/wiki/AT&T_#1")
	}
	if strings.Contains(references[0].URL, "#1#") {
		t.Errorf("reference URL has an ambiguous fragment: %q", references[0].URL)
	}
}

func TestLookupSetsDescriptiveHeaders(t *testing.T) {
	stub := &wikiStub{
		title: "bail",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Etymology 1", "2", "Etymology_1"),
		},
		texts: map[string]string{
			"2": `<div><div class="mw-heading mw-heading3"><h3>Etymology 1</h3></div><p>Body.</p></div>`,
		},
	}
	_, client := startStub(t, stub)
	if _, err := client.Lookup(context.Background(), "bail"); err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	for _, request := range stub.snapshot() {
		if request.userAgent != testUserAgent {
			t.Errorf("User-Agent = %q, want %q", request.userAgent, testUserAgent)
		}
		if request.accept != "application/json" {
			t.Errorf("Accept = %q, want application/json", request.accept)
		}
	}

	// The zero-value UserAgent option still sends a descriptive value, but
	// never invents contact details.
	server := httptest.NewServer(stub)
	t.Cleanup(server.Close)
	defaultUA := NewClient(Options{Endpoint: server.URL + "/w/api.php", HTTPClient: server.Client()})
	if _, err := defaultUA.Lookup(context.Background(), "bail"); err != nil {
		t.Fatalf("Lookup with default User-Agent returned error: %v", err)
	}
	requests := stub.snapshot()
	if request := requests[len(requests)-1]; !strings.Contains(request.userAgent, "LexiGene") ||
		!strings.Contains(request.userAgent, "Wiktionary") {
		t.Errorf("default User-Agent is not descriptive: %q", request.userAgent)
	}
}

func TestLookupTotalBudgetExpiresWithoutCancelingCaller(t *testing.T) {
	stub := &wikiStub{
		title: "bail",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Etymology 1", "2", "Etymology_1"),
			stubSection(3, "Etymology 2", "3", "Etymology_2"),
		},
		texts: map[string]string{
			"2": `<p>Body.</p>`,
			"3": `<p>Body.</p>`,
		},
		textDelay: 5 * time.Second,
	}
	server := httptest.NewServer(stub)
	t.Cleanup(server.Close)
	client := NewClient(Options{
		Endpoint:   server.URL + "/w/api.php",
		UserAgent:  testUserAgent,
		HTTPClient: server.Client(),
		Timeout:    100 * time.Millisecond,
	})

	callerCtx, callerCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer callerCancel()

	start := time.Now()
	references, err := client.Lookup(callerCtx, "bail")
	elapsed := time.Since(start)

	requireNoReference(t, references, err)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error = %v, want context.DeadlineExceeded", err)
	}
	if elapsed > 2*time.Second {
		t.Errorf("Lookup took %v, want it to stop at the 100ms budget", elapsed)
	}
	if callerCtx.Err() != nil {
		t.Errorf("caller context was canceled by the lookup budget: %v", callerCtx.Err())
	}
}

func TestLookupPreservesCallerCancellation(t *testing.T) {
	stub := &wikiStub{
		title: "bail",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Etymology 1", "2", "Etymology_1"),
		},
		texts: map[string]string{
			"2": `<p>Body.</p>`,
		},
		textDelay: 5 * time.Second,
	}
	server := httptest.NewServer(stub)
	t.Cleanup(server.Close)
	client := NewClient(Options{
		Endpoint:   server.URL + "/w/api.php",
		UserAgent:  testUserAgent,
		HTTPClient: server.Client(),
		Timeout:    5 * time.Second,
	})

	callerCtx, callerCancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		callerCancel()
	}()

	start := time.Now()
	references, err := client.Lookup(callerCtx, "bail")
	elapsed := time.Since(start)

	requireNoReference(t, references, err)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("error = %v, want context.Canceled", err)
	}
	if callerCtx.Err() != context.Canceled {
		t.Errorf("caller context state = %v, want context.Canceled", callerCtx.Err())
	}
	if elapsed > 2*time.Second {
		t.Errorf("Lookup took %v after cancellation", elapsed)
	}
}

func TestLookupRejectsHTTPFailureStatuses(t *testing.T) {
	for _, status := range []int{http.StatusForbidden, http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway} {
		t.Run(fmt.Sprintf("status_%d", status), func(t *testing.T) {
			stub := &wikiStub{
				title:    "bail",
				sections: bailSections(),
				status:   status,
			}
			_, client := startStub(t, stub)

			references, err := client.Lookup(context.Background(), "bail")
			requireNoReference(t, references, err)
			if !strings.Contains(err.Error(), fmt.Sprintf("%d", status)) {
				t.Errorf("error = %v, want it to mention status %d", err, status)
			}
			if requests := stub.snapshot(); len(requests) != 1 {
				t.Errorf("got %d requests, want to stop after the failing request", len(requests))
			}
		})
	}
}

func TestLookupSectionFailureReturnsNoPartialReference(t *testing.T) {
	stub := &wikiStub{
		title: "bail",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Etymology 1", "2", "Etymology_1"),
			stubSection(3, "Etymology 2", "3", "Etymology_2"),
		},
		texts: map[string]string{
			"2": `<div><div class="mw-heading mw-heading3"><h3>Etymology 1</h3></div><p>Good body.</p></div>`,
			"3": `<div><div class="mw-heading mw-heading3"><h3>Etymology 2</h3></div><p>Other body.</p></div>`,
		},
		sectionStatus: map[string]int{"3": http.StatusTooManyRequests},
	}
	_, client := startStub(t, stub)

	references, err := client.Lookup(context.Background(), "bail")
	requireNoReference(t, references, err)
	if !strings.Contains(err.Error(), "429") {
		t.Errorf("error = %v, want it to mention 429", err)
	}
}

func TestLookupMalformedResponsesReturnError(t *testing.T) {
	tests := []struct {
		name    string
		handler http.HandlerFunc
	}{
		{
			name: "invalid JSON",
			handler: func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte("this is not json"))
			},
		},
		{
			name: "missing parse result",
			handler: func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"warnings":{"main":{"warnings":"no parse here"}}}`))
			},
		},
		{
			name: "null parse result",
			handler: func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"parse":null}`))
			},
		},
		{
			name: "wrong sections shape",
			handler: func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"parse":{"title":"bail","sections":"nope"}}`))
			},
		},
		{
			name: "trailing garbage",
			handler: func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"parse":{"title":"bail","sections":[]}} trailing`))
			},
		},
		{
			name: "missing sections list",
			handler: func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"parse":{"title":"bail","pageid":1}}`))
			},
		},
		{
			name: "null sections list",
			handler: func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"parse":{"title":"bail","sections":null}}`))
			},
		},
		{
			name: "missing section text",
			handler: func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("prop") == "sections" {
					_, _ = w.Write([]byte(`{"parse":{"title":"bail","sections":[{"level":"2","line":"English","index":"1"},{"level":"3","line":"Etymology 1","index":"2"}]}}`))
					return
				}
				_, _ = w.Write([]byte(`{"parse":{"title":"bail","pageid":1}}`))
			},
		},
		{
			name: "API error",
			handler: func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"error":{"code":"missingtitle","info":"The page you specified doesn't exist."}}`))
			},
		},
		{
			name: "oversized response",
			handler: func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(strings.Repeat("x", maxResponseBytes+1)))
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := newClientWithHandler(t, test.handler)
			references, err := client.Lookup(context.Background(), "bail")
			requireNoReference(t, references, err)
		})
	}
}

func TestLookupEmptySectionsReturnsNilNil(t *testing.T) {
	client := newClientWithHandler(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"parse":{"title":"bail","pageid":1,"redirects":[],"sections":[]}}`))
	}))
	references, err := client.Lookup(context.Background(), "bail")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if references != nil {
		t.Fatalf("references = %#v, want nil", references)
	}
}

func TestLookupRedirectionUsesResolvedTitle(t *testing.T) {
	stub := &wikiStub{
		title: "hang out",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Etymology 1", "2", "Etymology_1"),
		},
		texts: map[string]string{
			"2": `<div><div class="mw-heading mw-heading3"><h3>Etymology 1</h3></div><p>Body.</p></div>`,
		},
	}
	server, client := startStub(t, stub)

	references, err := client.Lookup(context.Background(), "hangout")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if len(references) != 1 {
		t.Fatalf("got %d references, want 1", len(references))
	}
	if want := server.URL + "/wiki/hang_out#Etymology_1"; references[0].URL != want {
		t.Errorf("reference URL = %q, want resolved title URL %q", references[0].URL, want)
	}
	for _, request := range stub.snapshot() {
		if request.prop == "text" && request.page != "hang out" {
			t.Errorf("section request page = %q, want resolved title %q", request.page, "hang out")
		}
	}
}

func TestLookupBoundsEtymologySectionsAndText(t *testing.T) {
	sections := []map[string]any{stubSection(2, "English", "1", "English")}
	texts := map[string]string{}
	for i := 2; i <= 13; i++ {
		index := fmt.Sprintf("%d", i)
		line := "Etymology"
		if i > 2 {
			line = fmt.Sprintf("Etymology %d", i-1)
		}
		sections = append(sections, stubSection(3, line, index, strings.ReplaceAll(line, " ", "_")))
		texts[index] = fmt.Sprintf(`<div><div class="mw-heading mw-heading3"><h3>%s</h3></div><p>Body number %d.</p></div>`, line, i)
	}
	stub := &wikiStub{title: "many", sections: sections, texts: texts}
	_, client := startStub(t, stub)

	references, err := client.Lookup(context.Background(), "many")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if len(references) != maxEtymologySections {
		t.Fatalf("got %d references, want %d", len(references), maxEtymologySections)
	}
	if requests := fetchedSectionIndexes(stub.snapshot()); len(requests) != maxEtymologySections {
		t.Errorf("fetched %d sections, want %d", len(requests), maxEtymologySections)
	}

	long := strings.Repeat("word ", 2000)
	longStub := &wikiStub{
		title: "long",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Etymology 1", "2", "Etymology_1"),
		},
		texts: map[string]string{
			"2": `<div><div class="mw-heading mw-heading3"><h3>Etymology 1</h3></div><p>` + long + `</p></div>`,
		},
	}
	_, longClient := startStub(t, longStub)
	references, err = longClient.Lookup(context.Background(), "long")
	if err != nil {
		t.Fatalf("Lookup returned error: %v", err)
	}
	if len(references) != 1 {
		t.Fatalf("got %d references, want 1", len(references))
	}
	runes := []rune(references[0].Text)
	if len(runes) > maxReferenceRunes {
		t.Errorf("reference text has %d runes, want at most %d", len(runes), maxReferenceRunes)
	}
	if !strings.HasSuffix(references[0].Text, "…") {
		t.Errorf("truncated reference text does not end with an ellipsis: %q", tail(references[0].Text, 40))
	}
}

func tail(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[len(runes)-n:])
}

func TestReferenceJSONFieldNames(t *testing.T) {
	encoded, err := json.Marshal(Reference{Section: "Etymology 1", Text: "From gas + light.", URL: "https://en.wiktionary.org/wiki/gaslight#Etymology_1"})
	if err != nil {
		t.Fatalf("marshal reference: %v", err)
	}
	want := `{"section":"Etymology 1","text":"From gas + light.","url":"https://en.wiktionary.org/wiki/gaslight#Etymology_1"}`
	if string(encoded) != want {
		t.Errorf("encoded reference = %s, want %s", encoded, want)
	}
}

func TestNewClientDefaultsAndValidation(t *testing.T) {
	client := NewClient(Options{})
	if got := client.endpoint.String(); got != "https://en.wiktionary.org/w/api.php" {
		t.Errorf("default endpoint = %q", got)
	}
	if client.timeout != 3*time.Second {
		t.Errorf("default timeout = %v, want 3s", client.timeout)
	}
	if client.userAgent == "" {
		t.Error("default User-Agent is empty")
	}
	if client.endpointErr != nil {
		t.Errorf("default endpoint error = %v", client.endpointErr)
	}

	invalid := NewClient(Options{Endpoint: "ftp://en.wiktionary.org/w/api.php"})
	if references, err := invalid.Lookup(context.Background(), "bail"); err == nil || references != nil {
		t.Errorf("invalid endpoint Lookup = (%#v, %v), want (nil, error)", references, err)
	}

	if references, err := client.Lookup(nil, "bail"); err == nil || references != nil {
		t.Errorf("nil context Lookup = (%#v, %v), want (nil, error)", references, err)
	}

	longTarget := strings.Repeat("a", 201)
	if references, err := client.Lookup(context.Background(), longTarget); err == nil || references != nil {
		t.Errorf("oversized target Lookup = (%#v, %v), want (nil, error)", references, err)
	}
}
