import { isMyGo, runtime } from 'mygo-runtime';
import { type ApiConfig, apiConfigSchema, type AnalysisEvent } from './schema';

export const defaultConfig = { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4.1-mini' };
export function readConfig(): { config: ApiConfig; remember: boolean } {
  const stored = sessionStorage.getItem('lexigene-api') || localStorage.getItem('lexigene-api');
  if (!stored) return { config: defaultConfig, remember: false };
  try { const parsed = apiConfigSchema.safeParse(JSON.parse(stored)); if (parsed.success) return { config: parsed.data, remember: localStorage.getItem('lexigene-api') !== null }; } catch { /* A malformed setting can be replaced in the form. */ }
  return { config: defaultConfig, remember: false };
}
export function persistConfig(config: ApiConfig, remember: boolean) {
  localStorage.removeItem('lexigene-api'); sessionStorage.removeItem('lexigene-api');
  (remember ? localStorage : sessionStorage).setItem('lexigene-api', JSON.stringify(config));
}
export async function responseError(response: Response): Promise<string> {
  try { const data = await response.json(); return typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : '请求未完成，请重试。'; } catch { return '请求未完成，请重试。'; }
}
export async function readEvents(response: Response, onEvent: (event: AnalysisEvent) => Promise<void> | void) {
  if (!response.ok) throw new Error(await responseError(response));
  const reader = response.body?.getReader();
  if (!reader) throw new Error('未收到生成数据，请重试。');
  const decoder = new TextDecoder();
  let buffer = ''; let terminal = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        let event: AnalysisEvent;
        try { event = JSON.parse(data); } catch { throw new Error('生成数据格式有误，请重试当前维度。'); }
        if (event.type === 'complete' || event.type === 'error') terminal = true;
        await onEvent(event);
      }
      if (done) break;
    }
    if (!terminal) throw new Error('连接已中断，已完成的维度已保留。');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function safeFilename(target: string) { return target.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim().slice(0, 70) || 'lexigene'; }

export function apiFetch(path: string, init?: RequestInit) {
  const origin = isMyGo() ? (runtime().platform === 'win32' ? 'http://api.localhost' : 'api://localhost') : '';
  return fetch(`${origin}${path}`, init);
}
