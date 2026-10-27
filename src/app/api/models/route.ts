import { z } from 'zod';
import { apiConfigSchema } from '@/lib/schema';
import { isAbortedError, LlmError, publicMessage, statusForError } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Discovery is bounded so the settings panel never waits on a hung endpoint. */
const MODELS_TIMEOUT_MS = 15_000;

const requestSchema = z.object({
  config: apiConfigSchema.pick({ baseUrl: true, apiKey: true }),
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

interface AbortBudget {
  signal: AbortSignal;
  readonly clientAborted: boolean;
  readonly timedOut: boolean;
  cleanup: () => void;
}

/** Link the inbound request signal to a bounded timer, mirroring src/lib/llm.ts. */
function createBudget(external: AbortSignal | undefined, timeoutMs: number): AbortBudget {
  const controller = new AbortController();
  let clientAborted = false;
  let timedOut = false;

  const onAbort = () => {
    clientAborted = true;
    controller.abort();
  };

  if (external) {
    if (external.aborted) onAbort();
    else external.addEventListener('abort', onAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    get clientAborted() {
      return clientAborted;
    },
    get timedOut() {
      return timedOut;
    },
    cleanup() {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Keep the configured base path and append /models. Configs that already store
 * the chat completion endpoint (supported by src/lib/llm.ts) are unwrapped first.
 */
function modelsUrl(baseUrl: string): string {
  const base = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/+$/, '');
  return /\/models$/i.test(base) ? base : `${base}/models`;
}

function statusError(status: number): LlmError {
  if (status === 401 || status === 403) return new LlmError('auth', undefined, status);
  if (status === 429) return new LlmError('rate-limit', undefined, status);
  if (status === 404) {
    return new LlmError(
      'upstream',
      '模型列表接口不可用，请检查接口地址是否支持 /v1/models。',
      status,
    );
  }
  if (status >= 500) return new LlmError('upstream', undefined, status);
  return new LlmError('upstream', '模型服务拒绝了模型列表请求，请检查接口配置。', status);
}

function isAbortLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Accept only the documented OpenAI list shape: `{ data: [{ id }] }`.
 * Entries without a usable string id are skipped; a non-array payload is an error.
 */
function readModelIds(payload: unknown): string[] {
  const data =
    typeof payload === 'object' && payload !== null
      ? (payload as { data?: unknown }).data
      : undefined;
  if (!Array.isArray(data)) {
    throw new LlmError('upstream', '模型列表格式不正确，请检查接口地址。');
  }

  const ids = new Set<string>();
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (trimmed) ids.add(trimmed);
  }
  return [...ids].sort();
}

async function listModels(
  config: { baseUrl: string; apiKey: string },
  budget: AbortBudget,
): Promise<string[]> {
  if (budget.clientAborted) throw new LlmError('aborted');

  try {
    const response = await fetch(modelsUrl(config.baseUrl), {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: budget.signal,
    });

    if (!response.ok) {
      // Never read or forward the upstream body: it may echo credentials.
      await response.body?.cancel().catch(() => undefined);
      throw statusError(response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (isAbortLike(error)) throw error;
      throw new LlmError('upstream', '模型服务返回了无法解析的响应，请稍后重试。');
    }

    return readModelIds(payload);
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (budget.clientAborted) throw new LlmError('aborted');
    if (budget.timedOut || isAbortLike(error)) throw new LlmError('timeout');
    throw new LlmError('network');
  }
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
    return json({ error: '接口配置不完整或格式不正确。' }, 400);
  }

  const budget = createBudget(request.signal, MODELS_TIMEOUT_MS);
  try {
    const models = await listModels(parsed.data.config, budget);
    return json({ models });
  } catch (error) {
    if (isAbortedError(error)) {
      return new Response(null, { status: 499, headers: { 'Cache-Control': 'no-store' } });
    }
    return json({ error: publicMessage(error) }, statusForError(error));
  } finally {
    budget.cleanup();
  }
}
