/**
 * Words woven into the hero's double helix.
 *
 * The ribbon must speak the language being studied, so terms come from the
 * analysis itself: the target, its word-formation units, its relatives, its
 * near-synonyms and its collocations. When an analysis is still thin, a
 * script-appropriate pool fills the ribbon instead of English filler.
 */

import { scriptOf, type Script } from './languages';
import type { AnalysisDraft } from './schema';

/** Words too common to earn a place on the ribbon (Latin scripts only). */
const functionWords = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'and', 'or', 'with', 'is', 'it', 'as', 'from']);

const pools: Record<string, string[]> = {
  latin: ['word', 'root', 'sense', 'voice', 'phrase', 'syntax', 'meaning', 'idiom', 'sound', 'context', 'usage', 'origin', 'tone', 'cognate', 'language'],
  kana: ['語源', '語種', '和語', '漢語', '外来語', '音読み', '訓読み', '語感', '文脈', '助詞', '活用', '敬語', 'アクセント', '表記'],
  han: ['本义', '引申', '形声', '会意', '语体', '搭配', '声调', '量词', '近义', '反义', '文言', '口语'],
  hangul: ['어원', '한자어', '고유어', '외래어', '활용', '조사', '높임말', '어감', '문맥', '발음'],
  cyrillic: ['корень', 'значение', 'смысл', 'форма', 'ударение', 'контекст', 'речь'],
  greek: ['ρίζα', 'σημασία', 'τύπος', 'τόνος', 'χρήση', 'λόγος'],
  arabic: ['جذر', 'وزن', 'معنى', 'سياق', 'لفظ', 'صرف', 'نبر'],
  hebrew: ['שורש', 'בניין', 'משמעות', 'הקשר', 'הגייה'],
  devanagari: ['मूल', 'अर्थ', 'प्रत्यय', 'संधि', 'उच्चारण', 'प्रसंग'],
  thai: ['รากศัพท์', 'ความหมาย', 'เสียง', 'บริบท', 'ไวยากรณ์'],
  bengali: ['মূল', 'অর্থ', 'ধ্বনি', 'প্রসঙ্গ'],
  tamil: ['வேர்', 'பொருள்', 'ஒலி', 'சூழல்'],
  telugu: ['మూలం', 'అర్థం', 'ధ్వని', 'సందర్భం'],
  kannada: ['ಮೂಲ', 'ಅರ್ಥ', 'ಧ್ವನಿ', 'ಸಂದರ್ಭ'],
  malayalam: ['മൂലം', 'അർത്ഥം', 'ശബ്ദം', 'സന്ദർഭം'],
};

/** Split a phrase into ribbon-sized pieces for the script it is written in. */
export function splitTerms(phrase: string, script: Script): string[] {
  const latin = script === 'latin' || script === 'cyrillic' || script === 'greek';
  return phrase
    .split(latin ? /[\s,;:.!?()[\]"'—–-]+/ : /[\s、。，．；：！？「」『』（）・—–]+/)
    .map(part => part.trim())
    .filter(part => part && part.length <= (latin ? 24 : 8) && !(latin && functionWords.has(part.toLowerCase())));
}

/** Every term worth weaving for this analysis, longest-lived first. */
export function collectHelixTerms(doc: AnalysisDraft): string[] {
  const script = scriptOf(doc.language);
  const one = doc.dimensions.one;
  const terms: string[] = [doc.target];

  if (one) {
    // Kanji or word-formation units, when the analysis names them.
    for (const pair of one.overview.ruby ?? []) terms.push(pair.base);
    terms.push(one.bloodline.root);
    terms.push(...one.bloodline.route);
    terms.push(...one.bloodline.cognates.map(item => item.word));
  }
  terms.push(...(doc.dimensions.two?.nuance.words.map(item => item.word) ?? []));
  for (const chunk of doc.dimensions.three?.chunks.items ?? []) terms.push(chunk.phrase);
  for (const culture of doc.dimensions.three?.chunks.culture ?? []) terms.push(culture.expression);

  const collected = [...new Set(terms.flatMap(term => splitTerms(term, script)).filter(Boolean))];
  const pool = pools[script] ?? pools.latin;
  // A thin analysis still deserves a ribbon in its own script.
  for (let index = 0; collected.length < 10 && index < pool.length; index += 1) {
    if (!collected.includes(pool[index])) collected.push(pool[index]);
  }
  return collected;
}
