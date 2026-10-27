// Package wiktionary retrieves English etymology references from the
// English Wiktionary MediaWiki API.
//
// A lookup runs against a small total budget (3 seconds by default) and
// makes at most a bounded number of requests and returns at most a bounded
// amount of text. Retrieved text is treated as untrusted data: it is reduced
// to plain readable paragraphs, never interpreted as markup, and never
// interpolated into a command or query.
//
// Lookup distinguishes "no reference exists" from "the reference could not
// be retrieved". A page without an English section, or with an English
// section that has no etymology, yields (nil, nil). HTTP failures, timeouts,
// API errors, and malformed responses yield (nil, error) so that callers can
// fall back to another source.
package wiktionary

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	defaultEndpoint  = "https://en.wiktionary.org/w/api.php"
	defaultUserAgent = "LexiGene/1.0 (Wiktionary etymology reference client)"
	defaultTimeout   = 3 * time.Second

	// maxResponseBytes bounds any single API response body.
	maxResponseBytes = 2 << 20 // 2 MiB

	// maxTargetRunes bounds the page title supplied by the caller.
	maxTargetRunes = 200

	// maxEtymologySections bounds how many etymology sections are retrieved
	// from one page. Words with more than this many etymologies are truncated
	// to the first ones in page order.
	maxEtymologySections = 8

	// maxConcurrentSectionRequests bounds request concurrency so one lookup
	// cannot open an unbounded number of connections.
	maxConcurrentSectionRequests = 4

	// maxReferenceRunes bounds one reference and the whole result.
	maxReferenceRunes      = 3000
	maxTotalReferenceRunes = 6000
)

// Options configures a Client. The zero value is usable: it targets the
// production English Wiktionary API with a generic descriptive User-Agent and
// a three second total lookup budget.
type Options struct {
	// Endpoint is the MediaWiki api.php URL. Empty selects
	// https://en.wiktionary.org/w/api.php.
	Endpoint string

	// UserAgent is sent verbatim on every request. Callers in production
	// should supply their own descriptive User-Agent including contact
	// details, as the Wikimedia API etiquette requires. Empty selects a
	// generic descriptive default.
	UserAgent string

	// HTTPClient performs the requests. Empty selects a plain http.Client.
	// The lookup budget is enforced with request contexts, so the client's
	// own Timeout should be longer than Options.Timeout.
	HTTPClient *http.Client

	// Timeout is the total budget for one Lookup call, covering every
	// request. Zero or negative selects the three second default.
	Timeout time.Duration
}

// Reference is one etymology section of a page.
type Reference struct {
	Section string `json:"section"`
	Text    string `json:"text"`
	URL     string `json:"url"`
}

// Client retrieves etymology references from a MediaWiki API. Clients are
// safe for concurrent use.
type Client struct {
	endpoint    *url.URL
	endpointErr error
	userAgent   string
	httpClient  *http.Client
	timeout     time.Duration
}

// NewClient returns a Client configured by opts.
func NewClient(opts Options) *Client {
	c := &Client{
		userAgent:  strings.TrimSpace(opts.UserAgent),
		httpClient: opts.HTTPClient,
		timeout:    opts.Timeout,
	}
	if c.userAgent == "" {
		c.userAgent = defaultUserAgent
	}
	if c.httpClient == nil {
		c.httpClient = &http.Client{}
	}
	if c.timeout <= 0 {
		c.timeout = defaultTimeout
	}

	endpoint := strings.TrimSpace(opts.Endpoint)
	if endpoint == "" {
		endpoint = defaultEndpoint
	}
	u, err := url.Parse(endpoint)
	switch {
	case err != nil:
		c.endpointErr = fmt.Errorf("wiktionary: invalid endpoint %q: %w", endpoint, err)
		c.endpoint = &url.URL{}
	case u.Scheme != "http" && u.Scheme != "https":
		c.endpointErr = fmt.Errorf("wiktionary: endpoint %q must use http or https", endpoint)
		c.endpoint = &url.URL{}
	case u.Host == "":
		c.endpointErr = fmt.Errorf("wiktionary: endpoint %q has no host", endpoint)
		c.endpoint = &url.URL{}
	default:
		c.endpoint = u
	}
	return c
}

// Lookup returns the English etymology sections of target from Wiktionary.
//
// It returns (nil, nil) when the page has no English section, the English
// section has no Etymology/Etymology N heading, or those sections contain no
// readable prose. It returns (nil, error) for transport failures,
// non-200 statuses (including 403 and 429), API-level errors, malformed
// responses, budget exhaustion, and caller cancellation. It never returns a
// partial result alongside an error.
func (c *Client) Lookup(ctx context.Context, target string) ([]Reference, error) {
	if ctx == nil {
		return nil, fmt.Errorf("wiktionary: nil context")
	}
	if c.endpointErr != nil {
		return nil, c.endpointErr
	}

	target = strings.TrimSpace(target)
	if target == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(target) > maxTargetRunes {
		return nil, fmt.Errorf("wiktionary: target exceeds %d characters", maxTargetRunes)
	}

	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("wiktionary: lookup canceled: %w", err)
	}

	sectionsBody, err := c.get(ctx, url.Values{
		"action":        {"parse"},
		"page":          {target},
		"prop":          {"sections"},
		"formatversion": {"2"},
		"format":        {"json"},
		"redirects":     {"1"},
	})
	if err != nil {
		return nil, err
	}

	page, err := decodeResponse(sectionsBody, "sections")
	if err != nil {
		return nil, err
	}
	if page.Title == "" {
		page.Title = target
	}

	if page.Sections == nil {
		return nil, fmt.Errorf("wiktionary: sections response has no sections list")
	}

	etymologies := englishEtymologySections(page.Sections)
	if len(etymologies) == 0 {
		return nil, nil
	}
	if len(etymologies) > maxEtymologySections {
		etymologies = etymologies[:maxEtymologySections]
	}

	texts, err := c.fetchSectionTexts(ctx, page.Title, etymologies)
	if err != nil {
		return nil, err
	}

	remaining := maxTotalReferenceRunes
	references := make([]Reference, 0, len(etymologies))
	for i, section := range etymologies {
		paragraphs := extractEtymologyParagraphs(texts[i])
		if len(paragraphs) == 0 {
			continue
		}
		text := strings.Join(paragraphs, "\n\n")
		if remaining <= 0 {
			break
		}
		runes := utf8.RuneCountInString(text)
		limit := remaining
		if limit > maxReferenceRunes {
			limit = maxReferenceRunes
		}
		if runes > limit {
			text = truncateRunes(text, limit)
			runes = utf8.RuneCountInString(text)
		}
		if text == "" {
			continue
		}
		remaining -= runes
		references = append(references, Reference{
			Section: strings.TrimSpace(section.Line),
			Text:    text,
			URL:     c.referenceURL(page.Title, sectionAnchor(section)),
		})
	}
	if len(references) == 0 {
		return nil, nil
	}
	return references, nil
}

// section is one entry of action=parse&prop=sections with formatversion=2.
type section struct {
	TocLevel   int    `json:"toclevel"`
	Level      string `json:"level"`
	Line       string `json:"line"`
	Number     string `json:"number"`
	Index      string `json:"index"`
	FromTitle  string `json:"fromtitle"`
	ByteOffset int    `json:"byteoffset"`
	Anchor     string `json:"anchor"`
	LinkAnchor string `json:"linkAnchor"`
}

type redirect struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type parseResult struct {
	Title     string     `json:"title"`
	PageID    int64      `json:"pageid"`
	Redirects []redirect `json:"redirects"`
	Sections  []section  `json:"sections"`
	Text      *string    `json:"text"`
}

type apiError struct {
	Code string `json:"code"`
	Info string `json:"info"`
}

type apiResponse struct {
	Parse *parseResult `json:"parse"`
	Error *apiError    `json:"error"`
}

func decodeResponse(body []byte, what string) (*parseResult, error) {
	var response apiResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("wiktionary: malformed %s response: %w", what, err)
	}
	if response.Error != nil {
		return nil, fmt.Errorf("wiktionary: API error %s: %s", response.Error.Code, response.Error.Info)
	}
	if response.Parse == nil {
		return nil, fmt.Errorf("wiktionary: %s response has no parse result", what)
	}
	return response.Parse, nil
}

// englishEtymologySections selects level-3 Etymology/Etymology N headings
// that appear between the level-2 "English" heading and the next level-2
// heading. Pages such as "bail" carry etymology headings for many languages;
// only the English ones are returned.
func englishEtymologySections(sections []section) []section {
	start := -1
	for i, s := range sections {
		if sectionLevel(s) == 2 && strings.EqualFold(strings.TrimSpace(s.Line), "English") {
			start = i
			break
		}
	}
	if start < 0 {
		return nil
	}

	var selected []section
	for _, s := range sections[start+1:] {
		level := sectionLevel(s)
		if level == 2 {
			break
		}
		if level == 3 && isEtymologyHeading(s.Line) {
			selected = append(selected, s)
			if len(selected) >= maxEtymologySections {
				break
			}
		}
	}
	return selected
}

func sectionLevel(s section) int {
	level := strings.TrimSpace(s.Level)
	if level == "" {
		return 0
	}
	n := 0
	for _, r := range level {
		if r < '0' || r > '9' {
			return 0
		}
		n = n*10 + int(r-'0')
	}
	return n
}

func isEtymologyHeading(line string) bool {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(line)))
	if len(fields) == 0 || fields[0] != "etymology" {
		return false
	}
	return len(fields) == 1 || (len(fields) == 2 && isDigits(fields[1]))
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func sectionAnchor(s section) string {
	if anchor := strings.TrimSpace(s.Anchor); anchor != "" {
		return anchor
	}
	return strings.ReplaceAll(strings.TrimSpace(s.Line), " ", "_")
}

func (c *Client) fetchSectionTexts(ctx context.Context, title string, sections []section) ([]string, error) {
	texts := make([]string, len(sections))
	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		firstErr error
	)
	setErr := func(err error) {
		mu.Lock()
		if firstErr == nil {
			firstErr = err
		}
		mu.Unlock()
	}
	sem := make(chan struct{}, maxConcurrentSectionRequests)

	for i, sec := range sections {
		wg.Add(1)
		go func(i int, sec section) {
			defer wg.Done()
			if strings.TrimSpace(sec.Index) == "" {
				setErr(fmt.Errorf("wiktionary: section %q has no index", strings.TrimSpace(sec.Line)))
				return
			}
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				setErr(fmt.Errorf("wiktionary: section %q canceled: %w", strings.TrimSpace(sec.Line), ctx.Err()))
				return
			}
			defer func() { <-sem }()

			body, err := c.get(ctx, url.Values{
				"action":             {"parse"},
				"page":               {title},
				"prop":               {"text"},
				"section":            {sec.Index},
				"formatversion":      {"2"},
				"format":             {"json"},
				"redirects":          {"1"},
				"disableeditsection": {"1"},
			})
			if err != nil {
				setErr(fmt.Errorf("wiktionary: fetch section %q: %w", strings.TrimSpace(sec.Line), err))
				return
			}
			page, err := decodeResponse(body, "section text")
			if err != nil {
				setErr(err)
				return
			}
			if page.Text == nil {
				setErr(fmt.Errorf("wiktionary: section %q response has no text", strings.TrimSpace(sec.Line)))
				return
			}
			texts[i] = *page.Text
		}(i, sec)
	}
	wg.Wait()

	if firstErr != nil {
		if err := ctx.Err(); err != nil {
			return nil, fmt.Errorf("wiktionary: lookup aborted: %w", err)
		}
		return nil, firstErr
	}
	return texts, nil
}

// get performs one API request within ctx and bounds the response body.
func (c *Client) get(ctx context.Context, params url.Values) ([]byte, error) {
	u := *c.endpoint
	query := u.Query()
	for key, values := range params {
		query[key] = append([]string(nil), values...)
	}
	u.RawQuery = query.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("wiktionary: build request: %w", err)
	}
	request.Header.Set("User-Agent", c.userAgent)
	request.Header.Set("Accept", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("wiktionary: request failed: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("wiktionary: unexpected HTTP status %d %s", response.StatusCode, http.StatusText(response.StatusCode))
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("wiktionary: read response: %w", err)
	}
	if len(body) > maxResponseBytes {
		return nil, fmt.Errorf("wiktionary: response exceeds %d bytes", maxResponseBytes)
	}
	return body, nil
}

func (c *Client) referenceURL(title, anchor string) string {
	u := url.URL{
		Scheme:   c.endpoint.Scheme,
		Host:     c.endpoint.Host,
		Path:     "/wiki/" + strings.ReplaceAll(title, " ", "_"),
		Fragment: anchor,
	}
	return u.String()
}

// truncateRunes cuts s to at most limit runes, preferring a word boundary,
// and appends an ellipsis.
func truncateRunes(s string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= limit {
		return s
	}
	keep := limit - 1
	if keep < 1 {
		return "…"
	}
	cut := runes[:keep]
	lastSpace := -1
	for i := len(cut) - 1; i >= len(cut)/2; i-- {
		switch cut[i] {
		case ' ', '\t', '\n':
			lastSpace = i
		}
		if lastSpace >= 0 {
			break
		}
	}
	if lastSpace > 0 {
		cut = cut[:lastSpace]
	}
	return strings.TrimRight(string(cut), " \t\n") + "…"
}
