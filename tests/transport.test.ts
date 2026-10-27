import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/client';

afterEach(() => vi.unstubAllGlobals());

describe('Go API transport', () => {
  it('keeps the browser origin and forwards the streaming response unchanged', async () => {
    const response = new Response('data: {"type":"complete"}\n\n');
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);
    const init = { method: 'POST', body: '{}', signal: new AbortController().signal };
    const result = await apiFetch('/api/analyze', init);
    expect(fetch).toHaveBeenCalledWith('/api/analyze', init);
    expect(result).toBe(response);
    expect(await result.text()).toBe('data: {"type":"complete"}\n\n');
  });

  it.each([
    ['linux', 'api://localhost/api/models'],
    ['darwin', 'api://localhost/api/models'],
    ['win32', 'http://api.localhost/api/models'],
  ])('uses the documented custom-scheme origin on %s', async (platform, expected) => {
    vi.stubGlobal('mygo', { platform });
    const response = new Response('{"models":[]}');
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);
    const init = { method: 'POST', body: '{"config":{}}' };
    expect(await apiFetch('/api/models', init)).toBe(response);
    expect(fetch).toHaveBeenCalledWith(expected, init);
  });
});
