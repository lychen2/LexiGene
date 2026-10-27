package anki

import "strings"

// htmlEscaper escapes the five HTML-significant characters, in one pass, so the
// replacement text is never re-interpreted. It matches escapeHtml in
// src/lib/cards.ts (including `&#39;` for the apostrophe).
var htmlEscaper = strings.NewReplacer(
	"&", "&amp;",
	"<", "&lt;",
	">", "&gt;",
	`"`, "&quot;",
	"'", "&#39;",
)

// textToHTML converts plain card text to an Anki field: NUL and the Anki field
// separator are dropped, CRLF/CR become LF, HTML is escaped and every LF becomes
// a `<br>` tag. This mirrors textToHtml in src/lib/cards.ts.
func textToHTML(value string) string {
	return strings.ReplaceAll(htmlEscaper.Replace(normalizeNewlines(stripFieldControls(value))), "\n", "<br>")
}

// stripFieldControls drops the two characters Anki forbids inside a field. All
// other control characters are preserved, exactly like the previous exporter.
func stripFieldControls(value string) string {
	return strings.Map(func(r rune) rune {
		if r == 0x00 || r == 0x1f {
			return -1
		}
		return r
	}, value)
}

// normalizeNewlines reproduces `value.replace(/\r\n?/g, "\n")`.
func normalizeNewlines(value string) string {
	if !strings.ContainsRune(value, '\r') {
		return value
	}
	value = strings.ReplaceAll(value, "\r\n", "\n")
	return strings.ReplaceAll(value, "\r", "\n")
}

// htmlEntities are the escapes textToHTML can emit; `notes.sfld` is the decoded
// field text with tags removed.
var htmlEntities = []struct {
	entity string
	rune   string
}{
	{"&amp;", "&"},
	{"&lt;", "<"},
	{"&gt;", ">"},
	{"&quot;", `"`},
	{"&#39;", "'"},
}

// stripHTML reproduces stripHtml from anki-apkg-export: remove tags, then decode
// HTML entities once, left to right. Only the entities textToHTML emits can
// occur here because the field was escaped first, so a literal "<script>" in
// card text stays plain text instead of being stripped as markup.
func stripHTML(value string) string {
	return decodeHTMLEntities(stripTags(value))
}

// stripTags removes every `<...>` span, like `value.replace(/<[^>]*>/g, "")`.
func stripTags(value string) string {
	if !strings.ContainsRune(value, '<') {
		return value
	}
	var builder strings.Builder
	builder.Grow(len(value))
	for index := 0; index < len(value); {
		if value[index] != '<' {
			builder.WriteByte(value[index])
			index++
			continue
		}
		if end := strings.IndexByte(value[index:], '>'); end >= 0 {
			index += end + 1
			continue
		}
		builder.WriteByte(value[index])
		index++
	}
	return builder.String()
}

// decodeHTMLEntities decodes known entities in a single left-to-right pass, so
// "&amp;lt;" becomes "&lt;" and is not decoded twice.
func decodeHTMLEntities(value string) string {
	if !strings.ContainsRune(value, '&') {
		return value
	}
	var builder strings.Builder
	builder.Grow(len(value))
	for index := 0; index < len(value); {
		if value[index] == '&' {
			matched := false
			for _, entry := range htmlEntities {
				if strings.HasPrefix(value[index:], entry.entity) {
					builder.WriteString(entry.rune)
					index += len(entry.entity)
					matched = true
					break
				}
			}
			if matched {
				continue
			}
		}
		builder.WriteByte(value[index])
		index++
	}
	return builder.String()
}
