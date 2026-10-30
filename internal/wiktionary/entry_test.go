package wiktionary

import (
	"context"
	"strings"
	"testing"
)

// Excerpts from https://en.wiktionary.org/wiki/dingleberry#English.
// The queried entry has its own IPA and senses; its etymology mentions another word.
func TestLookupEntryKeepsDingleberryFactsAndHistoricalRelationSeparate(t *testing.T) {
	stub := &wikiStub{
		title: "dingleberry",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Etymology", "2", "Etymology"),
			stubSection(3, "Pronunciation", "3", "Pronunciation"),
			stubSection(3, "Noun", "4", "Noun"),
			stubSection(4, "Synonyms", "5", "Synonyms"),
			stubSection(2, "French", "6", "French"),
			stubSection(3, "Noun", "7", "Noun_2"),
		},
		texts: map[string]string{
			"2": `<h3>Etymology</h3><p>A (possibly dialectal) alteration of <i>dangleberry</i>.</p>`,
			"3": `<h3>Pronunciation</h3><ul><li>IPA: <span class="IPA">/ˈdɪŋɡəɫbɛɹi/</span><audio>audio control</audio></li></ul>`,
			"4": `<h3>Noun</h3><p><strong>dingleberry</strong> (<i>plural</i> <b>dingleberries</b>)</p>
<ol><li><i>Vaccinium erythrocarpum</i>, the southern mountain cranberry.<sup class="reference">[1]</sup><ul><li>QUOTATION_NOT_A_DEFINITION</li></ul></li>
<li><span class="usage-label-sense">(slang, derogatory)</span> A stupid or foolish person.</li>
<li><span class="usage-label-sense">(slang)</span> Dried fecal matter adhering to anal hair.</li>
<li><span class="usage-label-sense">(dated, manufacturing)</span> Any residual irregularity following processing.</li></ol>
<h4>Synonyms</h4><ul><li>SYNONYMS_NOT_A_DEFINITION</li></ul>`,
			"5": `<h4>Synonyms</h4><ul><li>SYNONYMS_NOT_A_DEFINITION</li></ul>`,
			"7": `<h3>Noun</h3><ol><li>FRENCH_NOT_ENGLISH</li></ol>`,
		},
	}
	_, client := startStub(t, stub)
	references, err := client.LookupEntry(context.Background(), "dingleberry")
	if err != nil || len(references) != 3 {
		t.Fatalf("references = %#v, error = %v", references, err)
	}
	for i, section := range []string{"Pronunciation", "Noun", "Etymology"} {
		if references[i].Headword != "dingleberry" || references[i].Section != section {
			t.Fatalf("lost source identity in reference %d: %#v", i, references[i])
		}
		if !strings.HasSuffix(references[i].URL, "/wiki/dingleberry#"+section) {
			t.Fatalf("wrong source URL: %q", references[i].URL)
		}
	}
	if references[0].Text != "IPA: /ˈdɪŋɡəɫbɛɹi/" {
		t.Fatalf("lost target pronunciation: %q", references[0].Text)
	}
	for _, text := range []string{"dingleberry (plural dingleberries)", "Vaccinium erythrocarpum", "(slang, derogatory) A stupid or foolish person.", "(slang) Dried fecal matter adhering to anal hair.", "(dated, manufacturing)"} {
		if !strings.Contains(references[1].Text, text) {
			t.Fatalf("lost lexical fact %q: %s", text, references[1].Text)
		}
	}
	if references[2].Text != "A (possibly dialectal) alteration of dangleberry." {
		t.Fatalf("changed historical qualification: %q", references[2].Text)
	}
	for _, reference := range references {
		for _, excluded := range []string{"QUOTATION_NOT", "SYNONYMS_NOT", "FRENCH_NOT", "audio control"} {
			if strings.Contains(reference.Text, excluded) {
				t.Fatalf("unrelated content entered reference: %q", reference.Text)
			}
		}
	}
	for _, request := range stub.snapshot() {
		if request.page != "dingleberry" || request.section == "5" || request.section == "7" {
			t.Fatalf("followed another headword or unrelated section: %#v", request)
		}
	}
}

func TestLookupEntrySuppliesSensesWithoutEtymology(t *testing.T) {
	stub := &wikiStub{
		title: "example",
		sections: []map[string]any{
			stubSection(2, "English", "1", "English"),
			stubSection(3, "Noun", "2", "Noun"),
		},
		texts: map[string]string{"2": `<h3>Noun</h3><ol><li>Something representative of other things.</li></ol>`},
	}
	_, client := startStub(t, stub)
	references, err := client.LookupEntry(context.Background(), "example")
	if err != nil || len(references) != 1 || references[0].Section != "Noun" {
		t.Fatalf("lexical context depends on an etymology: %#v, %v", references, err)
	}
}
