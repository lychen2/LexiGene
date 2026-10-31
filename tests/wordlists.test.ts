import { describe, expect, it } from 'vitest';
import { emptyFilter, goalProgress, matchesFilter, wordKey, type WordEntry } from '../src/lib/wordlists';

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
