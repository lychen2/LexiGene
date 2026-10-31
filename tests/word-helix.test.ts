import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WordHelix } from '../src/components/word-helix';
import type { AnalysisDraft } from '../src/lib/schema';
import { demo } from '../src/lib/demo';

describe('word-built helix', () => {
  it('preserves complete words containing s instead of splitting their letters', () => {
    const doc: AnalysisDraft = {
      ...demo,
      target: 'stress',
      dimensions: { one: { ...demo.dimensions.one, bloodline: {
        ...demo.dimensions.one.bloodline, root: 'sense',
        cognates: [{ word: 'syntax', meaning: '句法', connection: 'Test vocabulary' }],
      } } },
    };
    const html = renderToStaticMarkup(createElement(WordHelix, { doc }));
    const visibleWords = [...html.matchAll(new RegExp('<textPath[^>]*>([^<]+)</textPath>', 'g'))].map(match => match[1]);
    expect(visibleWords.length).toBeGreaterThan(0);
    // The ribbon carries the analysis's own terms; the target, its root and its
    // relatives must all be there, and no single letters leak in from splitting.
    expect(new Set(visibleWords)).toEqual(expect.objectContaining({}));
    for (const expected of ['stress', 'sense', 'syntax']) expect(visibleWords).toContain(expected);
    expect(visibleWords.filter(word => word.length === 1)).toEqual([]);
  });

  it('keeps partial analyses renderable without adding invented vocabulary', () => {
    const doc: AnalysisDraft = { ...demo, dimensions: {} };
    expect(renderToStaticMarkup(createElement(WordHelix, { doc }))).toBe('');
  });
});
