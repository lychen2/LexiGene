package anki

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// writeCollection creates the collection database at path. It is a pure Go
// operation: modernc.org/sqlite is a cgo-free SQLite translation.
func writeCollection(ctx context.Context, path string, deck deckInfo, notes []note, stamp time.Time) (err error) {
	database, err := sql.Open("sqlite", path)
	if err != nil {
		return fmt.Errorf("anki: open collection: %w", err)
	}
	defer func() {
		if closeErr := database.Close(); err == nil && closeErr != nil {
			err = fmt.Errorf("anki: close collection: %w", closeErr)
		}
	}()
	database.SetMaxOpenConns(1)

	// Keep the database a single self-contained file with no WAL sidecars.
	for _, pragma := range []string{"PRAGMA foreign_keys = OFF", "PRAGMA journal_mode = DELETE"} {
		if _, err := database.ExecContext(ctx, pragma); err != nil {
			return fmt.Errorf("anki: configure collection: %w", err)
		}
	}

	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("anki: begin collection transaction: %w", err)
	}
	defer transaction.Rollback()

	for _, statement := range schemaStatements {
		if _, err := transaction.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("anki: create collection schema: %w", err)
		}
	}

	// Ids and due positions follow the Node exporter: ids ascend from the export
	// timestamp (note id, then card id) and due positions from 1.
	nextID := stamp.UnixMilli()
	if nextID < 2 {
		nextID = 2
	}
	nextDue := int64(1)
	for index := range notes {
		if err := ctx.Err(); err != nil {
			return err
		}
		noteID := nextID
		nextID++
		cardID := nextID
		nextID++

		if _, err := transaction.ExecContext(ctx,
			`INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			noteID,
			notes[index].GUID,
			deck.ModelID,
			stamp.Unix(),
			int64(-1),
			notes[index].Tags,
			notes[index].Fields,
			notes[index].SortField,
			notes[index].Checksum,
			int64(0),
			"",
		); err != nil {
			return fmt.Errorf("anki: insert note: %w", err)
		}

		if _, err := transaction.ExecContext(ctx,
			`INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			cardID,
			noteID,
			deck.ID,
			int64(0),
			stamp.Unix(),
			int64(-1),
			int64(0),
			int64(0),
			nextDue,
			int64(0),
			int64(initialFactor),
			int64(0),
			int64(0),
			int64(0),
			int64(0),
			int64(0),
			int64(0),
			"",
		); err != nil {
			return fmt.Errorf("anki: insert card: %w", err)
		}
		nextDue++
	}

	values, err := collectionValues(deck, stamp, nextDue)
	if err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx,
		`INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		values...,
	); err != nil {
		return fmt.Errorf("anki: insert collection row: %w", err)
	}

	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("anki: commit collection: %w", err)
	}
	return nil
}
