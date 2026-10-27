import { z } from 'zod';
import { apiConfigSchema, gradeSchema, quizQuestionSchema } from '@/lib/schema';
import {
  callJson,
  isAbortedError,
  publicMessage,
  statusForError,
} from '@/lib/llm';
import { buildGradeMessages, type GradeContext } from '@/lib/prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GRADE_TIMEOUT_MS = 90_000;
const GRADE_MAX_TOKENS = 4_000;

const contextSchema = z.object({
  core: z.string().max(4_000).default(''),
  register: z.union([z.string().max(200), z.number()]).optional(),
  subtext: z.string().max(2_000).default(''),
  chunks: z.array(z.unknown()).max(20).default([]),
});

const requestSchema = z.object({
  config: apiConfigSchema,
  target: z.string().trim().min(1).max(120),
  language: z.string().trim().min(1).max(60),
  question: quizQuestionSchema,
  answer: z.string().trim().min(1).max(4_000),
  context: contextSchema,
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function chunkLabel(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.phrase === 'string') {
      return typeof record.meaning === 'string'
        ? `${record.phrase}（${record.meaning}）`
        : record.phrase;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
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
    return json({ error: '批改请求不完整或格式不正确。' }, 400);
  }

  const { config, target, language, question, answer, context } = parsed.data;

  const normalizedContext: GradeContext = {
    core: context.core.trim(),
    register: context.register,
    subtext: context.subtext.trim(),
    chunks: context.chunks
      .map(chunkLabel)
      .filter((item): item is string => item.length > 0)
      .slice(0, 8),
  };

  try {
    const grade = await callJson({
      config,
      schema: gradeSchema,
      messages: buildGradeMessages({
        target,
        language,
        question,
        answer,
        context: normalizedContext,
      }),
      signal: request.signal,
      timeoutMs: GRADE_TIMEOUT_MS,
      maxTokens: GRADE_MAX_TOKENS,
    });

    return json(grade);
  } catch (error) {
    if (isAbortedError(error)) return new Response(null, { status: 499 });
    return json({ error: publicMessage(error) }, statusForError(error));
  }
}
