// Package anki writes Anki .apkg packages for LexiGene exports.
//
// The implementation is pure Go: it assembles a legacy Anki collection
// (collection.anki2, collection schema version 11) through the modernc.org/sqlite
// driver and wraps it in a ZIP archive with an (empty) media manifest. It
// replaces the previous Node implementation (`anki-apkg-export`, driven by
// src/app/api/export/anki/route.ts) and reproduces its observable output:
//
//   - the two-field "Front"/"Back" basic note type named "<deck> — Basic" with
//     the same forward template, CSS and LaTeX wrapper,
//   - deck and note-type ids derived from the deck name,
//   - note GUIDs derived from the deck id, note-type id and the caller's stable
//     semantic card id,
//   - the same plain-text-to-HTML conversion (escape HTML, `\n` -> `<br>`) and
//     the same `flds`/`sfld`/`csum`/`tags` layout inside `notes`.
//
// GUID compatibility is the migration requirement: because a GUID is a pure
// function of (deck name, card id), a package built here updates the notes that
// the old Node exporter created instead of duplicating them in Anki.
//
// Everything happens in a temporary directory below the inherited TMPDIR; the
// directory is removed before Export returns.
package anki

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Export limits, mirrored from src/app/api/export/anki/route.ts so an oversized
// payload cannot exhaust the process that serves the export endpoint.
const (
	// MaxCards is the largest number of cards one package may contain.
	MaxCards = 1000
	// MaxTotalChars bounds the summed rune length of all Front+Back fields.
	MaxTotalChars = 4_000_000
	// MaxDeckName bounds the trimmed deck name.
	MaxDeckName = 80
	// MaxCardID bounds the stable semantic note id.
	MaxCardID = 2048
	// MaxFront bounds one Front field.
	MaxFront = 10_000
	// MaxBack bounds one Back field.
	MaxBack = 30_000
	// MaxTag bounds one tag.
	MaxTag = 64
	// MaxTags bounds the tags of one card.
	MaxTags = 30

	// DefaultDeckName is used when the caller passes an empty deck name.
	DefaultDeckName = "LexiGene"

	collectionFile = "collection.anki2"
	mediaFile      = "media"
	// mediaManifest is what the Node exporter wrote for a media-free deck.
	mediaManifest = "{}"
)

// Card is one study card to export. Front and Back are plain text; HTML
// encoding and `<br>` line breaks are applied by Export. ID is the stable
// semantic identifier produced by the card builder and is the only input to the
// note GUID, so it must not contain timestamps or random parts.
type Card struct {
	ID    string   `json:"id"`
	Type  string   `json:"type"`
	Front string   `json:"front"`
	Back  string   `json:"back"`
	Tags  []string `json:"tags"`
}

// cardTypes mirrors the `type` enum of the shared card schema.
var cardTypes = map[string]struct{}{
	"core":    {},
	"chunk":   {},
	"pitfall": {},
	"nuance":  {},
	"quiz":    {},
}

// ErrInvalidInput is wrapped by every validation failure so an HTTP layer can
// answer 400 while treating any other error as a server fault.
var ErrInvalidInput = errors.New("anki: invalid export input")

// ValidationError reports one rejected field.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("anki: %s: %s", e.Field, e.Message)
}

// Unwrap makes errors.Is(err, ErrInvalidInput) true for validation failures.
func (e *ValidationError) Unwrap() error { return ErrInvalidInput }

// Export builds a complete .apkg archive for cards and returns its bytes.
//
// The archive holds `collection.anki2` plus the `media` manifest, matching the
// layout the previous Node exporter produced. Notes are keyed by GUID, so
// exporting the same card ids again updates the existing notes in Anki in place
// (new field content, bumped modification time) instead of adding duplicates.
//
// Export respects ctx cancellation and returns ctx.Err() when it is cancelled.
func Export(ctx context.Context, deckName string, cards []Card) ([]byte, error) {
	return export(ctx, deckName, cards, time.Now)
}

// export is Export with an injectable clock, so tests can prove that repeated
// exports bump modification times and keep note ids stable.
func export(ctx context.Context, deckName string, cards []Card, now func() time.Time) ([]byte, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if now == nil {
		now = time.Now
	}

	deck, err := newDeck(deckName)
	if err != nil {
		return nil, err
	}
	notes, err := newNotes(ctx, deck, cards)
	if err != nil {
		return nil, err
	}

	stamp := now()
	if stamp.IsZero() {
		stamp = time.Now()
	}
	stamp = stamp.Truncate(time.Millisecond)

	collection, err := buildCollection(ctx, deck, notes, stamp)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return packPackage(collection, stamp)
}

// deckInfo carries the validated deck name together with the ids derived from
// it. Both ids must stay stable across releases: they feed every note GUID.
type deckInfo struct {
	Name      string
	ID        int64
	ModelName string
	ModelID   int64
}

func newDeck(raw string) (deckInfo, error) {
	name := trimJSSpace(raw)
	if name == "" {
		name = DefaultDeckName
	}
	if size := utf8.RuneCountInString(name); size > MaxDeckName {
		return deckInfo{}, &ValidationError{Field: "deckName", Message: fmt.Sprintf("must be at most %d characters", MaxDeckName)}
	}
	if hasControlCharacter(name) {
		return deckInfo{}, &ValidationError{Field: "deckName", Message: "must not contain control characters"}
	}
	// Anki deck names use "::" for hierarchy; an empty segment is not a deck.
	for _, segment := range strings.Split(name, "::") {
		if trimJSSpace(segment) == "" {
			return deckInfo{}, &ValidationError{Field: "deckName", Message: "must not contain empty :: hierarchy segments"}
		}
	}
	id := stableID("deck", name)
	if id <= 1 {
		// Id 1 is reserved for the built-in "Default" deck.
		return deckInfo{}, &ValidationError{Field: "deckName", Message: "derives a reserved deck id"}
	}
	modelName := name + " — Basic"
	modelID := stableID("model", []any{id, modelName})
	if modelID <= 1 {
		return deckInfo{}, &ValidationError{Field: "deckName", Message: "derives a reserved note type id"}
	}
	return deckInfo{Name: name, ID: id, ModelName: modelName, ModelID: modelID}, nil
}

// note is one fully validated, HTML-encoded note waiting for a database id.
type note struct {
	GUID      string
	Fields    string // Front<US>Back
	SortField string
	Checksum  int64
	Tags      string // " tag1 tag2 " or ""
}

func newNotes(ctx context.Context, deck deckInfo, cards []Card) ([]note, error) {
	if len(cards) == 0 {
		return nil, &ValidationError{Field: "cards", Message: "must contain at least one card"}
	}
	if len(cards) > MaxCards {
		return nil, &ValidationError{Field: "cards", Message: fmt.Sprintf("must contain at most %d cards", MaxCards)}
	}

	notes := make([]note, 0, len(cards))
	byID := make(map[string]int, len(cards))
	total := 0
	for index := range cards {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		card := cards[index]
		if err := checkLength(fmt.Sprintf("cards[%d].id", index), card.ID, 1, MaxCardID); err != nil {
			return nil, err
		}
		if _, ok := cardTypes[card.Type]; !ok {
			return nil, &ValidationError{Field: fmt.Sprintf("cards[%d].type", index), Message: fmt.Sprintf("unsupported card type %q", card.Type)}
		}
		if err := checkLength(fmt.Sprintf("cards[%d].front", index), card.Front, 1, MaxFront); err != nil {
			return nil, err
		}
		if err := checkLength(fmt.Sprintf("cards[%d].back", index), card.Back, 1, MaxBack); err != nil {
			return nil, err
		}
		front := textToHTML(card.Front)
		back := textToHTML(card.Back)
		// The previous exporter rejected a Front that is empty after encoding
		// (which also drops NUL and the field separator) with a 500; report it as
		// invalid input instead.
		if trimJSSpace(front) == "" {
			return nil, &ValidationError{Field: fmt.Sprintf("cards[%d].front", index), Message: "must not be blank"}
		}
		total += utf8.RuneCountInString(card.Front) + utf8.RuneCountInString(card.Back)
		if total > MaxTotalChars {
			return nil, &ValidationError{Field: "cards", Message: fmt.Sprintf("content must not exceed %d characters", MaxTotalChars)}
		}
		tags, err := newTags(fmt.Sprintf("cards[%d].tags", index), card.Tags)
		if err != nil {
			return nil, err
		}

		sortField := stripHTML(front)
		entry := note{
			GUID:      noteGUID(deck.ID, deck.ModelID, card.ID),
			Fields:    front + fieldSeparator + back,
			SortField: sortField,
			Checksum:  fieldChecksum(sortField),
			Tags:      tags,
		}
		// The Node exporter wrote notes with INSERT OR REPLACE keyed by GUID, so
		// the last card with a given id wins while the note keeps its position.
		if previous, ok := byID[card.ID]; ok {
			notes[previous] = entry
			continue
		}
		byID[card.ID] = len(notes)
		notes = append(notes, entry)
	}
	return notes, nil
}

// newTags formats the note tags the way the Node exporter did: trim each tag,
// collapse whitespace runs into "_", drop empties, de-duplicate in order and
// pad the space-separated list so Anki can match tags by " tag ".
func newTags(field string, tags []string) (string, error) {
	if len(tags) > MaxTags {
		return "", &ValidationError{Field: field, Message: fmt.Sprintf("must contain at most %d tags", MaxTags)}
	}
	seen := make(map[string]struct{}, len(tags))
	normalized := make([]string, 0, len(tags))
	for _, raw := range tags {
		if err := checkLength(field, raw, 1, MaxTag); err != nil {
			return "", err
		}
		if hasControlCharacter(raw) {
			return "", &ValidationError{Field: field, Message: "must not contain control characters"}
		}
		tag := collapseTagWhitespace(trimJSSpace(raw))
		if tag == "" {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		normalized = append(normalized, tag)
	}
	if len(normalized) == 0 {
		return "", nil
	}
	return " " + strings.Join(normalized, " ") + " ", nil
}

// collapseTagWhitespace replaces every whitespace run inside a tag with "_",
// matching `tag.replace(/\s+/gu, "_")`.
func collapseTagWhitespace(tag string) string {
	var builder strings.Builder
	builder.Grow(len(tag))
	pendingSpace := false
	for _, r := range tag {
		if isJSSpace(r) {
			pendingSpace = true
			continue
		}
		if pendingSpace {
			builder.WriteByte('_')
			pendingSpace = false
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

func checkLength(field, value string, min, max int) error {
	size := utf8.RuneCountInString(value)
	if size < min {
		return &ValidationError{Field: field, Message: fmt.Sprintf("must be at least %d character(s)", min)}
	}
	if size > max {
		return &ValidationError{Field: field, Message: fmt.Sprintf("must be at most %d characters", max)}
	}
	return nil
}

// hasControlCharacter matches /[\u0000-\u001f\u007f]/.
func hasControlCharacter(value string) bool {
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return true
		}
	}
	return false
}

// isJSSpace reports whether r is whitespace for JavaScript's `\s`, `trim()` and
// `\s+` (which additionally covers the BOM).
func isJSSpace(r rune) bool {
	return unicode.IsSpace(r) || r == '\uFEFF'
}

// trimJSSpace trims the characters JavaScript's String.prototype.trim removes.
func trimJSSpace(value string) string {
	return strings.TrimFunc(value, isJSSpace)
}

// buildCollection writes the collection database into a temporary directory
// below the inherited TMPDIR and returns its bytes.
func buildCollection(ctx context.Context, deck deckInfo, notes []note, stamp time.Time) ([]byte, error) {
	dir, err := os.MkdirTemp("", "lexigene-anki-*")
	if err != nil {
		return nil, fmt.Errorf("anki: create temporary directory: %w", err)
	}
	defer os.RemoveAll(dir)

	path := filepath.Join(dir, collectionFile)
	if err := writeCollection(ctx, path, deck, notes, stamp); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("anki: read collection: %w", err)
	}
	return data, nil
}

// packPackage wraps the collection in a ZIP archive with the media manifest,
// the same two entries the Node exporter produced for a media-free deck.
func packPackage(collection []byte, stamp time.Time) ([]byte, error) {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	for _, file := range []struct {
		name string
		data []byte
	}{
		{name: collectionFile, data: collection},
		{name: mediaFile, data: []byte(mediaManifest)},
	} {
		header := &zip.FileHeader{Name: file.name, Method: zip.Deflate, Modified: stamp}
		header.SetMode(0o644)
		writer, err := archive.CreateHeader(header)
		if err != nil {
			return nil, fmt.Errorf("anki: create archive entry %s: %w", file.name, err)
		}
		if _, err := writer.Write(file.data); err != nil {
			return nil, fmt.Errorf("anki: write archive entry %s: %w", file.name, err)
		}
	}
	if err := archive.Close(); err != nil {
		return nil, fmt.Errorf("anki: close archive: %w", err)
	}
	return buffer.Bytes(), nil
}
