import { describe, expect, it } from 'vitest';
import { emptyFilter, goalProgress, goalsByLanguage, matchesFilter, wordKey, type WordEntry } from '../src/lib/wordlists';

const words: WordEntry[] = [
  { w: 'abstruse', p: 'æbˈstruːs', z: '难懂的', b: 2, bl: '罕见' },
  { w: 'ardent', p: 'ˈɑːdənt', z: '热心的', b: 0, bl: '少见' },
  { w: 'assiduous', p: 'əˈsɪdjuəs', z: '勤勉的', b: 1, bl: '较难' },
];
const analyzed = (word: string) => wordKey(word) === 'ardent';

describe('word desk filtering', () => {
  it('keeps every word when the filter is empty', () => {
    expect(words.filter(entry => matchesFilter(entry, emptyFilter, analyzed))).toHaveLength(3);
  });

  it('matches an English query against the spelling, ignoring case and padding', () => {
    const filter = { ...emptyFilter, query: '  ABSTR ' };
    expect(words.filter(entry => matchesFilter(entry, filter, analyzed)).map(entry => entry.w)).toEqual(['abstruse']);
  });

  it('matches a Chinese query against the gloss', () => {
    const filter = { ...emptyFilter, query: '勤勉' };
    expect(words.filter(entry => matchesFilter(entry, filter, analyzed)).map(entry => entry.w)).toEqual(['assiduous']);
  });

  it('filters by rarity band', () => {
    const filter = { ...emptyFilter, band: 1 };
    expect(words.filter(entry => matchesFilter(entry, filter, analyzed)).map(entry => entry.w)).toEqual(['assiduous']);
  });

  it('hides analysed words when only untouched ones are wanted', () => {
    const filter = { ...emptyFilter, fresh: true };
    expect(words.filter(entry => matchesFilter(entry, filter, analyzed)).map(entry => entry.w)).toEqual(['abstruse', 'assiduous']);
  });

  it('combines the band and the untouched filter', () => {
    const filter = { ...emptyFilter, band: 2, fresh: true };
    expect(words.filter(entry => matchesFilter(entry, filter, analyzed)).map(entry => entry.w)).toEqual(['abstruse']);
  });
});

describe('goal progress', () => {
  it('counts analysed words out of the whole list', () => {
    expect(goalProgress(words, analyzed)).toEqual({ done: 1, total: 3, ratio: 1 / 3 });
  });

  it('reports an empty list without dividing by zero', () => {
    expect(goalProgress([], analyzed)).toEqual({ done: 0, total: 0, ratio: 0 });
  });
});

describe('lists in other languages', () => {
  const japanese: WordEntry[] = [
    { w: '相変わらず', p: 'あいかわらず', b: 0, bl: 'JLPT N2' },
    { w: '愛想', p: 'あいそ', b: 0, bl: 'JLPT N1' },
  ];

  it('matches a reading, so a learner can search by kana', () => {
    const filter = { ...emptyFilter, query: 'あいそ' };
    expect(japanese.filter(entry => matchesFilter(entry, filter, () => false)).map(entry => entry.w)).toEqual(['愛想']);
  });

  it('survives a missing gloss', () => {
    const filter = { ...emptyFilter, query: 'aspiration' };
    expect(japanese.filter(entry => matchesFilter(entry, filter, () => false))).toEqual([]);
  });

  it('groups goals by the language they belong to, in a fixed order', () => {
    const goals = [
      { slug: 'ja-n1', label: 'JLPT N1', lang: 'ja', description: '', count: 1, bytes: 1 },
      { slug: 'gre', label: 'GRE', lang: 'en', description: '', count: 1, bytes: 1 },
      { slug: 'zh-hsk6', label: 'HSK 6', lang: 'zh', description: '', count: 1, bytes: 1 },
    ];
    expect(goalsByLanguage(goals).map(group => group.id)).toEqual(['en', 'ja', 'zh']);
    expect(goalsByLanguage(goals)[1].goals[0].slug).toBe('ja-n1');
  });

  it('hides a language group with no lists', () => {
    const goals = [{ slug: 'gre', label: 'GRE', lang: 'en', description: '', count: 1, bytes: 1 }];
    expect(goalsByLanguage(goals).map(group => group.id)).toEqual(['en']);
  });
});
