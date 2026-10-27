import { z } from 'zod';

/** Minimal shape shared by the connection test, analyze and grade routes. */
export interface ChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type LlmErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'upstream'
  | 'format'
  | 'aborted';

const PUBLIC_MESSAGES: Record<Exclude<LlmErrorKind, 'aborted'>, string> = {
  auth: 'API Key 无效或没有访问权限，请检查接口配置。',
  'rate-limit': '模型服务请求过于频繁，请稍后再试。',
  network: '无法连接模型服务，请检查接口地址与网络。',
  timeout: '模型响应超时，请稍后重试或更换模型。',
  upstream: '模型服务暂时不可用，请稍后重试。',
  format: '模型返回的内容格式不正确，请重试。',
};

/**
 * Error type safe to surface to the browser: messages are fixed, sanitized
 * Chinese strings and never contain the API key, headers or an upstream body.
 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;

  constructor(kind: LlmErrorKind, message?: string, status?: number) {
    super(message ?? (kind === 'aborted' ? '请求已取消。' : PUBLIC_MESSAGES[kind]));
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
  }
}

export function isAbortedError(error: unknown): boolean {
  return error instanceof LlmError && error.kind === 'aborted';
}

/** Turn any thrown value into a message that is safe to show in the UI. */
export function publicMessage(error: unknown): string {
  if (error instanceof LlmError) return error.message;
  return '模型调用失败，请稍后重试。';
}

export function statusForError(error: unknown): number {
  if (!(error instanceof LlmError)) return 502;
  switch (error.kind) {
    case 'aborted':
      return 499;
    case 'rate-limit':
      return 429;
    case 'timeout':
      return 504;
    default:
      return 502;
  }
}

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_TOKENS = 8_000;

interface CompletionOptions {
  config: ChatConfig;
  messages: ChatMessage[];
  signal?: AbortSignal;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
}

interface AbortState {
  signal: AbortSignal;
  clientAborted: boolean;
  timedOut: boolean;
  cleanup: () => void;
}

function createAbortState(external: AbortSignal | undefined, timeoutMs: number): AbortState {
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

  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, duration);

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

function completionUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

// Reasoning models reject sampling parameters and the legacy max_tokens field.
// Configs may prefix the model with a provider path (e.g. "openai/gpt-5.1").
function isReasoningModel(model: string): boolean {
  const name = model.trim().split('/').pop() ?? model.trim();
  return /^(o[1-9](\b|-)|gpt-5|gpt-6)/i.test(name);
}

function statusError(status: number): LlmError {
  if (status === 401 || status === 403) return new LlmError('auth', undefined, status);
  if (status === 429) return new LlmError('rate-limit', undefined, status);
  if (status === 404) {
    return new LlmError('upstream', '模型或接口地址不存在，请检查接口配置。', status);
  }
  if (status >= 500) return new LlmError('upstream', undefined, status);
  return new LlmError('upstream', '模型服务拒绝了请求，请检查模型名称与参数。', status);
}

function isAbortLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

interface CompletionPayload {
  choices?: Array<{
    message?: { content?: unknown; reasoning_content?: unknown };
    text?: unknown;
    finish_reason?: unknown;
  }>;
}

function extractContent(payload: unknown): string {
  const choices = (payload as CompletionPayload | null)?.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  let content = first?.message?.content;

  if (Array.isArray(content)) {
    content = content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }

  if ((typeof content !== 'string' || !content.trim()) && typeof first?.text === 'string') {
    content = first.text;
  }

  if (typeof content !== 'string' || !content.trim()) {
    if (first?.finish_reason === 'length') {
      throw new LlmError('upstream', '模型在返回正文前耗尽了输出额度，请重试或更换模型。');
    }
    if (typeof first?.message?.reasoning_content === 'string' && first.message.reasoning_content.trim()) {
      throw new LlmError('upstream', '模型只返回了推理内容，没有返回答案正文。请检查服务商的模型设置。');
    }
    throw new LlmError('upstream', '模型没有返回有效内容，请重试。');
  }
  return content.trim();
}

/** Perform one OpenAI-compatible chat completion and return the text content. */
export async function callChat(options: CompletionOptions): Promise<string> {
  const { config, messages } = options;
  const abort = createAbortState(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: false,
  };

  if (!isReasoningModel(config.model)) {
    body.temperature = options.temperature ?? 0.4;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  } else if (options.maxTokens !== undefined) {
    body.max_completion_tokens = options.maxTokens;
  }

  try {
    if (abort.clientAborted) throw new LlmError('aborted');

    const response = await fetch(completionUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
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

    return extractContent(payload);
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (abort.clientAborted || options.signal?.aborted) throw new LlmError('aborted');
    if (abort.timedOut || isAbortLike(error)) throw new LlmError('timeout');
    throw new LlmError('network');
  } finally {
    abort.cleanup();
  }
}

/** Schema description sent to the model so JSON prompting matches Zod exactly. */
export function schemaInstruction(schema: z.ZodType): string {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema), null, 2);
  return [
    '输出要求（必须严格遵守）：',
    '只输出一个 JSON 对象，不要输出 Markdown 代码围栏、前后解释、注释或多余文本。',
    '对象必须包含 schema 中所有必填字段；数组长度、数值范围、枚举取值和嵌套结构必须符合 schema。',
    '无法确定的内容不要编造，改用保守、诚实的表述；不要为了凑数捏造事实。',
    'JSON Schema:',
    jsonSchema,
  ].join('\n');
}

/** Strip one outer Markdown fence if (and only if) it wraps the whole output. */
export function stripOuterFence(raw: string): string {
  const trimmed = raw.trim();
  const match = /^```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(stripOuterFence(raw)) };
  } catch {
    return { ok: false };
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export interface JsonCallOptions<TSchema extends z.ZodType> {
  config: ChatConfig;
  messages: ChatMessage[];
  schema: TSchema;
  signal?: AbortSignal;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Ask the model for JSON, validate it with Zod, and allow exactly one repair
 * round-trip for malformed JSON or a schema violation.
 */
export async function callJson<TSchema extends z.ZodType>(
  options: JsonCallOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const schemaText = schemaInstruction(options.schema);
  const systemIndex = options.messages.findIndex(message => message.role === 'system');
  const messages: ChatMessage[] =
    systemIndex === -1
      ? [{ role: 'system', content: schemaText }, ...options.messages]
      : options.messages.map((message, index) =>
          index === systemIndex ? { ...message, content: `${message.content}\n\n${schemaText}` } : message,
        );

  const raw = await callChat({
    config: options.config,
    messages,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    temperature: options.temperature,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  });

  const firstParse = parseJson(raw);

  if (firstParse.ok) {
    const validated = options.schema.safeParse(firstParse.value);
    if (validated.success) return validated.data;

    return repair(options, messages, raw, `结构校验失败：${describeIssues(validated.error)}`);
  }

  return repair(options, messages, raw, '输出不是合法的 JSON 对象');
}

async function repair<TSchema extends z.ZodType>(
  options: JsonCallOptions<TSchema>,
  messages: ChatMessage[],
  raw: string,
  reason: string,
): Promise<z.infer<TSchema>> {
  const repairMessages: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: raw },
    {
      role: 'user',
      content: [
        `你上一次的输出没有通过校验：${reason}。`,
        '请重新生成完整结果，严格只输出一个符合上述 JSON Schema 的 JSON 对象。',
        '不要解释、不要道歉、不要使用 Markdown 代码围栏，也不要省略任何必填字段。',
      ].join('\n'),
    },
  ];

  const repairedRaw = await callChat({
    config: options.config,
    messages: repairMessages,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    temperature: 0,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  });

  const parsed = parseJson(repairedRaw);
  if (!parsed.ok) throw new LlmError('format');

  const validated = options.schema.safeParse(parsed.value);
  if (!validated.success) throw new LlmError('format');

  return validated.data;
}

/**
 * Minimal real request used by /api/connection-test. It deliberately does not
 * request JSON so it works with the widest range of compatible endpoints.
 */
export async function pingModel(
  config: ChatConfig,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  await callChat({
    config,
    messages: [
      { role: 'system', content: 'You are a connectivity probe. Reply with the single word OK.' },
      { role: 'user', content: 'ping' },
    ],
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 30_000,
    temperature: 0,
    // Reasoning tokens share this budget with the visible answer on many APIs.
    maxTokens: 1_024,
  });
}
