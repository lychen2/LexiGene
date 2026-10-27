package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func loadJSON(t *testing.T, name string) any {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	return value
}

func asObject(t *testing.T, value any) map[string]any {
	t.Helper()
	object, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("value is %T, want object", value)
	}
	return object
}

func clone(t *testing.T, value any) any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal clone: %v", err)
	}
	var cloned any
	if err := json.Unmarshal(data, &cloned); err != nil {
		t.Fatalf("unmarshal clone: %v", err)
	}
	return cloned
}

func issuePaths(issues []Issue) []string {
	paths := make([]string, 0, len(issues))
	for _, issue := range issues {
		paths = append(paths, issue.Path)
	}
	return paths
}

func containsIssue(issues []Issue, path, message string) bool {
	for _, issue := range issues {
		if issue.Path == path && (message == "" || strings.Contains(issue.Message, message)) {
			return true
		}
	}
	return false
}

func validConfig() map[string]any {
	return map[string]any{
		"baseUrl": "https://api.example.com/v1",
		"apiKey":  "secret-key",
		"model":   "gpt-4o-mini",
	}
}

func TestAllGeneratedSchemasAreEmbedded(t *testing.T) {
	names := []Name{
		NameAPIConfig, NameAPICredentials, NameAnalyzeRequest, NameConnectionTestRequest,
		NameModelsRequest, NameDimensionOne, NameDimensionTwo, NameDimensionThree, NameDraft,
		NameGrade, NameGradeRequest, NameQuizHintsOutput, NameQuizHintsRequest,
		NameQuizQuestion, NameExportRequest,
	}
	if len(schemas) != len(names) {
		t.Fatalf("embedded schemas = %d, want %d", len(schemas), len(names))
	}
	for _, name := range names {
		schema := Lookup(name)
		if schema.Name() != name {
			t.Fatalf("schema name = %q, want %q", schema.Name(), name)
		}
		if schema.Document() == nil {
			t.Fatalf("schema %s has no document", name)
		}
	}
}

func TestGeneratedSchemasUseInputSemantics(t *testing.T) {
	for name, schema := range schemas {
		data, err := json.Marshal(schema.Document())
		if err != nil {
			t.Fatalf("marshal %s: %v", name, err)
		}
		if strings.Contains(string(data), `"additionalProperties":false`) {
			t.Fatalf("%s rejects unknown keys; Zod objects strip them", name)
		}
	}
}

func TestValidFixturesPassTheirContracts(t *testing.T) {
	cases := []struct {
		name    Name
		fixture string
	}{
		{NameDimensionOne, "dimension-one.json"},
		{NameDimensionTwo, "dimension-two.json"},
		{NameDimensionThree, "dimension-three.json"},
		{NameDraft, "draft-full.json"},
		{NameGrade, "grade.json"},
	}
	for _, test := range cases {
		t.Run(string(test.name), func(t *testing.T) {
			if issues := Lookup(test.name).Issues(loadJSON(t, test.fixture)); len(issues) != 0 {
				t.Fatalf("unexpected issues: %+v", issues)
			}
		})
	}

	analyze := map[string]any{
		"config": validConfig(),
		"draft":  loadJSON(t, "draft-full.json"),
	}
	if issues := Lookup(NameAnalyzeRequest).Issues(analyze); len(issues) != 0 {
		t.Fatalf("analyze request issues: %+v", issues)
	}
	gradeRequest := map[string]any{
		"config":   validConfig(),
		"target":   "nostalgia",
		"language": "美式英语",
		"question": map[string]any{
			"id":        "q1",
			"scenario":  "场景",
			"challenge": "要求",
			"focus":     "重点",
			"reference": map[string]any{"en": "example", "zh": "例句"},
		},
		"answer":  "A wave of nostalgia washed over me.",
		"context": map[string]any{"core": "怀念", "register": 6, "subtext": "过去更好", "chunks": []any{map[string]any{"phrase": "a wave of nostalgia", "meaning": "一阵怀念"}}},
	}
	if issues := Lookup(NameGradeRequest).Issues(gradeRequest); len(issues) != 0 {
		t.Fatalf("grade request issues: %+v", issues)
	}
}

func TestStructuralValidationMirrorsZod(t *testing.T) {
	one := asObject(t, clone(t, loadJSON(t, "dimension-one.json")))
	overview := asObject(t, one["overview"])
	overview["core"] = ""
	if issues := Lookup(NameDimensionOne).Issues(one); !containsIssue(issues, "overview.core", "") {
		t.Fatalf("empty core accepted or wrong path: %+v", issues)
	}

	three := asObject(t, clone(t, loadJSON(t, "dimension-three.json")))
	register := asObject(t, three["register"])
	levels := register["levels"].([]any)
	register["levels"] = levels[:9]
	if issues := Lookup(NameDimensionThree).Issues(three); !containsIssue(issues, "register.levels", "") {
		t.Fatalf("nine levels accepted: %+v", issues)
	}

	draft := asObject(t, clone(t, loadJSON(t, "draft-full.json")))
	draft["createdAt"] = "yesterday"
	if issues := Lookup(NameDraft).Issues(draft); !containsIssue(issues, "createdAt", "") {
		t.Fatalf("invalid datetime accepted: %+v", issues)
	}

	grade := asObject(t, clone(t, loadJSON(t, "grade.json")))
	grade["usesTarget"] = "yes"
	if issues := Lookup(NameGrade).Issues(grade); len(issues) == 0 {
		t.Fatal("non-boolean usesTarget accepted")
	}

	analyze := map[string]any{"config": validConfig()}
	if issues := Lookup(NameAnalyzeRequest).Issues(analyze); !containsIssue(issues, "", "") {
		t.Fatalf("missing draft accepted: %+v", issues)
	}
}

func TestRefinementsRejectDuplicateLevelsSettingsAndIDs(t *testing.T) {
	three := asObject(t, clone(t, loadJSON(t, "dimension-three.json")))
	register := asObject(t, three["register"])
	levels := register["levels"].([]any)
	levels[9].(map[string]any)["level"] = float64(1)
	issues := Lookup(NameDimensionThree).Issues(three)
	if !containsIssue(issues, "register.levels", "1 to 10") {
		t.Fatalf("duplicate levels accepted: %+v", issues)
	}

	slices := asObject(t, three["slices"])
	dialogues := slices["dialogues"].([]any)
	dialogues[2].(map[string]any)["setting"] = "friends"
	if issues := Lookup(NameDimensionThree).Issues(three); !containsIssue(issues, "slices.dialogues", "friends") {
		t.Fatalf("duplicate dialogue settings accepted: %+v", issues)
	}

	quiz := slices["quiz"].([]any)
	quiz[1].(map[string]any)["id"] = "q1"
	if issues := Lookup(NameDimensionThree).Issues(three); !containsIssue(issues, "slices.quiz", "unique") {
		t.Fatalf("duplicate quiz ids accepted: %+v", issues)
	}
}

func TestRefinementsApplyToDraftAndAnalyzeRequest(t *testing.T) {
	draft := asObject(t, clone(t, loadJSON(t, "draft-full.json")))
	dimensions := asObject(t, draft["dimensions"])
	three := asObject(t, dimensions["three"])
	levels := three["register"].(map[string]any)["levels"].([]any)
	levels[8].(map[string]any)["level"] = float64(1)

	if issues := Lookup(NameDraft).Issues(draft); !containsIssue(issues, "dimensions.three.register.levels", "") {
		t.Fatalf("draft refinement path = %v", issuePaths(issues))
	}

	analyze := map[string]any{"config": validConfig(), "draft": draft}
	if issues := Lookup(NameAnalyzeRequest).Issues(analyze); !containsIssue(issues, "draft.dimensions.three.register.levels", "") {
		t.Fatalf("analyze refinement path = %v", issuePaths(issues))
	}
}

func TestProviderURLSchemeAndUnknownKeys(t *testing.T) {
	invalid := []map[string]any{
		{"baseUrl": "ftp://example.com/v1", "apiKey": "k", "model": "m"},
		{"baseUrl": "not-a-url", "apiKey": "k", "model": "m"},
		{"baseUrl": "", "apiKey": "k", "model": "m"},
		{"baseUrl": "https://api.example.com/v1", "apiKey": "", "model": "m"},
	}
	for _, config := range invalid {
		if issues := Lookup(NameAPIConfig).Issues(config); len(issues) == 0 {
			t.Fatalf("invalid config accepted: %+v", config)
		}
	}

	withExtras := map[string]any{
		"config": map[string]any{
			"baseUrl": "https://api.example.com/v1",
			"apiKey":  "key",
			"model":   "ignored",
			"extra":   "ignored",
		},
	}
	if issues := Lookup(NameModelsRequest).Issues(withExtras); len(issues) != 0 {
		t.Fatalf("models request rejected extra keys: %+v", issues)
	}
}

func exportCard(id, front, back string, tags []any) map[string]any {
	return map[string]any{
		"id":    id,
		"type":  "core",
		"front": front,
		"back":  back,
		"tags":  tags,
	}
}

func TestExportRefinements(t *testing.T) {
	valid := map[string]any{"cards": []any{exportCard("card-1", "front", "back", []any{"lexigene"})}}
	if issues := Lookup(NameExportRequest).Issues(valid); len(issues) != 0 {
		t.Fatalf("valid export request issues: %+v", issues)
	}

	controlTag := map[string]any{"cards": []any{exportCard("card-1", "front", "back", []any{"bad\x00tag"})}}
	if issues := Lookup(NameExportRequest).Issues(controlTag); !containsIssue(issues, "cards.0.tags.0", "control") {
		t.Fatalf("control tag accepted: %+v", issues)
	}

	controlDeck := map[string]any{
		"deckName": "bad\x00name",
		"cards":    []any{exportCard("card-1", "front", "back", []any{})},
	}
	if issues := Lookup(NameExportRequest).Issues(controlDeck); !containsIssue(issues, "deckName", "control") {
		t.Fatalf("control deck accepted: %+v", issues)
	}

	astralTag := strings.Repeat("😀", 33) // 66 UTF-16 units, 33 code points
	astral := map[string]any{"cards": []any{exportCard("card-1", "front", "back", []any{astralTag})}}
	if issues := Lookup(NameExportRequest).Issues(astral); !containsIssue(issues, "cards.0.tags.0", "64") {
		t.Fatalf("astral tag measured in code points: %+v", issues)
	}

	cards := make([]any, 0, 140)
	for index := 0; index < 140; index++ {
		cards = append(cards, exportCard(
			"card-"+string(rune('a'+index%26))+strings.Repeat("x", index/26),
			"front",
			strings.Repeat("y", 30_000),
			[]any{},
		))
	}
	oversized := map[string]any{"cards": cards}
	if issues := Lookup(NameExportRequest).Issues(oversized); !containsIssue(issues, "cards", "export size limit") {
		t.Fatalf("oversized payload accepted: %+v", issues)
	}
}

func TestValidateFormatsPathsAndBoundsIssues(t *testing.T) {
	one := asObject(t, clone(t, loadJSON(t, "dimension-one.json")))
	one["overview"] = map[string]any{}
	formatted := Lookup(NameDimensionOne).Validate(one)
	if len(formatted) == 0 {
		t.Fatal("expected issues")
	}
	if !strings.Contains(formatted[0], "overview") {
		t.Fatalf("formatted issue = %q", formatted[0])
	}

	root := Lookup(NameAnalyzeRequest).Validate(map[string]any{})
	if len(root) == 0 || !strings.HasPrefix(root[0], "(root):") {
		t.Fatalf("root issue = %v", root)
	}
}
