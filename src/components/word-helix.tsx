import { useId } from 'react';
import type { AnalysisDraft } from '@/lib/schema';
import { collectHelixTerms } from '@/lib/helix-terms';
import { t } from '@/lib/i18n';
import { buildWordHelix, helixInk, helixOcclusion } from '@/lib/word-helix-layout.mjs';

export function WordHelix({ doc }: { doc: AnalysisDraft }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!doc.dimensions.one) return null;
  const words = collectHelixTerms(doc);
  const tokens = buildWordHelix(words);
  if (!tokens.length) return null;

  return <figure className="word-helix">
    <svg viewBox="0 0 420 464" role="img" aria-label={t('由 {target} 的构词单位、同源词与已完成分析中的词汇组成的立体双螺旋', { target: doc.target })}>
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
  </figure>;
}
