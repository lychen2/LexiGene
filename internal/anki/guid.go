package anki

import (
	"crypto/sha1"
	"encoding/hex"
	"strconv"
	"strings"
	"unicode/utf8"
)

// fieldSeparator is the byte Anki uses between note fields. It is written
// literally by both exporters and must never appear inside a field.
const fieldSeparator = "\x1f"

// noteGUID reproduces the Node exporter's note identity:
//
//	sha1(JSON.stringify([deckId, modelId, ["id", noteId]]))
//
// The value is the note's `notes.guid`, so any change to this function breaks
// migration from packages produced by the previous exporter.
func noteGUID(deckID, modelID int64, noteID string) string {
	var builder strings.Builder
	builder.Grow(len(noteID) + 64)
	builder.WriteByte('[')
	builder.WriteString(strconv.FormatInt(deckID, 10))
	builder.WriteByte(',')
	builder.WriteString(strconv.FormatInt(modelID, 10))
	builder.WriteString(`,["id",`)
	appendJSONString(&builder, noteID)
	builder.WriteString("]]")
	return sha1Hex(builder.String())
}

// stableID reproduces `parseInt(sha1(JSON.stringify([namespace, value])).slice(0, 12), 16) || 2`
// and is used for the deck and note-type ids.
func stableID(namespace string, value any) int64 {
	var builder strings.Builder
	builder.WriteByte('[')
	appendJSONString(&builder, namespace)
	builder.WriteByte(',')
	appendJSONValue(&builder, value)
	builder.WriteByte(']')
	id, err := strconv.ParseInt(sha1Hex(builder.String())[:12], 16, 64)
	if err != nil || id <= 0 {
		return 2
	}
	return id
}

// fieldChecksum reproduces `parseInt(sha1(stripHtml(field)).slice(0, 8), 16)`,
// the value Anki caches in `notes.csum` for duplicate detection.
func fieldChecksum(sortField string) int64 {
	value, err := strconv.ParseInt(sha1Hex(sortField)[:8], 16, 64)
	if err != nil {
		return 0
	}
	return value
}

func sha1Hex(value string) string {
	sum := sha1.Sum([]byte(value))
	return hex.EncodeToString(sum[:])
}

// appendJSONValue writes the small subset of JSON values the id derivation
// needs: strings, integers and arrays of those.
func appendJSONValue(builder *strings.Builder, value any) {
	switch typed := value.(type) {
	case string:
		appendJSONString(builder, typed)
	case int64:
		builder.WriteString(strconv.FormatInt(typed, 10))
	case int:
		builder.WriteString(strconv.Itoa(typed))
	case []any:
		builder.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				builder.WriteByte(',')
			}
			appendJSONValue(builder, item)
		}
		builder.WriteByte(']')
	default:
		panic("anki: unsupported JSON value in id derivation")
	}
}

// appendJSONString writes value as a JSON string literal with exactly the
// escaping rules of JavaScript's JSON.stringify: short escapes for \b \t \n \f
// \r, \u00XX for the remaining C0 controls, and no escaping of non-ASCII,
// U+2028 or U+2029 (encoding/json would escape those and change the GUID).
func appendJSONString(builder *strings.Builder, value string) {
	const hexDigits = "0123456789abcdef"
	builder.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"':
			builder.WriteString(`\"`)
		case '\\':
			builder.WriteString(`\\`)
		case '\b':
			builder.WriteString(`\b`)
		case '\f':
			builder.WriteString(`\f`)
		case '\n':
			builder.WriteString(`\n`)
		case '\r':
			builder.WriteString(`\r`)
		case '\t':
			builder.WriteString(`\t`)
		default:
			if r < 0x20 {
				builder.WriteString(`\u00`)
				builder.WriteByte(hexDigits[(r>>4)&0xf])
				builder.WriteByte(hexDigits[r&0xf])
				continue
			}
			if r == utf8.RuneError {
				// Invalid UTF-8 input byte; JSON.stringify of a string always
				// produces well-formed output, so normalise to U+FFFD.
				builder.WriteRune(utf8.RuneError)
				continue
			}
			builder.WriteRune(r)
		}
	}
	builder.WriteByte('"')
}
