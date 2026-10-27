import { z } from 'zod';
import { apiConfigSchema } from '@/lib/schema';
import {
  isAbortedError,
  pingModel,
  publicMessage,
  statusForError,
} from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({ config: apiConfigSchema });

const CONNECTION_TIMEOUT_MS = 30_000;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '请求体必须是 JSON。' }, 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: '接口配置不完整或格式不正确。' }, 400);
  }

  const { config } = parsed.data;
  const startedAt = Date.now();

  try {
    await pingModel(config, { signal: request.signal, timeoutMs: CONNECTION_TIMEOUT_MS });
    return json({ ok: true, model: config.model, latencyMs: Date.now() - startedAt });
  } catch (error) {
    if (isAbortedError(error)) return new Response(null, { status: 499 });
    // The body never contains the API key, request headers or raw upstream text.
    // A non-2xx status lets the settings panel surface the failure instead of
    // treating any HTTP 200 as a successful connection.
    return json({ ok: false, error: publicMessage(error) }, statusForError(error));
  }
}
