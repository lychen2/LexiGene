import type { AnalysisDocument, StudyCard } from './schema';

/**
 * Pure card construction and export formatting.
 *
 * Cards stay plain text here so the review UI can render them safely. HTML
 * encoding happens only at export time (`textToHtml`, `cardsToTsv`), which keeps
 * stored content free of markup and prevents double escaping.
 */

/**
 * Canonical form used for identifiers: compatibility-normalized, lowercased,
 * whitespace collapsed and control characters removed. No timestamps or random
 * values, so the same semantic card always produces the same id.
 */
function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Stable note id built from the normalized target, language, card type and a
 * semantic key. Deliberately readable and delimiter-safe (JSON array) instead
 * of a content hash: explanations may change, the note identity must not.
 */
function noteId(target: string, language: string, type: StudyCard['type'], semanticKey: string): string {
  return JSON.stringify(['lexigene', normalize(target), normalize(language), type, normalize(semanticKey)]);
}

function tagPart(value: string): string {
  const tag = normalize(value).replace(/[^\p{L}\p{N}_:-]+/gu, '_').replace(/^_+|_+$/g, '');
  return Array.from(tag).slice(0, 40).join('') || 'unknown';
}

function tagsFor(analysis: AnalysisDocument, type: StudyCard['type'], extra: readonly string[] = []): string[] {
  const tags = ['lexigene', `type::${type}`, `lang::${tagPart(analysis.language)}`, `target::${tagPart(analysis.target)}`];
  return [...new Set([...tags, ...extra.map(tagPart).filter(Boolean)])];
}

function lines(...values: (string | undefined)[]): string {
  return values.map(value => value?.trim()).filter((value): value is string => Boolean(value)).join('\n');
}

function exampleLine(en: string, zh: string): string {
  return lines(en, zh);
}

/**
 * Build the complete study-card set for an analysis.
 *
 * One `core` card, one `chunk` card per chunk (and per culture expression), one
 * `nuance` card per contrasted word, one `pitfall` card per mistake and one
 * `quiz` card per quiz question. Duplicate ids are collapsed to the first card
 * so an analysis cannot silently overwrite a note inside the same export.
 */
export function buildCards(analysis: AnalysisDocument): StudyCard[] {
  const { target, language, dimensions } = analysis;
  const cards: StudyCard[] = [];

  const push = (type: StudyCard['type'], semanticKey: string, front: string, back: string, extraTags: readonly string[] = []) => {
    cards.push({
      id: noteId(target, language, type, semanticKey),
      type,
      front,
      back,
      tags: tagsFor(analysis, type, extraTags),
    });
  };

  const { overview } = dimensions.one;
  push(
    'core',
    target,
    target,
    lines(
      overview.core,
      overview.definition,
      overview.pronunciation ? `Pronunciation: ${overview.pronunciation}` : undefined,
      overview.partOfSpeech ? `Part of speech: ${overview.partOfSpeech}` : undefined,
    ),
  );

  for (const item of dimensions.three.chunks.items) {
    push('chunk', item.phrase, item.phrase, lines(item.meaning, exampleLine(item.example.en, item.example.zh)));
  }

  for (const item of dimensions.three.chunks.culture) {
    push(
      'chunk',
      `culture ${item.expression}`,
      item.expression,
      lines(item.explanation, exampleLine(item.example.en, item.example.zh)),
      ['culture'],
    );
  }

  for (const word of dimensions.two.nuance.words) {
    push(
      'nuance',
      word.word,
      word.word,
      lines(
        word.image,
        `Register: ${word.register}/10`,
        word.distinction,
        exampleLine(word.example.en, word.example.zh),
      ),
    );
  }

  for (const item of dimensions.three.pitfalls.items) {
    push(
      'pitfall',
      `${item.wrong} ${item.right}`,
      item.wrong,
      lines(`Correct: ${item.right}`, item.explanation, item.image, item.translation),
    );
  }

  for (const question of dimensions.three.slices.quiz) {
    push(
      'quiz',
      `${question.scenario} ${question.challenge}`,
      lines(question.scenario, question.challenge),
      lines(
        `Focus: ${question.focus}`,
        `Reference: ${question.reference.en}`,
        question.reference.zh,
      ),
    );
  }

  const seen = new Set<string>();
  return cards.filter(card => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape the five HTML-significant characters. Applied before any line-break
 * conversion so encoded entities are never re-interpreted.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => HTML_ENTITIES[character] ?? character);
}

/** Drop Anki's forbidden NUL / field-separator characters before export. */
function stripFieldControls(value: string): string {
  return value.replace(/[\u0000\u001f]/g, '');
}

/** Plain text to Anki field HTML: escaped, line breaks as `<br>`. */
export function textToHtml(value: string): string {
  return escapeHtml(stripFieldControls(value).replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
}

function tsvCell(value: string): string {
  return escapeHtml(stripFieldControls(value).replace(/\r\n?/g, '\n'))
    .replace(/\n/g, '<br>')
    .replace(/\t/g, '&#9;');
}

/**
 * Anki-friendly TSV: one row per card, `front<TAB>back<TAB>tags`, UTF-8 text,
 * `\n` row separators. Line breaks and tabs inside a field are HTML-escaped so
 * they cannot break the row/column structure.
 */
export function cardsToTsv(cards: readonly StudyCard[]): string {
  if (cards.length === 0) return '';
  return cards
    .map(card => [tsvCell(card.front), tsvCell(card.back), tsvCell(card.tags.join(' '))].join('\t'))
    .join('\n')
    .concat('\n');
}
