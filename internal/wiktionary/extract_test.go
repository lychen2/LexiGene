package wiktionary

import (
	"reflect"
	"testing"
)

func TestExtractEtymologyParagraphsStopsAtFirstSubheading(t *testing.T) {
	fragment := `<div class="mw-content-ltr mw-parser-output" lang="en" dir="ltr">
<meta property="mw:PageProp/toc" />
<div class="mw-heading mw-heading3"><h3 id="Etymology_1">Etymology 1</h3><span class="mw-editsection"><span class="mw-editsection-bracket">[</span><a href="/w/index.php?title=gaslight&amp;action=edit&amp;section=1">edit</a><span class="mw-editsection-bracket">]</span></span></div>
<p>From <i class="Latn mention" lang="en">gas</i> +&#8206; <i class="Latn mention" lang="en">light</i>.<sup id="cite_ref-1" class="reference"><a href="#cite_note-1"><span class="cite-bracket">&#91;</span>1<span class="cite-bracket">&#93;</span></a></sup></p>
<p>Second   paragraph
with a <br>break and a <span class="noprint">NO PRINT</span>.</p>
<figure typeof="mw:File/Thumb"><a><img src="x.jpg" alt="" /></a><figcaption>CAPTION SHOULD NOT APPEAR</figcaption></figure>
<table class="translations"><tr><td>TABLE SHOULD NOT APPEAR</td></tr></table>
<script>SCRIPT SHOULD NOT APPEAR</script>
<style>STYLE SHOULD NOT APPEAR</style>
<div class="mw-heading mw-heading4"><h4 id="Noun">Noun</h4><span class="mw-editsection">[edit]</span></div>
<p>DEFINITION SHOULD NOT APPEAR</p>
<ul><li>LIST SHOULD NOT APPEAR</li></ul>
</div>`

	want := []string{
		"From gas + light.",
		"Second paragraph with a break and a .",
	}
	if got := extractEtymologyParagraphs(fragment); !reflect.DeepEqual(got, want) {
		t.Fatalf("paragraphs = %#v, want %#v", got, want)
	}
}

func TestExtractEtymologyParagraphsWithoutHeadingCollectsProse(t *testing.T) {
	fragment := `<p>First paragraph.</p><p>Second paragraph.</p>`
	want := []string{"First paragraph.", "Second paragraph."}
	if got := extractEtymologyParagraphs(fragment); !reflect.DeepEqual(got, want) {
		t.Fatalf("paragraphs = %#v, want %#v", got, want)
	}
}

func TestExtractEtymologyParagraphsEmptyInput(t *testing.T) {
	for _, fragment := range []string{"", "   \n\t ", "<div></div>", "<div><div class=\"mw-heading\"><h3>Etymology</h3></div></div>"} {
		if got := extractEtymologyParagraphs(fragment); got != nil {
			t.Errorf("extractEtymologyParagraphs(%q) = %#v, want nil", fragment, got)
		}
	}
}

func TestNormalizeText(t *testing.T) {
	input := "\u00a0 From\u200e gas\u200b + light. \n"
	if got, want := normalizeText(input), "From gas + light."; got != want {
		t.Fatalf("normalizeText(%q) = %q, want %q", input, got, want)
	}
}

func TestEnglishEtymologySections(t *testing.T) {
	sections := []section{
		{Level: "2", Line: "Translingual", Index: "1"},
		{Level: "3", Line: "Etymology", Index: "2"},
		{Level: "2", Line: "English", Index: "3"},
		{Level: "3", Line: "Pronunciation", Index: "4"},
		{Level: "3", Line: "Etymology", Index: "5"},
		{Level: "4", Line: "Etymology", Index: "6"},
		{Level: "3", Line: "Etymology 12", Index: "7"},
		{Level: "3", Line: "Etymologies", Index: "8"},
		{Level: "3", Line: "Etymology and usage", Index: "9"},
		{Level: "2", Line: "French", Index: "10"},
		{Level: "3", Line: "Etymology", Index: "11"},
	}
	var want []section
	want = append(want, sections[4], sections[6])
	if got := englishEtymologySections(sections); !reflect.DeepEqual(got, want) {
		t.Fatalf("englishEtymologySections = %#v, want %#v", got, want)
	}

	if got := englishEtymologySections([]section{{Level: "2", Line: "French"}}); got != nil {
		t.Errorf("missing English returned %#v, want nil", got)
	}
}

func TestTruncateRunes(t *testing.T) {
	if got, want := truncateRunes("short", 10), "short"; got != want {
		t.Errorf("truncateRunes short = %q, want %q", got, want)
	}
	long := "alpha beta gamma delta epsilon"
	got := truncateRunes(long, 20)
	if runes := []rune(got); len(runes) > 20 {
		t.Errorf("truncateRunes produced %d runes, want at most 20: %q", len(runes), got)
	}
	if got == long || got[len(got)-3:] != "…" {
		t.Errorf("truncateRunes did not truncate cleanly: %q", got)
	}
	if got := truncateRunes(long, 0); got != "" {
		t.Errorf("truncateRunes with zero limit = %q, want empty", got)
	}
}
