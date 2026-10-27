package anki

import (
	"bytes"
	"context"
	"encoding/json"
	"html"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"unicode"
)

// baselineArtifact is the .apkg the Node implementation produced for the
// "resent" analysis. It is read-only input: the test proves that a package
// built here produces the same note GUIDs, fields, tags, sort fields and
// checksums, which is what keeps Anki from creating duplicate notes after the
// migration.
const baselineArtifact = "../../artifacts/resent.apkg"

// TestNodeBaselinePackageCompatibility reads the old Node package directly and
// re-imports its content through Export.
func TestNodeBaselinePackageCompatibility(t *testing.T) {
	path := filepath.FromSlash(baselineArtifact)
	baselineBytes, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		t.Skipf("baseline artifact %s is not present", path)
	}
	if err != nil {
		t.Fatalf("read baseline artifact: %v", err)
	}

	baseline := openDatabase(t, unpack(t, baselineBytes)[collectionFile])
	baselineNotes := readNotes(t, baseline)
	if len(baselineNotes) == 0 {
		t.Fatal("baseline artifact has no notes")
	}

	// The deck and note-type ids stored in the artifact are the reference for
	// the id derivation in this package.
	metadata := queryRow(t, baseline, `SELECT decks, models FROM col`)
	var decks map[string]deckRecord
	if err := json.Unmarshal([]byte(stringify(metadata[0])), &decks); err != nil {
		t.Fatalf("decode baseline decks: %v", err)
	}
	var baselineDeckID int64
	for id, record := range decks {
		if record.Name != "LexiGene" {
			continue
		}
		baselineDeckID = record.ID
		if parsed, err := strconv.ParseInt(id, 10, 64); err != nil || parsed != record.ID {
			t.Fatalf("baseline deck key %q does not match id %d", id, record.ID)
		}
	}
	if baselineDeckID == 0 {
		t.Fatal("baseline artifact has no LexiGene deck")
	}
	var baselineModels map[string]noteModel
	if err := json.Unmarshal([]byte(stringify(metadata[1])), &baselineModels); err != nil {
		t.Fatalf("decode baseline models: %v", err)
	}
	if len(baselineModels) != 1 {
		t.Fatalf("baseline note types = %d, want 1", len(baselineModels))
	}
	var baselineModel noteModel
	for _, model := range baselineModels {
		baselineModel = model
	}
	if baselineModel.Name != "LexiGene — Basic" || baselineModel.DID != baselineDeckID {
		t.Fatalf("unexpected baseline note type: %+v", baselineModel)
	}

	deck := mustDeckInfo(t, "LexiGene")
	if deck.ID != baselineDeckID {
		t.Fatalf("deck id = %d, baseline has %d", deck.ID, baselineDeckID)
	}
	if deck.ModelID != baselineModel.ID {
		t.Fatalf("note type id = %d, baseline has %d", deck.ModelID, baselineModel.ID)
	}
	ours := newNoteModel(deck, baselineModel.Mod)
	if !reflect.DeepEqual(ours.Flds, baselineModel.Flds) {
		t.Fatalf("note type fields differ:\nours:     %+v\nbaseline: %+v", ours.Flds, baselineModel.Flds)
	}
	if !reflect.DeepEqual(ours.Tmpls, baselineModel.Tmpls) {
		t.Fatalf("templates differ:\nours:     %+v\nbaseline: %+v", ours.Tmpls, baselineModel.Tmpls)
	}
	if !sameJSON(t, ours.Req, baselineModel.Req) {
		t.Fatalf("card requirement differs:\nours:     %+v\nbaseline: %+v", ours.Req, baselineModel.Req)
	}
	if ours.CSS != baselineModel.CSS || ours.LatexPre != baselineModel.LatexPre || ours.LatexPost != baselineModel.LatexPost {
		t.Fatalf("styling differs:\nours:     %q / %q / %q\nbaseline: %q / %q / %q",
			ours.CSS, ours.LatexPre, ours.LatexPost, baselineModel.CSS, baselineModel.LatexPre, baselineModel.LatexPost)
	}
	if ours.SortF != baselineModel.SortF || ours.Type != baselineModel.Type {
		t.Fatalf("note type sort/type differs: %d/%d vs %d/%d", ours.SortF, ours.Type, baselineModel.SortF, baselineModel.Type)
	}

	// Rebuild the input cards from the old notes. The semantic card id is the
	// JSON array noteId() in src/lib/cards.ts builds from the normalized target,
	// language, type and semantic key. The key is the Front field here, except
	// for pitfalls, which key on "<wrong> <right>" where the right form is the
	// first line of the Back field prefixed with "Correct: ".
	cards := make([]Card, 0, len(baselineNotes))
	for _, note := range baselineNotes {
		front := plainField(note.Fields[0])
		back := plainField(note.Fields[1])
		tags := strings.Fields(note.Tags)
		cardType := tagValue(tags, "type::")
		if cardType == "" {
			t.Fatalf("baseline note %s has no type:: tag: %v", note.GUID, tags)
		}
		key := front
		if cardType == "pitfall" {
			right := strings.SplitN(back, "\n", 2)[0]
			key = front + " " + strings.TrimPrefix(right, "Correct: ")
		}
		id, err := json.Marshal([]string{
			"lexigene",
			idNormalize(tagValue(tags, "target::")),
			idNormalize(tagValue(tags, "lang::")),
			cardType,
			idNormalize(key),
		})
		if err != nil {
			t.Fatalf("encode card id: %v", err)
		}
		if strings.ContainsAny(string(id), "<>&") {
			t.Fatalf("unexpected HTML-significant card id %s", id)
		}
		cards = append(cards, Card{ID: string(id), Type: cardType, Front: front, Back: back, Tags: tags})
	}

	exportedBytes := mustExport(t, context.Background(), "LexiGene", cards)
	exported := readNotes(t, openDatabase(t, unpack(t, exportedBytes)[collectionFile]))

	if len(exported) != len(baselineNotes) {
		t.Fatalf("exported notes = %d, want %d", len(exported), len(baselineNotes))
	}
	sortNotes(baselineNotes)
	sortNotes(exported)
	for index := range baselineNotes {
		want := baselineNotes[index]
		got := exported[index]
		if got.GUID != want.GUID {
			t.Fatalf("note %d GUID = %s, baseline has %s", index, got.GUID, want.GUID)
		}
		if !reflect.DeepEqual(got.Fields, want.Fields) {
			t.Fatalf("note %s fields differ:\nours:     %q\nbaseline: %q", got.GUID, got.Fields, want.Fields)
		}
		if got.Tags != want.Tags {
			t.Fatalf("note %s tags = %q, baseline has %q", got.GUID, got.Tags, want.Tags)
		}
		if got.SortField != want.SortField {
			t.Fatalf("note %s sfld = %q, baseline has %q", got.GUID, got.SortField, want.SortField)
		}
		if got.Checksum != want.Checksum {
			t.Fatalf("note %s csum = %d, baseline has %d", got.GUID, got.Checksum, want.Checksum)
		}
	}

	// The old package must not be modified by exporting.
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("re-read baseline artifact: %v", err)
	}
	if !bytes.Equal(after, baselineBytes) {
		t.Fatal("baseline artifact changed during export")
	}
}

func tagValue(tags []string, prefix string) string {
	for _, tag := range tags {
		if strings.HasPrefix(tag, prefix) {
			return strings.TrimPrefix(tag, prefix)
		}
	}
	return ""
}

// idNormalize mirrors normalize() in src/lib/cards.ts: collapse whitespace,
// trim and lowercase. Unicode NFKC is skipped because the baseline content is
// already normalized, which the GUID comparison below would catch.
func idNormalize(value string) string {
	return strings.ToLower(strings.Join(strings.FieldsFunc(value, unicode.IsSpace), " "))
}

// plainField turns an exported HTML field back into the plain text the card was
// built from.
func plainField(field string) string {
	return html.UnescapeString(strings.ReplaceAll(field, "<br>", "\n"))
}

// sameJSON compares two values by their JSON encoding, so decoded numbers
// (float64) and typed numbers marshal equal.
func sameJSON(t *testing.T, left, right any) bool {
	t.Helper()
	leftJSON, err := json.Marshal(left)
	if err != nil {
		t.Fatalf("marshal left: %v", err)
	}
	rightJSON, err := json.Marshal(right)
	if err != nil {
		t.Fatalf("marshal right: %v", err)
	}
	return bytes.Equal(leftJSON, rightJSON)
}

func sortNotes(notes []exportedNote) {
	sort.Slice(notes, func(left, right int) bool { return notes[left].GUID < notes[right].GUID })
}
