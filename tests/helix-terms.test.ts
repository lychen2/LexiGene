import { describe, expect, it } from 'vitest';
import { collectHelixTerms, splitTerms } from '../src/lib/helix-terms';
import { japanese } from './fixtures/japanese';
import { demo } from './fixtures/resent';

describe('ribbon terms follow the analysis language', () => {
  it('splits a Latin phrase into words and drops English function words', () => {
    expect(splitTerms('a wave of nostalgia', 'latin')).toEqual(['wave', 'nostalgia']);
  });

  it('keeps Japanese phrases whole instead of splitting on spaces only', () => {
    expect(splitTerms('日本の文化', 'kana')).toEqual(['日本の文化']);
    expect(splitTerms('日本の文化、日本製', 'kana')).toEqual(['日本の文化', '日本製']);
  });

  it('weaves Japanese terms for a Japanese analysis', () => {
    const terms = collectHelixTerms(japanese);
    expect(terms[0]).toBe('日本');
    expect(terms).toContain('太陽');
    expect(terms).toContain('日輪');
    expect(terms.some(term => /^[a-z]+$/.test(term))).toBe(false);
  });

  it('weaves the analysis terms for an English record', () => {
    const terms = collectHelixTerms(demo);
    expect(terms[0]).toBe('resent');
    expect(terms.length).toBeGreaterThan(8);
  });

  it('fills a thin analysis with a pool in its own script', () => {
    const thin = {
      ...japanese,
      dimensions: { one: { ...japanese.dimensions.one!, bloodline: { ...japanese.dimensions.one!.bloodline, root: '', route: ['日本'], cognates: [] } } },
    };
    const terms = collectHelixTerms(thin);
    expect(terms).toContain('日本');
    expect(terms.length).toBeGreaterThanOrEqual(10);
    expect(terms.some(term => /[ぁ-んァ-ヶ一-龥]/.test(term))).toBe(true);
    expect(terms).not.toContain('word');
  });
});
