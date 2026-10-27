import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as modelsPOST } from '@/app/api/models/route';

const API_KEY = 'sk-models-test-secret';
const CONFIG = { baseUrl: 'https://api.example.com/v1', apiKey: API_KEY };

const listPayload = (...ids: unknown[]): Response =>
  jsonResponse({ data: ids.map(id => ({ id })) });

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: { cancel: async () => undefined },
    json: async () => payload,
  } as unknown as Response;
}

function failure(status: number, raw: string): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn(async () => undefined);
  return {
    cancel,
    response: {
      ok: false,
      status,
      body: { cancel },
      json: async () => JSON.parse(raw),
      text: async () => raw,
    } as unknown as Response,
  };
}

function stubFetch(responses: Response[]) {
  const mock = vi.fn();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

function post(body: unknown, signal?: AbortSignal): Request {
  return new Request('http://localhost/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  });
}

function initOf(mock: ReturnType<typeof stubFetch>, index = 0): RequestInit {
  return mock.mock.calls[index][1] as RequestInit;
}

function urlOf(mock: ReturnType<typeof stubFetch>, index = 0): string {
  return mock.mock.calls[index][0] as string;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('models route', () => {
  it('lists model ids without requiring a model and sanitizes them', async () => {
    const mock = stubFetch([
      jsonResponse({
        data: [
          { id: '  gpt-4o-mini  ' },
          { id: 'gpt-4o' },
          { id: 'gpt-4o' },
          { id: '   ' },
          { id: '' },
          { id: 42 },
          { id: { nested: true } },
          null,
          'plain-string',
          { object: 'without-id' },
        ],
      }),
    ]);

    const response = await modelsPOST(post({ config: CONFIG }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ models: ['gpt-4o', 'gpt-4o-mini'] });

    expect(mock).toHaveBeenCalledTimes(1);
    expect(urlOf(mock)).toBe('https://api.example.com/v1/models');
    const init = initOf(mock);
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect(init.body).toBeUndefined();
  });

  it('ignores an extra model key in the request config', async () => {
    const mock = stubFetch([listPayload('claude-3')]);

    const response = await modelsPOST(
      post({ config: { ...CONFIG, model: 'some-model', extra: 'ignored' } }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ['claude-3'] });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(initOf(mock))).not.toContain('some-model');
  });

  it('derives the models endpoint from every supported base url shape', async () => {
    const cases: Array<[string, string]> = [
      ['https://api.example.com/v1', 'https://api.example.com/v1/models'],
      ['https://api.example.com/v1/', 'https://api.example.com/v1/models'],
      ['https://api.example.com/v1///', 'https://api.example.com/v1/models'],
      ['http://127.0.0.1:11434/v1/', 'http://127.0.0.1:11434/v1/models'],
      ['https://api.deepseek.com/v1/chat/completions', 'https://api.deepseek.com/v1/models'],
      ['https://api.deepseek.com/v1/chat/completions/', 'https://api.deepseek.com/v1/models'],
      ['https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/models'],
      ['https://api.example.com', 'https://api.example.com/models'],
      ['https://api.example.com/v1/models', 'https://api.example.com/v1/models'],
    ];

    for (const [baseUrl, expected] of cases) {
      const mock = stubFetch([listPayload('m1')]);
      const response = await modelsPOST(post({ config: { ...CONFIG, baseUrl } }));
      expect(response.status).toBe(200);
      expect(urlOf(mock)).toBe(expected);
      vi.unstubAllGlobals();
    }
  });

  it('treats an empty valid data array as success', async () => {
    const mock = stubFetch([listPayload()]);

    const response = await modelsPOST(post({ config: CONFIG }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [] });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('returns a fixed sanitized error for malformed or error payloads', async () => {
    const payloads: Response[] = [
      jsonResponse({ data: 'not-an-array' }),
      jsonResponse({ data: null }),
      jsonResponse([{ id: 'nested-array' }]),
      jsonResponse({ object: 'no-data' }),
      jsonResponse({ error: { message: `invalid key ${API_KEY}` } }),
      {
        ok: true,
        status: 200,
        body: { cancel: async () => undefined },
        json: async () => {
          throw new SyntaxError(`Unexpected token < in body for ${API_KEY}`);
        },
      } as unknown as Response,
    ];

    for (const payload of payloads) {
      stubFetch([payload]);
      const response = await modelsPOST(post({ config: CONFIG }));
      const text = await response.text();

      expect(response.status).toBe(502);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain('not-an-array');
      expect(text).not.toContain('Unexpected token');
      expect(JSON.parse(text).error).toMatch(/[\u4e00-\u9fa5]/);
      vi.unstubAllGlobals();
    }
  });

  it('maps upstream HTTP failures to sanitized statuses and messages', async () => {
    const cases: Array<[number, number, RegExp]> = [
      [401, 502, /API Key 无效或没有访问权限/],
      [403, 502, /API Key 无效或没有访问权限/],
      [404, 502, /模型列表接口不可用/],
      [429, 429, /请求过于频繁/],
      [500, 502, /模型服务暂时不可用/],
      [400, 502, /拒绝了模型列表请求/],
    ];

    for (const [upstreamStatus, expectedStatus, expectedMessage] of cases) {
      const { response: upstream, cancel } = failure(
        upstreamStatus,
        JSON.stringify({ error: `upstream said ${API_KEY}` }),
      );
      stubFetch([upstream]);

      const response = await modelsPOST(post({ config: CONFIG }));
      const text = await response.text();

      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(text).toMatch(expectedMessage);
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain('upstream said');
      expect(cancel).toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it('maps network failures to a sanitized message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(`fetch failed ${API_KEY}`)));

    const response = await modelsPOST(post({ config: CONFIG }));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).toContain('无法连接模型服务');
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain('fetch failed');
  });

  it('gives up after 15 seconds and aborts the upstream request', async () => {
    vi.useFakeTimers();
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        fetchSignal = init.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      }),
    );

    const pending = modelsPOST(post({ config: CONFIG }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSignal).toBeDefined();

    await vi.advanceTimersByTimeAsync(14_000);
    expect(fetchSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1_500);
    const response = await pending;
    const text = await response.text();

    expect(fetchSignal?.aborted).toBe(true);
    expect(response.status).toBe(504);
    expect(text).toContain('模型响应超时');
    expect(text).not.toContain(API_KEY);
  });

  it('cancels the upstream request when the client disconnects', async () => {
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        fetchSignal = init.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      }),
    );

    const controller = new AbortController();
    const pending = modelsPOST(post({ config: CONFIG }, controller.signal));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetchSignal?.aborted).toBe(false);

    controller.abort();
    const response = await pending;

    expect(fetchSignal?.aborted).toBe(true);
    expect(response.status).toBe(499);
    expect(await response.text()).toBe('');
  });

  it('rejects malformed request bodies before contacting upstream', async () => {
    const mock = stubFetch([]);

    const invalidJson = await modelsPOST(post('not-json'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.text()).not.toContain(API_KEY);

    const missingConfig = await modelsPOST(post({}));
    expect(missingConfig.status).toBe(400);

    const missingKey = await modelsPOST(post({ config: { ...CONFIG, apiKey: '' } }));
    expect(missingKey.status).toBe(400);

    const badProtocol = await modelsPOST(post({ config: { ...CONFIG, baseUrl: 'ftp://example.com/v1' } }));
    expect(badProtocol.status).toBe(400);

    const badUrl = await modelsPOST(post({ config: { ...CONFIG, baseUrl: 'not-a-url' } }));
    expect(badUrl.status).toBe(400);

    expect(mock).not.toHaveBeenCalled();
  });
});
