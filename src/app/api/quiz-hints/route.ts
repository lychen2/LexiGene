import { z } from 'zod';
import { apiConfigSchema, vocabularyHintSchema, type VocabularyHint } from '@/lib/schema';
import { callJson, isAbortedError, publicMessage, statusForError } from '@/lib/llm';
import { buildHintMessages } from '@/lib/prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HINTS_TIMEOUT_MS = 45_000;
const HINTS_MAX_TOKENS = 1_600;
const MAX_HINTS = 8;

/**
 * Only the scenario/challenge text is accepted. The reference answer never
 * enters this route, so it cannot leak back to the browser.
 */
const requestSchema = z.object({
  config: apiConfigSchema,
  target: z.string().trim().min(1).max(120),
  language: z.string().trim().min(1).max(60),
  question: z.object({
    id: z.string().trim().min(1).max(200),
    scenario: z.string().trim().min(1).max(2_000),
    challenge: z.string().trim().min(1).max(2_000),
  }),
});

const outputSchema = z.object({ hints: z.array(vocabularyHintSchema).max(MAX_HINTS * 2) });

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Keep only hints whose term is a literal substring of the scenario/challenge,
 * drop duplicates (case-insensitive) and the target word itself, then cap the
 * list.
 */
function selectHints(
  hints: readonly VocabularyHint[],
  target: string,
  scenario: string,
  challenge: string,
): VocabularyHint[] {
  const corpus = `${scenario}\n${challenge}`;
  const normalizedTarget = target.trim().toLowerCase();
  const seen = new Set<string>();
  const selected: VocabularyHint[] = [];

  for (const hint of hints) {
    const term = hint.term.trim();
    const en = hint.en.trim();
    if (!term || !en) continue;
    if (!corpus.includes(term)) continue;
    if (normalizedTarget && term.toLowerCase() === normalizedTarget) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({ term, en });
    if (selected.length >= MAX_HINTS) break;
  }

  return selected;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求体必须是 JSON。' }, 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: '词汇提示请求不完整或格式不正确。' }, 400);
  }

  const { config, target, language, question } = parsed.data;

  try {
    const output = await callJson({
      config,
      schema: outputSchema,
      messages: buildHintMessages({ target, language, question }),
      signal: request.signal,
      timeoutMs: HINTS_TIMEOUT_MS,
      maxTokens: HINTS_MAX_TOKENS,
    });

    const hints = selectHints(output.hints, target, question.scenario, question.challenge);
    return json({ hints });
  } catch (error) {
    if (isAbortedError(error)) return new Response(null, { status: 499 });
    return json({ error: publicMessage(error) }, statusForError(error));
  }
}
