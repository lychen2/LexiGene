'use client';

import './quiz-scenario.css';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { z } from 'zod';
import { apiFetch as fetch, responseError } from '@/lib/client';
import {
  apiConfigSchema,
  vocabularyHintSchema,
  type ApiConfig,
  type QuizQuestion,
  type VocabularyHint,
} from '@/lib/schema';

export interface QuizScenarioProps {
  question: QuizQuestion;
  config: ApiConfig;
  target: string;
  language: string;
  explain?: string;
  onHints: (hints: VocabularyHint[]) => void;
}

export interface HintSegment {
  text: string;
  hint?: VocabularyHint;
}

export type HintActivationAction = 'toggle' | 'ignore';

/**
 * Decide whether a click should toggle the gloss. Keyboard and assistive-tech
 * activation report detail 0, touch taps are handled explicitly so repeated
 * taps toggle, and plain mouse clicks are ignored because hover/focus already
 * opened the gloss.
 */
export function hintActivationAction(detail: number, pointerType: string): HintActivationAction {
  if (pointerType === 'touch') return 'toggle';
  if (detail === 0) return 'toggle';
  return 'ignore';
}

/**
 * Split text into plain and annotated segments. Hints are matched literally
 * (no HTML, no regex), repeated occurrences are all highlighted, and when two
 * terms overlap the longer one wins at the same start position.
 */
export function splitHintSegments(text: string, hints: readonly VocabularyHint[]): HintSegment[] {
  if (!text) return [];

  const matches: Array<{ start: number; end: number; hint: VocabularyHint }> = [];
  const seen = new Set<string>();

  for (const hint of hints) {
    const term = hint.term;
    if (!term.trim() || seen.has(term)) continue;
    seen.add(term);
    let from = 0;
    while (from <= text.length - term.length) {
      const index = text.indexOf(term, from);
      if (index === -1) break;
      matches.push({ start: index, end: index + term.length, hint });
      from = index + term.length;
    }
  }

  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const chosen: typeof matches = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    chosen.push(match);
    cursor = match.end;
  }

  const segments: HintSegment[] = [];
  let position = 0;
  for (const match of chosen) {
    if (match.start > position) segments.push({ text: text.slice(position, match.start) });
    segments.push({ text: text.slice(match.start, match.end), hint: match.hint });
    position = match.end;
  }
  if (position < text.length) segments.push({ text: text.slice(position) });

  return segments;
}

const hintsResponseSchema = z.object({ hints: z.array(vocabularyHintSchema) });
const HINTS_TIMEOUT_MS = 60_000;
const NO_HINTS: VocabularyHint[] = [];
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface ActiveHint {
  token: string;
  term: string;
  en: string;
  anchor: HTMLButtonElement;
  rect: { top: number; left: number; right: number; bottom: number; width: number; height: number };
}

type HintsStatus = 'idle' | 'loading' | 'done' | 'error';

export function QuizScenario({ question, config, target, language, explain, onHints }: QuizScenarioProps) {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<HintsStatus>('idle');
  const [fetchedHints, setFetchedHints] = useState<VocabularyHint[] | null>(null);
  const [active, setActive] = useState<ActiveHint | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const onHintsRef = useRef(onHints);
  const cacheRef = useRef(new Map<string, VocabularyHint[]>());
  const keyboardIntent = useRef(false);
  const lastPointerType = useRef('');
  const tooltipId = useId();
  const announcementId = useId();

  useEffect(() => {
    onHintsRef.current = onHints;
  }, [onHints]);

  // Track input modality so a touch tap toggles instead of opening twice, while
  // Tab focus still reveals the English gloss.
  useEffect(() => {
    const onKeyDown = () => {
      keyboardIntent.current = true;
    };
    const onPointerDown = () => {
      keyboardIntent.current = false;
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  // Annotate only after the scenario has actually scrolled into view.
  useEffect(() => {
    if (visible) return;
    const node = rootRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const identityKey = useMemo(
    () =>
      JSON.stringify([
        question.id,
        question.scenario,
        question.challenge,
        target,
        language,
        explain,
        config.baseUrl,
        config.apiKey,
        config.model,
      ]),
    [question.id, question.scenario, question.challenge, target, language, explain, config.baseUrl, config.apiKey, config.model],
  );

  const suppliedHintsKey = useMemo(
    () => (question.hints === undefined ? 'none' : JSON.stringify(question.hints)),
    [question.hints],
  );

  // One request per question/config identity, only once visible, never retried
  // automatically. Stale requests are aborted on change and unmount.
  useEffect(() => {
    if (question.hints !== undefined) {
      setFetchedHints(null);
      setStatus('done');
      return;
    }

    setFetchedHints(null);

    if (!visible || !apiConfigSchema.safeParse(config).success) {
      setStatus('idle');
      return;
    }

    const cached = cacheRef.current.get(identityKey);
    if (cached) {
      setFetchedHints(cached);
      setStatus('done');
      return;
    }

    const abort = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => abort.abort(), HINTS_TIMEOUT_MS);
    setStatus('loading');

    const body = {
      config,
      target,
      language,
      explain,
      question: { id: question.id, scenario: question.scenario, challenge: question.challenge },
    };

    void (async () => {
      try {
        const response = await fetch('/api/quiz-hints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abort.signal,
        });
        if (!response.ok) throw new Error(await responseError(response));
        const payload = hintsResponseSchema.parse(await response.json());
        if (disposed) return;
        cacheRef.current.set(identityKey, payload.hints);
        setFetchedHints(payload.hints);
        setStatus('done');
        onHintsRef.current(payload.hints);
      } catch {
        if (disposed) return;
        setStatus('error');
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(timer);
      abort.abort();
    };
  }, [identityKey, suppliedHintsKey, visible, retryToken]);

  // Hover/focus/outside-click/Escape/scroll dismissal for the active gloss.
  useEffect(() => {
    if (!active) return;
    const close = () => setActive(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const targetNode = event.target as Node | null;
      if (!targetNode) return;
      if (active.anchor.contains(targetNode)) return;
      if (tooltipRef.current?.contains(targetNode)) return;
      close();
    };
    const onScroll = () => close();
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [active]);

  // Keep the portal tooltip inside the viewport, above or below the anchor.
  useIsomorphicLayoutEffect(() => {
    if (!active) return;
    const node = tooltipRef.current;
    if (!node) return;
    const margin = 10;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    let left = active.rect.left + active.rect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

    let top = active.rect.top - height - 8;
    if (top < margin) top = active.rect.bottom + 8;
    if (top + height > viewportHeight - margin) top = Math.max(margin, viewportHeight - height - margin);

    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
    node.style.visibility = 'visible';
  }, [active]);

  // Close the gloss when the question changes underneath it.
  useEffect(() => {
    setActive(null);
  }, [question.id, question.scenario, question.challenge]);

  const hints = question.hints ?? fetchedHints ?? NO_HINTS;
  const scenarioSegments = useMemo(() => splitHintSegments(question.scenario, hints), [question.scenario, hints]);
  const challengeSegments = useMemo(() => splitHintSegments(question.challenge, hints), [question.challenge, hints]);

  function openHint(hint: VocabularyHint, anchor: HTMLButtonElement, token: string) {
    const rect = anchor.getBoundingClientRect();
    const next = {
      token,
      term: hint.term,
      en: hint.en,
      anchor,
      rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
    };
    setActive(current => (current?.token === token ? current : next));
  }

  function toggleHint(hint: VocabularyHint, anchor: HTMLButtonElement, token: string) {
    if (active?.token === token) {
      setActive(null);
      return;
    }
    openHint(hint, anchor, token);
  }

  function renderSegments(segments: HintSegment[], textKey: string): ReactNode[] {
    return segments.map((segment, index) => {
      if (!segment.hint) return segment.text;
      const hint = segment.hint;
      const token = `${textKey}:${index}:${hint.term}`;
      const isActive = active?.token === token;
      return (
        <button
          key={token}
          type="button"
          className={`quiz-hint${isActive ? ' quiz-hint-active' : ''}`}
          aria-describedby={isActive ? announcementId : undefined}
          onPointerEnter={event => {
            lastPointerType.current = event.pointerType;
            if (event.pointerType === 'mouse') openHint(hint, event.currentTarget, token);
          }}
          onPointerLeave={event => {
            if (event.pointerType === 'mouse') setActive(current => (current?.token === token ? null : current));
          }}
          onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
            lastPointerType.current = event.pointerType;
          }}
          onFocus={event => {
            if (keyboardIntent.current && !isActive) openHint(hint, event.currentTarget, token);
          }}
          onBlur={() => setActive(current => (current?.token === token ? null : current))}
          onClick={event => {
            if (hintActivationAction(event.detail, lastPointerType.current) === 'toggle') {
              event.preventDefault();
              toggleHint(hint, event.currentTarget, token);
            }
          }}
        >
          {segment.text}
        </button>
      );
    });
  }

  const showLoading = status === 'loading';
  const showRetry = status === 'error';

  return (
    <div className="quiz-scenario" ref={rootRef}>
      <p>{renderSegments(scenarioSegments, 'scenario')}</p>
      <strong>{renderSegments(challengeSegments, 'challenge')}</strong>
      <span id={announcementId} className="quiz-hint-announcement" role="status" aria-live="polite">
        {active ? active.en : ''}
      </span>
      {showLoading && (
        <span className="quiz-hint-status" role="status">
          <i aria-hidden="true" />
          正在标注重点词…
        </span>
      )}
      {showRetry && (
        <span className="quiz-hint-status quiz-hint-status-error">
          词汇提示暂不可用
          <button type="button" className="quiz-hint-retry" onClick={() => setRetryToken(token => token + 1)}>
            重试
          </button>
        </span>
      )}
      {active &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            key={active.token}
            id={tooltipId}
            ref={tooltipRef}
            role="tooltip"
            className="quiz-hint-tooltip"
            style={{ left: 0, top: 0, visibility: 'hidden' }}
          >
            <span lang="en">{active.en}</span>
          </div>,
          document.body,
        )}
    </div>
  );
}
