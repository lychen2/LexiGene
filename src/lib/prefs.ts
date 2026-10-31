/**
 * Interface preferences: what the learner studies, how it is explained, and
 * which language the chrome speaks. Kept apart from the API settings so that
 * credentials, preference and learning records stay independent.
 */

import { useSyncExternalStore } from 'react';
import { defaultExplain, defaultTarget } from './languages';
import { getUiLocale, setUiLocale, storeLocale, type UiLocale } from './i18n';

export interface Prefs {
  /** Target language id from `src/lib/languages.ts`. */
  language: string;
  /** Variety tag, e.g. `en-GB`. */
  variety: string;
  /** Explanation language id, e.g. `zh-CN`. */
  explain: string;
  /** Interface locale. */
  locale: UiLocale;
}

export const storageKey = 'lexigene.prefs';

export const defaultPrefs: Prefs = {
  language: defaultTarget.language,
  variety: defaultTarget.variety,
  explain: defaultExplain,
  locale: 'zh-CN',
};

let prefs: Prefs | null = null;
const listeners = new Set<() => void>();

function sanitise(value: unknown): Prefs {
  if (!value || typeof value !== 'object') return { ...defaultPrefs };
  const record = value as Record<string, unknown>;
  const text = (key: keyof Prefs) => (typeof record[key] === 'string' && record[key] ? String(record[key]) : '');
  const locale = text('locale');
  return {
    language: text('language') || defaultPrefs.language,
    variety: text('variety') || defaultPrefs.variety,
    explain: text('explain') || defaultPrefs.explain,
    locale: locale === 'en' || locale === 'zh-CN' ? locale : defaultPrefs.locale,
  };
}

export function readPrefs(): Prefs {
  if (prefs) return prefs;
  let stored: Prefs = { ...defaultPrefs };
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) stored = sanitise(JSON.parse(raw));
  } catch {
    // A corrupt or blocked store falls back to defaults rather than failing.
  }
  prefs = stored;
  if (getUiLocale() !== stored.locale) setUiLocale(stored.locale);
  return prefs;
}

export function savePrefs(next: Partial<Prefs>): Prefs {
  const merged = sanitise({ ...readPrefs(), ...next });
  prefs = merged;
  try { localStorage.setItem(storageKey, JSON.stringify(merged)); } catch { /* private mode keeps it for this session */ }
  if (getUiLocale() !== merged.locale) {
    setUiLocale(merged.locale);
    storeLocale(merged.locale);
  }
  for (const listener of listeners) listener();
  return merged;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrefs(): { prefs: Prefs; update: (next: Partial<Prefs>) => void } {
  const current = useSyncExternalStore(subscribe, readPrefs, readPrefs);
  return { prefs: current, update: savePrefs };
}
