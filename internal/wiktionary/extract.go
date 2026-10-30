package wiktionary

import (
	"strings"

	"golang.org/x/net/html"
)

var invisibleRunes = strings.NewReplacer(
	"\u00a0", " ",
	"\u200b", "",
	"\u200e", "",
	"\u200f", "",
	"\u2028", " ",
	"\u2029", " ",
	"\ufeff", "",
)

// extractEtymologyParagraphs turns one action=parse&prop=text section body
// into normalized readable paragraphs. The section's own heading is skipped
// and everything from the first subsequent heading on is ignored, which drops
// part-of-speech definitions, descendant lists, translations, references, and
// other subsections. Edit controls, scripts, styles, tables, figures, and
// citation markers are removed. The returned paragraphs contain plain text
// only.
func extractEtymologyParagraphs(fragment string) []string {
	return extractSectionParagraphs(fragment, false)
}

// Definitions and IPA are list items on Wiktionary. Keep their inline usage
// labels while excluding nested quotations, citations and example lists.
func extractLexicalParagraphs(fragment string) []string {
	return extractSectionParagraphs(fragment, true)
}

func extractSectionParagraphs(fragment string, includeLists bool) []string {
	if strings.TrimSpace(fragment) == "" {
		return nil
	}
	doc, err := html.Parse(strings.NewReader(fragment))
	if err != nil {
		return nil
	}

	started := !hasHeading(doc)
	stopped := false
	var paragraphs []string

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if stopped {
			return
		}
		if n.Type == html.ElementNode {
			if isHeadingElement(n) {
				if !started {
					started = true
					return
				}
				stopped = true
				return
			}
			if shouldSkipNode(n) {
				return
			}
			if n.Data == "p" || (includeLists && n.Data == "li") {
				if started {
					content := textContent(n)
					if includeLists {
						content = lexicalTextContent(n)
					}
					if text := normalizeText(content); text != "" {
						paragraphs = append(paragraphs, text)
					}
				}
				return
			}
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(doc)
	return paragraphs
}

func hasHeading(n *html.Node) bool {
	if n.Type == html.ElementNode && isHeadingElement(n) {
		return true
	}
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		if hasHeading(child) {
			return true
		}
	}
	return false
}

func isHeadingElement(n *html.Node) bool {
	switch n.Data {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		return n.Type == html.ElementNode
	}
	return false
}

func shouldSkipNode(n *html.Node) bool {
	switch n.Data {
	case "script", "style", "noscript", "table", "figure", "figcaption", "audio", "video":
		return true
	case "sup":
		return hasClass(n, "reference")
	}
	return hasClass(n, "mw-editsection") || hasClass(n, "noprint")
}

func hasClass(n *html.Node, class string) bool {
	if n.Type != html.ElementNode {
		return false
	}
	for _, attr := range n.Attr {
		if attr.Key != "class" {
			continue
		}
		for _, field := range strings.Fields(attr.Val) {
			if field == class {
				return true
			}
		}
	}
	return false
}

// textContent concatenates the visible text of n, skipping controls and
// markup that would add noise to prose.
func textContent(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		switch n.Type {
		case html.TextNode:
			b.WriteString(n.Data)
			return
		case html.ElementNode:
			if shouldSkipNode(n) {
				return
			}
			if n.Data == "br" {
				b.WriteByte(' ')
				return
			}
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return b.String()
}

func lexicalTextContent(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.TextNode {
			b.WriteString(node.Data)
			return
		}
		if node.Type == html.ElementNode {
			if shouldSkipNode(node) {
				return
			}
			switch node.Data {
			case "ul", "ol", "dl":
				return
			case "br":
				b.WriteByte(' ')
				return
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return b.String()
}

// normalizeText collapses whitespace and drops zero-width layout controls so
// retrieved prose is a single clean line per paragraph.
func normalizeText(s string) string {
	s = invisibleRunes.Replace(s)
	return strings.Join(strings.Fields(s), " ")
}
