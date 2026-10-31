/**
 * Chinese word-boundary detection for headings, using BudouX.
 *
 * The model is vendored from BudouX's Simplified Chinese default model
 * (budoux 0.10.2, Apache-2.0, Google LLC) and the scoring follows its parser
 * exactly. BudouX itself is not imported because its package entry pulls in a
 * DOM implementation we do not need, and vendoring 44 KB of model data keeps
 * the browser bundle free of it.
 *
 * Attribution: https://github.com/google/budoux — Apache License 2.0.
 */

import model from './budoux-zh-hans.json';

type Group = Record<string, number>;
type BoundaryModel = Record<string, Group>;

const groups = model as BoundaryModel;
const tables = new Map(Object.entries(groups).map(([name, group]) => [name, new Map(Object.entries(group))]));

// BudouX's base score: the negative half of the sum of every weight, so an
// unremarkable boundary falls below zero and stays unbroken.
const baseScore = -0.5 * [...tables.values()].flatMap(table => [...table.values()]).reduce((sum, value) => sum + value, 0);

function lookup(name: string, text: string): number {
  if (!text) return 0;
  return tables.get(name)?.get(text) ?? 0;
}

/** Indices where a Chinese line may break, per BudouX's model. */
export function boundaries(sentence: string): number[] {
  const result: number[] = [];
  for (let index = 1; index < sentence.length; index += 1) {
    // Never split the halves of a surrogate pair.
    if ((sentence.codePointAt(index - 1) ?? 0) > 0xffff) continue;
    let score = baseScore
      + lookup('UW1', sentence.substring(index - 3, index - 2))
      + lookup('UW2', sentence.substring(index - 2, index - 1))
      + lookup('UW3', sentence.substring(index - 1, index))
      + lookup('UW4', sentence.substring(index, index + 1))
      + lookup('UW5', sentence.substring(index + 1, index + 2))
      + lookup('UW6', sentence.substring(index + 2, index + 3))
      + lookup('BW1', sentence.substring(index - 2, index))
      + lookup('BW2', sentence.substring(index - 1, index + 1))
      + lookup('BW3', sentence.substring(index, index + 2))
      + lookup('TW1', sentence.substring(index - 3, index))
      + lookup('TW2', sentence.substring(index - 2, index + 1))
      + lookup('TW3', sentence.substring(index - 1, index + 2))
      + lookup('TW4', sentence.substring(index, index + 3));
    if (score > 0) result.push(index);
  }
  return result;
}

/** Split a sentence at its BudouX boundaries. */
export function parse(sentence: string): string[] {
  if (!sentence) return [];
  const cuts = boundaries(sentence);
  const chunks: string[] = [];
  let start = 0;
  for (const cut of cuts) {
    chunks.push(sentence.slice(start, cut));
    start = cut;
  }
  chunks.push(sentence.slice(start));
  return chunks;
}
