import { Fragment, type ReactNode } from 'react';
import { parse } from '@/lib/budoux';

/**
 * Break points inside Chinese headings.
 *
 * Chinese has no spaces, so a heading can break in the middle of a word. BudouX
 * proposes phrase boundaries; each becomes a <wbr>, which the browser may break
 * at but never renders as a space. Pairs with `word-break: keep-all` in CSS —
 * keep-all alone would make the whole heading one unbreakable word.
 *
 * Not used for body text: prose wraps at every character by design.
 */

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** Split a Chinese phrase at BudouX boundaries; other text is returned whole. */
export function breakCjk(text: string): string[] {
  // Latin, kana-only or already spaced text keeps its own wrapping rules.
  if (!HAN.test(text) || /\s/.test(text.trim())) return [text];
  const phrases = parse(text);
  return phrases.length > 1 ? phrases : [text];
}

/** A heading whose Chinese phrases may break between words but never inside one. */
export function CjkText({ children }: { children: string }): ReactNode {
  const parts = breakCjk(children);
  if (parts.length === 1) return children;
  return <>{parts.map((part, index) => <Fragment key={index}>{index > 0 && <wbr />}{part}</Fragment>)}</>;
}
