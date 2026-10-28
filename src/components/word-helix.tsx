import { useId } from 'react';
import type { AnalysisDraft } from '@/lib/schema';
import { buildWordHelix, helixInk, helixOcclusion } from '@/lib/word-helix-layout.mjs';

const functionWords = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'and', 'or', 'with', 'is', 'it', 'as', 'from']);

export function WordHelix({ doc }: { doc: AnalysisDraft }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const one = doc.dimensions.one;
  if (!one) return null;
  const terms = [
    doc.target,
    one.bloodline.root,
    ...one.bloodline.cognates.map(item => item.word),
    ...(doc.dimensions.two?.nuance.words.map(item => item.word) ?? []),
    ...(doc.dimensions.three?.chunks.items.flatMap(item => item.phrase.match(/[a-zA-Z][a-zA-Z'-]*/g) ?? []) ?? []),
  ];
  const words = [...new Set(terms.flatMap(term => term.trim().split(/\s+/)).filter(word => word && word.length <= 24 && !functionWords.has(word.toLowerCase())))];
  const tokens = buildWordHelix(words);
  if (!tokens.length) return null;

  return <figure className="word-helix">
    <svg viewBox="0 0 420 464" role="img" aria-label={
      `由 ${doc.target} 的词根、同源词与已完成分析中的词汇组成的立体双螺旋`
    }>
      <defs>
        {tokens.map((token, index) => <path key={index} id={id + '-word-' + index} d={token.path} />)}
        <mask id={id + '-depth'} maskUnits="userSpaceOnUse" x="0" y="0" width="420" height="464">
          <rect width="420" height="464" fill="white" />
          {helixOcclusion().map((path, index) => <path key={index} d={path} fill="none" stroke="black" strokeWidth="53" strokeLinecap="round" />)}
        </mask>
      </defs>
      {tokens.map((token, index) => <text key={index} fontSize={token.size} fill={helixInk(token.depth, token.strand)} mask={token.depth < 0 ? 'url(#' + id + '-depth)' : undefined}
        stroke={token.depth > 0 ? 'var(--surface)' : 'none'} strokeWidth={token.depth > 0 ? 1.5 : 0}>
        <textPath href={'#' + id + '-word-' + index} textLength={token.width} lengthAdjust="spacingAndGlyphs">{token.word}</textPath>
      </text>)}
    </svg>
    <figcaption><strong>词汇双链</strong><span>词根 · 同源词{doc.dimensions.two ? ' · 近义词' : ''}{doc.dimensions.three ? ' · 搭配' : ''}</span></figcaption>
  </figure>;
}
