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
    expect(new Set(visibleWords)).toEqual(new Set(['stress', 'sense', 'syntax']));
  });

  it('keeps partial analyses renderable without adding invented vocabulary', () => {
    const doc: AnalysisDraft = { ...demo, dimensions: {} };
    expect(renderToStaticMarkup(createElement(WordHelix, { doc }))).toBe('');
  });
});
