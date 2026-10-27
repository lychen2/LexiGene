package anki

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// fixedStamp is the injectable clock used by the deterministic tests.
var fixedStamp = time.Date(2026, time.October, 27, 14, 20, 5, 221_000_000, time.UTC)

func fixedClock() time.Time { return fixedStamp }

func mustExport(t *testing.T, ctx context.Context, deckName string, cards []Card) []byte {
	t.Helper()
	data, err := export(ctx, deckName, cards, fixedClock)
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("export returned no bytes")
	}
	return data
}

func unpack(t *testing.T, packageBytes []byte) map[string][]byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(packageBytes), int64(len(packageBytes)))
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	entries := make(map[string][]byte, len(reader.File))
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			t.Fatalf("unexpected directory entry %q", file.Name)
		}
		handle, err := file.Open()
		if err != nil {
			t.Fatalf("open archive entry %q: %v", file.Name, err)
		}
		var buffer bytes.Buffer
		if _, err := buffer.ReadFrom(handle); err != nil {
			t.Fatalf("read archive entry %q: %v", file.Name, err)
		}
		handle.Close()
		entries[file.Name] = buffer.Bytes()
	}
	return entries
}

func openDatabase(t *testing.T, collection []byte) *sql.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "collection.anki2")
	if err := os.WriteFile(path, collection, 0o600); err != nil {
		t.Fatalf("write collection: %v", err)
	}
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open collection: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func queryRow(t *testing.T, database *sql.DB, query string, args ...any) []any {
	t.Helper()
	rows, err := database.Query(query, args...)
	if err != nil {
		t.Fatalf("query %q: %v", query, err)
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		t.Fatalf("columns: %v", err)
	}
	if !rows.Next() {
		t.Fatalf("query %q returned no rows", query)
	}
	values := make([]any, len(columns))
	pointers := make([]any, len(columns))
	for index := range values {
		pointers[index] = &values[index]
	}
	if err := rows.Scan(pointers...); err != nil {
		t.Fatalf("scan: %v", err)
	}
	return values
}

func countRows(t *testing.T, database *sql.DB, query string) int {
	t.Helper()
	values := queryRow(t, database, query)
	count, err := strconv.Atoi(stringify(values[0]))
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	return count
}

func stringify(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	default:
		return ""
	}
}

type exportedNote struct {
	GUID      string
	Fields    []string
	Tags      string
	SortField string
	Checksum  int64
}

func readNotes(t *testing.T, database *sql.DB) []exportedNote {
	t.Helper()
	rows, err := database.Query(`SELECT guid, flds, tags, sfld, csum FROM notes ORDER BY id`)
	if err != nil {
		t.Fatalf("read notes: %v", err)
	}
	defer rows.Close()
	var notes []exportedNote
	for rows.Next() {
		var guid, fields, tags string
		var sortField any
		var checksum int64
		if err := rows.Scan(&guid, &fields, &tags, &sortField, &checksum); err != nil {
			t.Fatalf("scan note: %v", err)
		}
		notes = append(notes, exportedNote{
			GUID:      guid,
			Fields:    strings.Split(fields, fieldSeparator),
			Tags:      tags,
			SortField: stringify(sortField),
			Checksum:  checksum,
		})
	}
	return notes
}

func TestExportPackageLayout(t *testing.T) {
	cards := []Card{
		{ID: "card-1", Type: "core", Front: "resent", Back: "把那份不公平，留在心里。", Tags: []string{"lexigene", "type::core"}},
		{ID: "card-2", Type: "chunk", Front: "resent the implication", Back: "固定搭配。", Tags: []string{"lexigene"}},
	}
	data := mustExport(t, context.Background(), "LexiGene", cards)
	if !bytes.HasPrefix(data, []byte("PK\x03\x04")) {
		t.Fatalf("archive does not start with a ZIP local header: %x", data[:4])
	}

	entries := unpack(t, data)
	if len(entries) != 2 {
		t.Fatalf("archive entries = %d, want 2 (collection.anki2, media)", len(entries))
	}
	collection, ok := entries[collectionFile]
	if !ok {
		t.Fatalf("collection entry missing; entries: %v", keys(entries))
	}
	if !bytes.HasPrefix(collection, []byte("SQLite format 3\x00")) {
		t.Fatalf("collection is not a SQLite database: %x", collection[:16])
	}
	if manifest, ok := entries[mediaFile]; !ok || string(manifest) != mediaManifest {
		t.Fatalf("media manifest = %q (present=%v), want %q", manifest, ok, mediaManifest)
	}

	database := openDatabase(t, collection)
	if integrity := stringify(queryRow(t, database, `PRAGMA integrity_check`)[0]); integrity != "ok" {
		t.Fatalf("integrity_check = %q, want ok", integrity)
	}

	for _, table := range []string{"col", "notes", "cards", "revlog", "graves"} {
		if count := countRows(t, database, `SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = '`+table+`'`); count != 1 {
			t.Fatalf("table %q missing", table)
		}
	}
	for _, index := range []string{"ix_notes_usn", "ix_cards_usn", "ix_revlog_usn", "ix_cards_nid", "ix_cards_sched", "ix_revlog_cid", "ix_notes_guid", "ix_notes_csum"} {
		if count := countRows(t, database, `SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = '`+index+`'`); count != 1 {
			t.Fatalf("index %q missing", index)
		}
	}

	if count := countRows(t, database, `SELECT count(*) FROM col`); count != 1 {
		t.Fatalf("col rows = %d, want 1", count)
	}
	row := queryRow(t, database, `SELECT id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags FROM col`)
	if id, _ := row[0].(int64); id != 1 {
		t.Fatalf("col.id = %v, want 1", row[0])
	}
	if crt, _ := row[1].(int64); crt != fixedStamp.Unix() {
		t.Fatalf("col.crt = %d, want %d", crt, fixedStamp.Unix())
	}
	if mod, _ := row[2].(int64); mod != fixedStamp.UnixMilli() {
		t.Fatalf("col.mod = %d, want %d", mod, fixedStamp.UnixMilli())
	}
	if scm, _ := row[3].(int64); scm != fixedStamp.UnixMilli() {
		t.Fatalf("col.scm = %d, want %d", scm, fixedStamp.UnixMilli())
	}
	if ver, _ := row[4].(int64); ver != ankiSchemaVersion {
		t.Fatalf("col.ver = %d, want %d", ver, ankiSchemaVersion)
	}
	if usn, _ := row[6].(int64); usn != -1 {
		t.Fatalf("col.usn = %d, want -1", usn)
	}
	if tags := stringify(row[12]); tags != "{}" {
		t.Fatalf("col.tags = %q, want {}", tags)
	}

	var conf collectionConf
	if err := json.Unmarshal([]byte(stringify(row[8])), &conf); err != nil {
		t.Fatalf("decode conf: %v", err)
	}
	deck := mustDeckInfo(t, "LexiGene")
	if conf.NextPos != int64(len(cards)+1) {
		t.Fatalf("conf.nextPos = %d, want %d", conf.NextPos, len(cards)+1)
	}
	if len(conf.ActiveDecks) != 1 || conf.ActiveDecks[0] != deck.ID || conf.CurDeck != deck.ID {
		t.Fatalf("conf decks = %v / %d, want [%d]", conf.ActiveDecks, conf.CurDeck, deck.ID)
	}
	if conf.CurModel != strconv.FormatInt(deck.ModelID, 10) {
		t.Fatalf("conf.curModel = %q, want %d", conf.CurModel, deck.ModelID)
	}
	if conf.SortType != "noteFld" || !conf.AddToCur || !conf.DueCounts || !conf.EstTimes || conf.CollapseTime != 1200 {
		t.Fatalf("unexpected conf: %+v", conf)
	}

	var decks map[string]deckRecord
	if err := json.Unmarshal([]byte(stringify(row[10])), &decks); err != nil {
		t.Fatalf("decode decks: %v", err)
	}
	if len(decks) != 2 {
		t.Fatalf("decks = %d, want Default + LexiGene", len(decks))
	}
	if named, ok := decks["1"]; !ok || named.Name != "Default" {
		t.Fatalf("default deck missing or renamed: %+v", decks["1"])
	}
	stored, ok := decks[strconv.FormatInt(deck.ID, 10)]
	if !ok {
		t.Fatalf("deck %d missing from %v", deck.ID, keys(decks))
	}
	if stored.Name != "LexiGene" || stored.ID != deck.ID || stored.Usn != -1 || stored.Mod != fixedStamp.Unix() || stored.Conf != 1 {
		t.Fatalf("unexpected deck record: %+v", stored)
	}

	var models map[string]noteModel
	if err := json.Unmarshal([]byte(stringify(row[9])), &models); err != nil {
		t.Fatalf("decode models: %v", err)
	}
	model, ok := models[strconv.FormatInt(deck.ModelID, 10)]
	if !ok {
		t.Fatalf("note type %d missing from %v", deck.ModelID, keys(models))
	}
	if model.Name != "LexiGene — Basic" || model.Type != 0 || model.DID != deck.ID || model.SortF != 0 || model.Usn != -1 {
		t.Fatalf("unexpected note type: %+v", model)
	}
	if len(model.Flds) != 2 || model.Flds[0].Name != "Front" || model.Flds[1].Name != "Back" {
		t.Fatalf("unexpected fields: %+v", model.Flds)
	}
	if model.Flds[0].Ord != 0 || model.Flds[1].Ord != 1 || model.Flds[0].Font != "Arial" || model.Flds[0].Size != 20 {
		t.Fatalf("unexpected field definition: %+v", model.Flds)
	}
	if len(model.Tmpls) != 1 {
		t.Fatalf("templates = %d, want 1", len(model.Tmpls))
	}
	template := model.Tmpls[0]
	if template.Name != "Forward" || template.QFmt != "{{Front}}" || template.AFmt != "{{FrontSide}}\n\n<hr id=\"answer\">\n\n{{Back}}" || template.DID != nil {
		t.Fatalf("unexpected template: %+v", template)
	}
	if model.CSS != ".card { font-family: sans-serif; font-size: 20px; text-align: center; }\n" {
		t.Fatalf("unexpected css: %q", model.CSS)
	}
	if !strings.HasPrefix(model.LatexPre, "\\documentclass[12pt]{article}") || model.LatexPost != "\\end{document}" {
		t.Fatalf("unexpected latex wrapper: %q / %q", model.LatexPre, model.LatexPost)
	}
	if len(model.Req) != 1 || model.Req[0][1] != "all" {
		t.Fatalf("unexpected req: %+v", model.Req)
	}

	var presets map[string]deckPreset
	if err := json.Unmarshal([]byte(stringify(row[11])), &presets); err != nil {
		t.Fatalf("decode dconf: %v", err)
	}
	preset, ok := presets["1"]
	if !ok {
		t.Fatalf("default preset missing: %v", keys(presets))
	}
	if preset.Name != "Default" || preset.New.PerDay != 20 || preset.Rev.MaxIvl != 36500 || preset.Rev.Ease4 != 1.3 || preset.Lapse.LeechFails != 8 {
		t.Fatalf("unexpected preset: %+v", preset)
	}

	notes := readNotes(t, database)
	if len(notes) != len(cards) {
		t.Fatalf("notes = %d, want %d", len(notes), len(cards))
	}
	if count := countRows(t, database, `SELECT count(*) FROM cards`); count != len(cards) {
		t.Fatalf("cards = %d, want %d", count, len(cards))
	}
	seenGUID := map[string]struct{}{}
	for _, note := range notes {
		if len(note.GUID) != 40 {
			t.Fatalf("guid %q is not a SHA-1 hex digest", note.GUID)
		}
		if _, err := hex.DecodeString(note.GUID); err != nil {
			t.Fatalf("guid %q is not hex: %v", note.GUID, err)
		}
		if note.GUID != strings.ToLower(note.GUID) {
			t.Fatalf("guid %q is not lowercase", note.GUID)
		}
		if _, ok := seenGUID[note.GUID]; ok {
			t.Fatalf("duplicate guid %q", note.GUID)
		}
		seenGUID[note.GUID] = struct{}{}
		if len(note.Fields) != 2 {
			t.Fatalf("note %q has %d fields, want 2", note.GUID, len(note.Fields))
		}
		if note.Fields[0] == "" {
			t.Fatalf("note %q has an empty Front", note.GUID)
		}
		if !strings.HasPrefix(note.Tags, " ") || !strings.HasSuffix(note.Tags, " ") {
			t.Fatalf("tags %q are not space padded", note.Tags)
		}
	}
	if notes[0].Tags != " lexigene type::core " {
		t.Fatalf("tags = %q, want %q", notes[0].Tags, " lexigene type::core ")
	}

	cardsRow := queryRow(t, database, `SELECT id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data FROM cards ORDER BY id`)
	if did, _ := cardsRow[2].(int64); did != deck.ID {
		t.Fatalf("card did = %d, want %d", did, deck.ID)
	}
	if ord, _ := cardsRow[3].(int64); ord != 0 {
		t.Fatalf("card ord = %d, want 0", ord)
	}
	if mod, _ := cardsRow[4].(int64); mod != fixedStamp.Unix() {
		t.Fatalf("card mod = %d, want %d", mod, fixedStamp.Unix())
	}
	if usn, _ := cardsRow[5].(int64); usn != -1 {
		t.Fatalf("card usn = %d, want -1", usn)
	}
	// type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags
	for index, want := range []int64{0, 0, 1, 0, 2500, 0, 0, 0, 0, 0, 0} {
		value, _ := cardsRow[6+index].(int64)
		if value != want {
			t.Fatalf("card column %d = %d, want %d", 6+index, value, want)
		}
	}
	if data := stringify(cardsRow[17]); data != "" {
		t.Fatalf("card data = %q, want empty", data)
	}
	dues := queryRow(t, database, `SELECT group_concat(due, ',') FROM (SELECT due FROM cards ORDER BY due)`)
	if got := stringify(dues[0]); got != "1,2" {
		t.Fatalf("card due positions = %q, want %q", got, "1,2")
	}
	if revlog := countRows(t, database, `SELECT count(*) FROM revlog`); revlog != 0 {
		t.Fatalf("revlog = %d, want 0", revlog)
	}
	if graves := countRows(t, database, `SELECT count(*) FROM graves`); graves != 0 {
		t.Fatalf("graves = %d, want 0", graves)
	}
}

func TestExportFieldEncoding(t *testing.T) {
	front := "<script>alert(\"x\")</script> & 'quote'"
	back := "line 1\r\nline 2\rline 3\n&amp; &#39; \x00\x1f<quickly>"
	cards := []Card{{ID: "html-card", Type: "nuance", Front: front, Back: back, Tags: []string{"lexigene"}}}

	entries := unpack(t, mustExport(t, context.Background(), "LexiGene", cards))
	notes := readNotes(t, openDatabase(t, entries[collectionFile]))
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(notes))
	}
	wantFront := "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;"
	wantBack := "line 1<br>line 2<br>line 3<br>&amp;amp; &amp;#39; &lt;quickly&gt;"
	if notes[0].Fields[0] != wantFront {
		t.Fatalf("front = %q\nwant  %q", notes[0].Fields[0], wantFront)
	}
	if notes[0].Fields[1] != wantBack {
		t.Fatalf("back = %q\nwant  %q", notes[0].Fields[1], wantBack)
	}

	// sfld is the decoded Front with tags removed, and csum its checksum.
	wantSortField := "<script>alert(\"x\")</script> & 'quote'"
	if notes[0].SortField != wantSortField {
		t.Fatalf("sfld = %q, want %q", notes[0].SortField, wantSortField)
	}
	sum := sha1.Sum([]byte(wantSortField))
	wantChecksum, err := strconv.ParseInt(hex.EncodeToString(sum[:])[:8], 16, 64)
	if err != nil {
		t.Fatalf("checksum: %v", err)
	}
	if notes[0].Checksum != wantChecksum {
		t.Fatalf("csum = %d, want %d", notes[0].Checksum, wantChecksum)
	}
}

func TestTextToHTML(t *testing.T) {
	cases := []struct{ name, input, want string }{
		{"plain", "resent", "resent"},
		{"entities", "a & b < c > d \" e ' f", "a &amp; b &lt; c &gt; d &quot; e &#39; f"},
		{"newlines", "a\nb\r\nc\rd", "a<br>b<br>c<br>d"},
		{"field controls", "a\x00b\x1fc", "abc"},
		{"unicode", "美式英语 — 把那份不公平", "美式英语 — 把那份不公平"},
		{"already escaped", "&amp;", "&amp;amp;"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := textToHTML(testCase.input); got != testCase.want {
				t.Fatalf("textToHTML(%q) = %q, want %q", testCase.input, got, testCase.want)
			}
		})
	}
	if got := stripHTML(textToHTML("a\nb <c> & '\x1f")); got != "ab <c> & '" {
		t.Fatalf("stripHTML round trip = %q", got)
	}
	if got := stripHTML(textToHTML("&amp; &#39;")); got != "&amp; &#39;" {
		t.Fatalf("stripHTML must decode entities once, got %q", got)
	}
	if got := stripHTML(""); got != "" {
		t.Fatalf("stripHTML(\"\") = %q", got)
	}
}

func TestExportGUIDVectors(t *testing.T) {
	// Expected values were produced independently with Node:
	//   sha1(JSON.stringify([deckId, modelId, ["id", id]]))
	// where deckId/modelId come from the same derivation the Node exporter used.
	deck := mustDeckInfo(t, "LexiGene")
	if deck.ID != 43239061821118 || deck.ModelID != 237076198157277 {
		t.Fatalf("deck ids = %d/%d, want 43239061821118/237076198157277", deck.ID, deck.ModelID)
	}
	cases := []struct {
		id  string
		hex string
	}{
		{`["lexigene","resent","美式英语","core","resent"]`, "d984e89a42a8c18cb6e2da2e8f6c9a1cf5376080"},
		{`quote"back\slash`, "39399bd2e916b0a3798334150c7bb07d812f7b2f"},
		{"ctrl\x01\x1f-tab\t", "df1c6e812ea4c7073067935b768d13063861a85b"},
		{"dash—and \u2028sep", "59ca7e81d78d6c972d3434725ea61a6b91e5cd69"},
		{"lexigene-custom-id", "70f099be9d1e701895ca5b5f590d1732365a867e"},
	}
	for _, testCase := range cases {
		if got := noteGUID(deck.ID, deck.ModelID, testCase.id); got != testCase.hex {
			t.Fatalf("noteGUID(%q) = %s, want %s", testCase.id, got, testCase.hex)
		}
	}
	if got := stableID("deck", "LexiGene"); got != deck.ID {
		t.Fatalf("stableID(deck, LexiGene) = %d, want %d", got, deck.ID)
	}
	if got := stableID("model", []any{deck.ID, basicModelName}); got != deck.ModelID {
		t.Fatalf("stableID(model) = %d, want %d", got, deck.ModelID)
	}
}

// basicModelName keeps the em dash in the note-type name explicit in tests.
const basicModelName = "LexiGene — Basic"

func TestExportIsStableAcrossRuns(t *testing.T) {
	deck := mustDeckInfo(t, "LexiGene")
	cards := []Card{
		{ID: "id-core", Type: "core", Front: "resent", Back: "不满。", Tags: []string{"lexigene", "type::core"}},
		{ID: "id-chunk", Type: "chunk", Front: "resent the implication", Back: "暗指。", Tags: []string{"lexigene"}},
	}

	first := readNotes(t, openDatabase(t, unpack(t, mustExport(t, context.Background(), "LexiGene", cards))[collectionFile]))
	second := readNotes(t, openDatabase(t, unpack(t, mustExport(t, context.Background(), "LexiGene", cards))[collectionFile]))
	if len(first) != len(cards) {
		t.Fatalf("notes = %d, want %d", len(first), len(cards))
	}
	for index := range first {
		if !reflect.DeepEqual(first[index], second[index]) {
			t.Fatalf("note %d differs between identical exports:\n%+v\n%+v", index, first[index], second[index])
		}
	}
	if first[0].GUID != noteGUID(deck.ID, deck.ModelID, "id-core") {
		t.Fatalf("guid = %s, want %s", first[0].GUID, noteGUID(deck.ID, deck.ModelID, "id-core"))
	}
}

func TestExportUpdatesExistingNotesInPlace(t *testing.T) {
	deck := mustDeckInfo(t, "LexiGene")
	cards := []Card{
		{ID: "id-core", Type: "core", Front: "resent", Back: "第一版。", Tags: []string{"lexigene"}},
		{ID: "id-chunk", Type: "chunk", Front: "resent being", Back: "第二版。", Tags: []string{"lexigene"}},
	}
	baselineDatabase := openDatabase(t, unpack(t, mustExport(t, context.Background(), "LexiGene", cards))[collectionFile])
	baselineNotes := readNotes(t, baselineDatabase)

	later := fixedStamp.Add(90 * time.Minute)
	updatedCards := []Card{
		{ID: "id-core", Type: "core", Front: "resent", Back: "第一版。<br>Updated: 修订版", Tags: []string{"lexigene", "type::core"}},
		{ID: "id-chunk", Type: "chunk", Front: "resent being", Back: "第二版。", Tags: []string{"lexigene"}},
	}
	updatedBytes, err := export(context.Background(), "LexiGene", updatedCards, func() time.Time { return later })
	if err != nil {
		t.Fatalf("updated export: %v", err)
	}
	updatedDatabase := openDatabase(t, unpack(t, updatedBytes)[collectionFile])
	updatedNotes := readNotes(t, updatedDatabase)

	if len(updatedNotes) != len(baselineNotes) {
		t.Fatalf("notes = %d, want %d", len(updatedNotes), len(baselineNotes))
	}
	for index := range baselineNotes {
		if updatedNotes[index].GUID != baselineNotes[index].GUID {
			t.Fatalf("note %d guid changed between exports: %s -> %s", index, baselineNotes[index].GUID, updatedNotes[index].GUID)
		}
	}
	if updatedNotes[0].Fields[1] == baselineNotes[0].Fields[1] {
		t.Fatal("updated Back field was not exported")
	}
	if !strings.Contains(updatedNotes[0].Fields[1], "Updated: 修订版") {
		t.Fatalf("updated Back field = %q", updatedNotes[0].Fields[1])
	}
	if updatedNotes[0].Checksum != baselineNotes[0].Checksum {
		t.Fatal("Front field changed, so csum must stay equal")
	}
	// Note ids restart from the new export timestamp; Anki matches notes by
	// GUID, so ids may differ but must stay unique.
	noteIDs := columnInts(t, updatedDatabase, `SELECT id FROM notes ORDER BY id`)
	if len(noteIDs) != len(baselineNotes) || noteIDs[0] == noteIDs[1] {
		t.Fatalf("note ids = %v, want %d unique ids", noteIDs, len(baselineNotes))
	}
	if got := columnInts(t, updatedDatabase, `SELECT nid FROM cards ORDER BY nid`); !equalInts(got, noteIDs) {
		t.Fatalf("card nids = %v, want %v", got, noteIDs)
	}
	if got := mustInt(t, updatedDatabase, `SELECT mod FROM notes WHERE guid = ?`, updatedNotes[0].GUID); got != later.Unix() {
		t.Fatalf("note mod = %d, want %d", got, later.Unix())
	}
	if got := mustInt(t, updatedDatabase, `SELECT mod FROM col WHERE id = 1`); got != later.UnixMilli() {
		t.Fatalf("col mod = %d, want %d", got, later.UnixMilli())
	}
	if deck.ID != stableID("deck", "LexiGene") {
		t.Fatalf("deck id = %d", deck.ID)
	}
}

func TestExportTagNormalization(t *testing.T) {
	cards := []Card{
		{ID: "tags-1", Type: "core", Front: "a", Back: "b", Tags: []string{" lexigene ", "type::core", "a b", "type::core", "lang::美式 英语", "\u00a0"}},
	}
	notes := readNotes(t, openDatabase(t, unpack(t, mustExport(t, context.Background(), "LexiGene", cards))[collectionFile]))
	if got, want := notes[0].Tags, " lexigene type::core a_b lang::美式_英语 "; got != want {
		t.Fatalf("tags = %q, want %q", got, want)
	}

	empty := []Card{{ID: "tags-2", Type: "core", Front: "a", Back: "b"}}
	notes = readNotes(t, openDatabase(t, unpack(t, mustExport(t, context.Background(), "LexiGene", empty))[collectionFile]))
	if notes[0].Tags != "" {
		t.Fatalf("tags = %q, want empty", notes[0].Tags)
	}
}

func TestExportDuplicateCardIDsKeepLastContent(t *testing.T) {
	cards := []Card{
		{ID: "same", Type: "core", Front: "first", Back: "one", Tags: []string{"first"}},
		{ID: "same", Type: "core", Front: "second", Back: "two", Tags: []string{"second"}},
	}
	database := openDatabase(t, unpack(t, mustExport(t, context.Background(), "LexiGene", cards))[collectionFile])
	notes := readNotes(t, database)
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want 1 note for a repeated id", len(notes))
	}
	if notes[0].Fields[0] != "second" || notes[0].Fields[1] != "two" || notes[0].Tags != " second " {
		t.Fatalf("note = %+v, want the last card's content", notes[0])
	}
	if cards := countRows(t, database, `SELECT count(*) FROM cards`); cards != 1 {
		t.Fatalf("cards = %d, want 1", cards)
	}
}

func TestExportDeckHierarchy(t *testing.T) {
	cards := []Card{{ID: "nested", Type: "core", Front: "a", Back: "b"}}
	database := openDatabase(t, unpack(t, mustExport(t, context.Background(), "LexiGene::Resent", cards))[collectionFile])
	var decks map[string]deckRecord
	if err := json.Unmarshal([]byte(stringify(queryRow(t, database, `SELECT decks FROM col`)[0])), &decks); err != nil {
		t.Fatalf("decode decks: %v", err)
	}
	if len(decks) != 3 {
		t.Fatalf("decks = %d, want Default + parent + child: %v", len(decks), keys(decks))
	}
	names := map[string]string{}
	for id, record := range decks {
		names[id] = record.Name
	}
	child := stableID("deck", "LexiGene::Resent")
	parent := stableID("deck", "LexiGene")
	if names[strconv.FormatInt(child, 10)] != "LexiGene::Resent" {
		t.Fatalf("child deck missing: %v", names)
	}
	if names[strconv.FormatInt(parent, 10)] != "LexiGene" {
		t.Fatalf("parent deck missing: %v", names)
	}
	card := queryRow(t, database, `SELECT did FROM cards`)
	if got, _ := card[0].(int64); got != child {
		t.Fatalf("card deck = %d, want %d", got, child)
	}
}

func TestExportDefaultDeckName(t *testing.T) {
	cards := []Card{{ID: "default-deck", Type: "core", Front: "a", Back: "b"}}
	for _, name := range []string{"", "   "} {
		database := openDatabase(t, unpack(t, mustExport(t, context.Background(), name, cards))[collectionFile])
		var decks map[string]deckRecord
		if err := json.Unmarshal([]byte(stringify(queryRow(t, database, `SELECT decks FROM col`)[0])), &decks); err != nil {
			t.Fatalf("decode decks: %v", err)
		}
		deck := mustDeckInfo(t, "LexiGene")
		if record, ok := decks[strconv.FormatInt(deck.ID, 10)]; !ok || record.Name != "LexiGene" {
			t.Fatalf("deck name %q did not fall back to LexiGene: %v", name, decks)
		}
	}
}

func TestExportValidation(t *testing.T) {
	valid := Card{ID: "valid", Type: "core", Front: "resent", Back: "不满。", Tags: []string{"lexigene"}}
	tooManyCards := make([]Card, MaxCards+1)
	for index := range tooManyCards {
		tooManyCards[index] = Card{ID: strconv.Itoa(index), Type: "core", Front: "f", Back: "b"}
	}
	longBack := strings.Repeat("b", MaxBack+1)
	// 102 maximum-size cards exceed the 4,000,000 character content budget while
	// staying below the card count limit.
	wideCards := make([]Card, 102)
	for index := range wideCards {
		wideCards[index] = Card{
			ID:    "wide-" + strconv.Itoa(index),
			Type:  "core",
			Front: strings.Repeat("f", MaxFront),
			Back:  strings.Repeat("b", MaxBack),
		}
	}

	cases := []struct {
		name string
		deck string
		fn   func() []Card
	}{
		{"no cards", "LexiGene", func() []Card { return nil }},
		{"too many cards", "LexiGene", func() []Card { return tooManyCards }},
		{"blank id", "LexiGene", func() []Card { return []Card{{ID: "", Type: "core", Front: "f", Back: "b"}} }},
		{"long id", "LexiGene", func() []Card {
			return []Card{{ID: strings.Repeat("i", MaxCardID+1), Type: "core", Front: "f", Back: "b"}}
		}},
		{"unknown type", "LexiGene", func() []Card { return []Card{{ID: "x", Type: "cloze", Front: "f", Back: "b"}} }},
		{"blank front", "LexiGene", func() []Card { return []Card{{ID: "x", Type: "core", Front: "   ", Back: "b"}} }},
		{"empty front", "LexiGene", func() []Card { return []Card{{ID: "x", Type: "core", Front: "", Back: "b"}} }},
		{"front empty after encoding", "LexiGene", func() []Card {
			return []Card{{ID: "x", Type: "core", Front: "\x00\x1f", Back: "b"}}
		}},
		{"long front", "LexiGene", func() []Card {
			return []Card{{ID: "x", Type: "core", Front: strings.Repeat("f", MaxFront+1), Back: "b"}}
		}},
		{"long back", "LexiGene", func() []Card { return []Card{{ID: "x", Type: "core", Front: "f", Back: longBack}} }},
		{"content budget", "LexiGene", func() []Card { return wideCards }},
		{"too many tags", "LexiGene", func() []Card {
			tags := make([]string, MaxTags+1)
			for index := range tags {
				tags[index] = "t" + strconv.Itoa(index)
			}
			return []Card{{ID: "x", Type: "core", Front: "f", Back: "b", Tags: tags}}
		}},
		{"long tag", "LexiGene", func() []Card {
			return []Card{{ID: "x", Type: "core", Front: "f", Back: "b", Tags: []string{strings.Repeat("t", MaxTag+1)}}}
		}},
		{"control character tag", "LexiGene", func() []Card {
			return []Card{{ID: "x", Type: "core", Front: "f", Back: "b", Tags: []string{"bad\u0001tag"}}}
		}},
		{"long deck name", strings.Repeat("d", MaxDeckName+1), func() []Card { return []Card{valid} }},
		{"control character deck", "deck\u001fname", func() []Card { return []Card{valid} }},
		{"empty hierarchy segment", "LexiGene::", func() []Card { return []Card{valid} }},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := Export(context.Background(), testCase.deck, testCase.fn()); err == nil {
				t.Fatal("export accepted invalid input")
			} else if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error %v does not wrap ErrInvalidInput", err)
			}
		})
	}

	if _, err := Export(context.Background(), "LexiGene", []Card{valid}); err != nil {
		t.Fatalf("valid export rejected: %v", err)
	}
}

func TestExportCardLimit(t *testing.T) {
	cards := make([]Card, MaxCards)
	for index := range cards {
		cards[index] = Card{ID: "limit-" + strconv.Itoa(index), Type: "core", Front: "f", Back: "b"}
	}
	database := openDatabase(t, unpack(t, mustExport(t, context.Background(), "LexiGene", cards))[collectionFile])
	if got := countRows(t, database, `SELECT count(*) FROM notes`); got != MaxCards {
		t.Fatalf("notes = %d, want %d", got, MaxCards)
	}
	if got := countRows(t, database, `SELECT count(DISTINCT guid) FROM notes`); got != MaxCards {
		t.Fatalf("distinct guids = %d, want %d", got, MaxCards)
	}
}

func TestExportRespectsCancellation(t *testing.T) {
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	cards := []Card{{ID: "c", Type: "core", Front: "f", Back: "b"}}
	if _, err := Export(canceled, "LexiGene", cards); !errors.Is(err, context.Canceled) {
		t.Fatalf("export with cancelled context = %v, want context.Canceled", err)
	}

	// A context that starts out live and reports cancellation on a later check
	// makes the "cancelled mid-export" path deterministic.
	midway := &cancelingAfter{Context: context.Background(), remaining: 2}
	cards = []Card{{ID: "c1", Type: "core", Front: "f", Back: "b"}, {ID: "c2", Type: "core", Front: "f", Back: "b"}}
	if _, err := Export(midway, "LexiGene", cards); !errors.Is(err, context.Canceled) {
		t.Fatalf("export with mid-flight cancellation = %v, want context.Canceled", err)
	}
}

// cancelingAfter reports no error for its first `remaining` checks and
// context.Canceled afterwards; Done() stays nil so nothing races.
type cancelingAfter struct {
	context.Context
	remaining int
}

func (c *cancelingAfter) Err() error {
	if c.remaining <= 0 {
		return context.Canceled
	}
	c.remaining--
	return nil
}

func TestExportCleansTemporaryDirectory(t *testing.T) {
	root := t.TempDir()
	t.Setenv("TMPDIR", root)
	data := mustExport(t, context.Background(), "LexiGene", []Card{{ID: "clean", Type: "core", Front: "f", Back: "b"}})
	if len(data) == 0 {
		t.Fatal("no bytes")
	}
	remaining, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("read temp dir: %v", err)
	}
	if len(remaining) != 0 {
		names := make([]string, 0, len(remaining))
		for _, entry := range remaining {
			names = append(names, entry.Name())
		}
		t.Fatalf("temporary directory was not cleaned: %v", names)
	}
}

func mustDeckInfo(t *testing.T, name string) deckInfo {
	t.Helper()
	deck, err := newDeck(name)
	if err != nil {
		t.Fatalf("newDeck(%q): %v", name, err)
	}
	return deck
}

func columnInts(t *testing.T, database *sql.DB, query string) []int64 {
	t.Helper()
	rows, err := database.Query(query)
	if err != nil {
		t.Fatalf("query %q: %v", query, err)
	}
	defer rows.Close()
	var values []int64
	for rows.Next() {
		var value int64
		if err := rows.Scan(&value); err != nil {
			t.Fatalf("scan: %v", err)
		}
		values = append(values, value)
	}
	return values
}

func mustInt(t *testing.T, database *sql.DB, query string, args ...any) int64 {
	t.Helper()
	value := queryRow(t, database, query, args...)[0]
	number, ok := value.(int64)
	if !ok {
		t.Fatalf("value %v is not an integer", value)
	}
	return number
}

func equalInts(left, right []int64) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func keys[T any](values map[string]T) []string {
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
