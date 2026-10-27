import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, blobToBase64, saveBlob } from '@/lib/client';

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

describe('Android export bridge', () => {
  it('converts binary exports losslessly for the native saver', async () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => (index * 37) % 256);
    const encoded = await blobToBase64(new Blob([bytes], { type: 'application/octet-stream' }));
    expect(Buffer.from(encoded, 'base64').equals(Buffer.from(bytes))).toBe(true);
  });

  it('routes an export through the bridge when the Android shell provides one', async () => {
    const save = vi.fn();
    await saveBlob(new Blob(['{"id":"demo"}'], { type: 'application/json' }), 'anagnorisis.json', { save });
    expect(save).toHaveBeenCalledWith('anagnorisis.json', 'application/json', expect.any(String));
    expect(Buffer.from(save.mock.calls[0][2], 'base64').toString()).toBe('{"id":"demo"}');
  });
});
