package api

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"lexigene/internal/anki"
	"lexigene/internal/contracts"
)

type ankiExportRequest struct {
	DeckName string                `json:"deckName"`
	Cards    []contracts.StudyCard `json:"cards"`
}

type exportIssue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

type exportErrorResponse struct {
	Error  string        `json:"error"`
	Issues []exportIssue `json:"issues,omitempty"`
}

type exportValidationResponse struct {
	Error  string        `json:"error"`
	Issues []exportIssue `json:"issues"`
}

var filenameUnsafe = regexp.MustCompile(`[^\p{L}\p{N}._ -]+`)

// exportAnki builds an .apkg archive for the selected cards.
//
// Cards are validated with the generated card contract plus the export caps
// (control characters, UTF-16 lengths and total content), then packaged by
// internal/anki, which also HTML-encodes the plain-text fields.
func (h *handler) exportAnki(response http.ResponseWriter, request *http.Request) {
	value, ok := readJSON(request)
	if !ok {
		writeJSON(response, http.StatusBadRequest, errorResponse{Error: "Request body must be valid JSON"})
		return
	}
	if object, ok := objectOf(value); ok {
		trimStringField(object, "deckName")
	}

	schema := contracts.Lookup(contracts.NameExportRequest)
	if issues := schema.Issues(value); len(issues) > 0 {
		writeValidationError(response, issues)
		return
	}
	parsed, ok := decodeValue[ankiExportRequest](value)
	if !ok {
		writeValidationError(response, []contracts.Issue{{Path: "cards", Message: "Invalid card payload"}})
		return
	}

	deckName := parsed.DeckName
	if deckName == "" {
		deckName = anki.DefaultDeckName
	}
	cards := make([]anki.Card, 0, len(parsed.Cards))
	for _, card := range parsed.Cards {
		cards = append(cards, anki.Card{
			ID:    card.ID,
			Type:  card.Type,
			Front: card.Front,
			Back:  card.Back,
			Tags:  card.Tags,
		})
	}

	archive, err := anki.Export(request.Context(), deckName, cards)
	if err != nil {
		if request.Context().Err() != nil {
			writeEmpty(response, 499)
			return
		}
		var validationError *anki.ValidationError
		if errors.As(err, &validationError) {
			writeValidationError(response, []contracts.Issue{{
				Path:    dotPath(validationError.Field),
				Message: validationError.Message,
			}})
			return
		}
		log.Printf("Anki export failed: %v", err)
		writeJSON(response, http.StatusInternalServerError, errorResponse{Error: "Failed to build Anki package"})
		return
	}

	filename := fileSafeName(deckName) + ".apkg"
	response.Header().Set("Content-Type", "application/octet-stream")
	response.Header().Set("Content-Disposition", fmt.Sprintf(
		`attachment; filename="%s"; filename*=UTF-8''%s`,
		asciiFilename(filename),
		encodeURIComponent(filename),
	))
	response.Header().Set("Content-Length", strconv.Itoa(len(archive)))
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(archive)
}

func writeValidationError(response http.ResponseWriter, issues []contracts.Issue) {
	converted := make([]exportIssue, 0, len(issues))
	for _, issue := range issues {
		converted = append(converted, exportIssue{Path: issue.Path, Message: issue.Message})
	}
	writeJSON(response, http.StatusBadRequest, exportValidationResponse{
		Error:  "Invalid export request",
		Issues: converted,
	})
}

func fileSafeName(name string) string {
	safe := filenameUnsafe.ReplaceAllString(name, "_")
	safe = strings.TrimLeft(safe, ".")
	safe = strings.TrimSpace(safe)
	if safe == "" {
		return anki.DefaultDeckName
	}
	return safe
}

func asciiFilename(name string) string {
	var builder strings.Builder
	for _, character := range name {
		if character >= 0x20 && character <= 0x7e && character != '"' && character != '\\' {
			builder.WriteRune(character)
		} else {
			builder.WriteByte('_')
		}
	}
	return builder.String()
}

// encodeURIComponent mirrors JavaScript's encodeURIComponent for the
// Content-Disposition filename* parameter.
func encodeURIComponent(value string) string {
	const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
	var builder strings.Builder
	for index := 0; index < len(value); index++ {
		character := value[index]
		if strings.IndexByte(unreserved, character) >= 0 {
			builder.WriteByte(character)
		} else {
			fmt.Fprintf(&builder, "%%%02X", character)
		}
	}
	return builder.String()
}

func dotPath(field string) string {
	field = strings.ReplaceAll(field, "[", ".")
	return strings.ReplaceAll(field, "]", "")
}
