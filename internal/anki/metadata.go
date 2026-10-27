package anki

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	// ankiSchemaVersion is the legacy collection schema version every .apkg
	// produced by the previous exporter declared.
	ankiSchemaVersion = 11

	// modelCSS, latexPre, latexPost and answerFormat are the stock values of
	// anki-apkg-export's basic model and must stay byte-identical: Anki renders
	// with them on desktop and mobile.
	modelCSS       = ".card { font-family: sans-serif; font-size: 20px; text-align: center; }\n"
	latexPre       = "\\documentclass[12pt]{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\begin{document}"
	latexPost      = "\\end{document}"
	questionFormat = "{{Front}}"
	answerFormat   = "{{FrontSide}}\n\n<hr id=\"answer\">\n\n{{Back}}"

	sortFieldIndex = 0
	modelFont      = "Arial"
	modelFontSize  = 20
	initialFactor  = 2500
)

// schemaStatements is the legacy collection schema, statement by statement. It
// matches the schema anki-apkg-export baked into every package, so Anki's
// import path (and its schema assertions) behave exactly as before.
var schemaStatements = []string{
	`CREATE TABLE col (
		id              integer primary key,
		crt             integer not null,
		mod             integer not null,
		scm             integer not null,
		ver             integer not null,
		dty             integer not null,
		usn             integer not null,
		ls              integer not null,
		conf            text not null,
		models          text not null,
		decks           text not null,
		dconf           text not null,
		tags            text not null
	)`,
	`CREATE TABLE notes (
		id              integer primary key,
		guid            text not null,
		mid             integer not null,
		mod             integer not null,
		usn             integer not null,
		tags            text not null,
		flds            text not null,
		sfld            integer not null,
		csum            integer not null,
		flags           integer not null,
		data            text not null
	)`,
	`CREATE TABLE cards (
		id              integer primary key,
		nid             integer not null,
		did             integer not null,
		ord             integer not null,
		mod             integer not null,
		usn             integer not null,
		type            integer not null,
		queue           integer not null,
		due             integer not null,
		ivl             integer not null,
		factor          integer not null,
		reps            integer not null,
		lapses          integer not null,
		left            integer not null,
		odue            integer not null,
		odid            integer not null,
		flags           integer not null,
		data            text not null
	)`,
	`CREATE TABLE revlog (
		id              integer primary key,
		cid             integer not null,
		usn             integer not null,
		ease            integer not null,
		ivl             integer not null,
		lastIvl         integer not null,
		factor          integer not null,
		time            integer not null,
		type            integer not null
	)`,
	`CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null)`,
	`CREATE INDEX ix_notes_usn on notes (usn)`,
	`CREATE INDEX ix_cards_usn on cards (usn)`,
	`CREATE INDEX ix_revlog_usn on revlog (usn)`,
	`CREATE INDEX ix_cards_nid on cards (nid)`,
	`CREATE INDEX ix_cards_sched on cards (did, queue, due)`,
	`CREATE INDEX ix_revlog_cid on revlog (cid)`,
	`CREATE INDEX ix_notes_guid on notes (guid)`,
	`CREATE INDEX ix_notes_csum on notes (csum)`,
}

// keyedValue keeps the member order of a JSON object that is keyed by id;
// encoding a map would sort the keys instead.
type keyedValue struct {
	id    int64
	value any
}

func marshalIndexed(values []keyedValue) ([]byte, error) {
	var buffer bytes.Buffer
	buffer.WriteByte('{')
	for index, entry := range values {
		if index > 0 {
			buffer.WriteByte(',')
		}
		buffer.WriteString(strconv.Quote(strconv.FormatInt(entry.id, 10)))
		buffer.WriteByte(':')
		encoded, err := json.Marshal(entry.value)
		if err != nil {
			return nil, fmt.Errorf("anki: encode collection metadata: %w", err)
		}
		buffer.Write(encoded)
	}
	buffer.WriteByte('}')
	return buffer.Bytes(), nil
}

type deckRecord struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Desc      string `json:"desc"`
	Mod       int64  `json:"mod"`
	Usn       int    `json:"usn"`
	Conf      int    `json:"conf"`
	Dyn       int    `json:"dyn"`
	Collapsed bool   `json:"collapsed"`
	ExtendNew int    `json:"extendNew"`
	ExtendRev int    `json:"extendRev"`
	NewToday  [2]int `json:"newToday"`
	RevToday  [2]int `json:"revToday"`
	LrnToday  [2]int `json:"lrnToday"`
	TimeToday [2]int `json:"timeToday"`
}

func newDeckRecord(name string, id, modified int64) deckRecord {
	return deckRecord{ID: id, Name: name, Mod: modified, Usn: -1, Conf: 1}
}

// deckRecords lists the deck and every ancestor of its "::" hierarchy, in the
// order the Node exporter inserted them.
func deckRecords(deck deckInfo, modified int64) []keyedValue {
	records := []keyedValue{
		{id: 1, value: newDeckRecord("Default", 1, modified)},
		{id: deck.ID, value: newDeckRecord(deck.Name, deck.ID, modified)},
	}
	seen := map[int64]struct{}{1: {}, deck.ID: {}}
	segments := strings.Split(deck.Name, "::")
	for depth := 1; depth < len(segments); depth++ {
		name := strings.Join(segments[:depth], "::")
		id := stableID("deck", name)
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		records = append(records, keyedValue{id: id, value: newDeckRecord(name, id, modified)})
	}
	return records
}

type modelField struct {
	Name   string   `json:"name"`
	Ord    int      `json:"ord"`
	Sticky bool     `json:"sticky"`
	RTL    bool     `json:"rtl"`
	Font   string   `json:"font"`
	Size   int      `json:"size"`
	Media  []string `json:"media"`
}

type modelTemplate struct {
	Name  string `json:"name"`
	Ord   int    `json:"ord"`
	QFmt  string `json:"qfmt"`
	AFmt  string `json:"afmt"`
	BQFmt string `json:"bqfmt"`
	BAFmt string `json:"bafmt"`
	DID   *int64 `json:"did"`
}

type noteModel struct {
	ID        int64           `json:"id"`
	Name      string          `json:"name"`
	Type      int             `json:"type"`
	Mod       int64           `json:"mod"`
	Usn       int             `json:"usn"`
	DID       int64           `json:"did"`
	SortF     int             `json:"sortf"`
	Tags      []string        `json:"tags"`
	Vers      []string        `json:"vers"`
	Flds      []modelField    `json:"flds"`
	Tmpls     []modelTemplate `json:"tmpls"`
	Req       [][3]any        `json:"req"`
	CSS       string          `json:"css"`
	LatexPre  string          `json:"latexPre"`
	LatexPost string          `json:"latexPost"`
}

// newNoteModel is the "Front"/"Back" basic note type the previous exporter
// created for every deck.
func newNoteModel(deck deckInfo, modified int64) noteModel {
	return noteModel{
		ID:    deck.ModelID,
		Name:  deck.ModelName,
		Type:  0,
		Mod:   modified,
		Usn:   -1,
		DID:   deck.ID,
		SortF: sortFieldIndex,
		Tags:  []string{},
		Vers:  []string{},
		Flds: []modelField{
			{Name: "Front", Ord: 0, Font: modelFont, Size: modelFontSize, Media: []string{}},
			{Name: "Back", Ord: 1, Font: modelFont, Size: modelFontSize, Media: []string{}},
		},
		Tmpls: []modelTemplate{
			{
				Name:  "Forward",
				Ord:   0,
				QFmt:  questionFormat,
				AFmt:  answerFormat,
				BQFmt: "",
				BAFmt: "",
				DID:   nil,
			},
		},
		Req:       [][3]any{{0, "all", []int{sortFieldIndex}}},
		CSS:       modelCSS,
		LatexPre:  latexPre,
		LatexPost: latexPost,
	}
}

type collectionConf struct {
	NextPos       int64   `json:"nextPos"`
	ActiveDecks   []int64 `json:"activeDecks"`
	CurDeck       int64   `json:"curDeck"`
	CurModel      string  `json:"curModel"`
	SortType      string  `json:"sortType"`
	SortBackwards bool    `json:"sortBackwards"`
	AddToCur      bool    `json:"addToCur"`
	NewSpread     int     `json:"newSpread"`
	DueCounts     bool    `json:"dueCounts"`
	TimeLim       int     `json:"timeLim"`
	EstTimes      bool    `json:"estTimes"`
	CollapseTime  int     `json:"collapseTime"`
}

type newPreset struct {
	PerDay        int   `json:"perDay"`
	Delays        []int `json:"delays"`
	Ints          []int `json:"ints"`
	InitialFactor int   `json:"initialFactor"`
	Bury          bool  `json:"bury"`
	Order         int   `json:"order"`
}

type reviewPreset struct {
	PerDay int     `json:"perDay"`
	Fuzz   float64 `json:"fuzz"`
	IvlFct float64 `json:"ivlFct"`
	MaxIvl int     `json:"maxIvl"`
	Ease4  float64 `json:"ease4"`
	Bury   bool    `json:"bury"`
}

type lapsePreset struct {
	LeechFails  int   `json:"leechFails"`
	MinInt      int   `json:"minInt"`
	Delays      []int `json:"delays"`
	LeechAction int   `json:"leechAction"`
	Mult        int   `json:"mult"`
}

type deckPreset struct {
	ID       int64        `json:"id"`
	Name     string       `json:"name"`
	Mod      int64        `json:"mod"`
	Usn      int          `json:"usn"`
	MaxTaken int          `json:"maxTaken"`
	Autoplay bool         `json:"autoplay"`
	Replayq  bool         `json:"replayq"`
	Timer    int          `json:"timer"`
	New      newPreset    `json:"new"`
	Rev      reviewPreset `json:"rev"`
	Lapse    lapsePreset  `json:"lapse"`
}

func defaultPreset() deckPreset {
	return deckPreset{
		ID:       1,
		Name:     "Default",
		MaxTaken: 60,
		Autoplay: true,
		Replayq:  true,
		New: newPreset{
			PerDay:        20,
			Delays:        []int{1, 10},
			Ints:          []int{1, 4, 7},
			InitialFactor: initialFactor,
			Bury:          true,
			Order:         1,
		},
		Rev:   reviewPreset{PerDay: 200, Fuzz: 0.05, IvlFct: 1, MaxIvl: 36500, Ease4: 1.3, Bury: true},
		Lapse: lapsePreset{LeechFails: 8, MinInt: 1, Delays: []int{10}, LeechAction: 0, Mult: 0},
	}
}

// collectionValues returns the `col` row: one row that carries every JSON blob
// Anki reads when it opens the collection.
func collectionValues(deck deckInfo, stamp time.Time, nextPosition int64) ([]any, error) {
	modified := stamp.Unix()
	conf, err := json.Marshal(collectionConf{
		NextPos:       nextPosition,
		ActiveDecks:   []int64{deck.ID},
		CurDeck:       deck.ID,
		CurModel:      strconv.FormatInt(deck.ModelID, 10),
		SortType:      "noteFld",
		SortBackwards: false,
		AddToCur:      true,
		NewSpread:     0,
		DueCounts:     true,
		TimeLim:       0,
		EstTimes:      true,
		CollapseTime:  1200,
	})
	if err != nil {
		return nil, fmt.Errorf("anki: encode collection config: %w", err)
	}
	models, err := marshalIndexed([]keyedValue{{id: deck.ModelID, value: newNoteModel(deck, modified)}})
	if err != nil {
		return nil, err
	}
	decks, err := marshalIndexed(deckRecords(deck, modified))
	if err != nil {
		return nil, err
	}
	dconf, err := marshalIndexed([]keyedValue{{id: 1, value: defaultPreset()}})
	if err != nil {
		return nil, err
	}

	return []any{
		int64(1),                 // id
		stamp.Unix(),             // crt
		stamp.UnixMilli(),        // mod
		stamp.UnixMilli(),        // scm
		int64(ankiSchemaVersion), // ver
		int64(0),                 // dty
		int64(-1),                // usn
		int64(0),                 // ls
		string(conf),             // conf
		string(models),           // models
		string(decks),            // decks
		string(dconf),            // dconf
		"{}",                     // tags
	}, nil
}
