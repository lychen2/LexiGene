'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowRight, BookMarked, CheckCircle2, ChevronDown, Loader2, Search, Sparkles } from 'lucide-react';
import {
  emptyFilter, goalProgress, loadIndex, loadWords, matchesFilter,
  type WordEntry, type WordFilter, type WordGoal, type WordList, type WordListIndex,
} from '@/lib/wordlists';

const PAGE = 120;
const bandNames = ['少见', '较难', '罕见'];

/**
 * The word desk: pick a goal, see what is left of it, and open one word in the
 * study sheet. Progress counts analyses that already exist locally, so the same
 * archive drives both halves of the app.
 */
export function WordDesk({ analyzed, onPick }: { analyzed: (word: string) => boolean; onPick: (word: string) => void }) {
  const [index, setIndex] = useState<WordListIndex | null>(null);
  const [goal, setGoal] = useState('idioms');
  const [list, setList] = useState<WordList | null>(null);
  const [filter, setFilter] = useState<WordFilter>(emptyFilter);
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    loadIndex()
      .then(data => { if (live) setIndex(data); })
      .catch(() => { if (live) setError('词单索引读取失败，请重新构建前端后再试。'); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setList(null);
    setError('');
    loadWords(goal)
      .then(data => { if (live) { setList(data); setLimit(PAGE); } })
      .catch(() => { if (live) setError('这个词单没能读取。换一个目标，或重新构建前端。'); });
    return () => { live = false; };
  }, [goal]);

  const bands = useMemo(() => {
    const present = new Set(list?.words.map(entry => entry.b) ?? []);
    return bandNames.map((name, value) => ({ value, name, present: present.has(value) })).filter(item => item.present);
  }, [list]);

  const filtered = useMemo(
    () => (list?.words ?? []).filter(entry => matchesFilter(entry, filter, analyzed)),
    [list, filter, analyzed],
  );
  const progress = list ? goalProgress(list.words, analyzed) : { done: 0, total: 0, ratio: 0 };
  const nextFresh = (list?.words ?? []).find(entry => !analyzed(entry.w));

  function update(patch: Partial<WordFilter>) {
    setFilter(current => ({ ...current, ...patch }));
    setLimit(PAGE);
  }

  return <div className="word-desk">
    <div className="desk-goals" role="tablist" aria-label="目标词单">
      {(index?.goals ?? []).map(item => <GoalTab key={item.slug} goal={item} active={item.slug === goal} onSelect={() => { setGoal(item.slug); update({ band: null, fresh: false, query: '' }); }} />)}
      {!index && !error && <span className="desk-loading"><Loader2 size={14} className="spin" />读取词单…</span>}
    </div>

    {error ? <p className="desk-error" role="alert">{error}</p> : <>
      <p className="desk-description">{list?.description ?? index?.goals.find(item => item.slug === goal)?.description}</p>

      {list && <>
        <div className="desk-progress">
          <div className="desk-progress-head">
            <span><BookMarked size={14} />已解剖 <strong>{progress.done}</strong> / {progress.total}</span>
            {nextFresh && <button className="desk-next" onClick={() => onPick(nextFresh.w)}>下一个未解剖 <ArrowRight size={13} /></button>}
          </div>
          <div className="desk-progress-track" role="img" aria-label={`已解剖 ${progress.done} 个，共 ${progress.total} 个`}>
            <span style={{ transform: `scaleX(${progress.ratio})` }} />
          </div>
        </div>

        <div className="desk-tools">
          <label className="desk-search"><Search size={16} /><input value={filter.query} onChange={event => update({ query: event.target.value })} placeholder="搜索单词或中文释义" aria-label="搜索词单" autoComplete="off" /></label>
          <div className="desk-filters">
            <button className={filter.band === null ? 'selected' : ''} onClick={() => update({ band: null })}>全部</button>
            {bands.map(band => <button key={band.value} className={filter.band === band.value ? 'selected' : ''} onClick={() => update({ band: band.value })}>{band.name}</button>)}
            <button className={filter.fresh ? 'selected' : ''} aria-pressed={filter.fresh} onClick={() => update({ fresh: !filter.fresh })}>只看未解剖</button>
          </div>
        </div>

        {filtered.length === 0 ? <div className="desk-empty"><CheckCircle2 size={28} strokeWidth={1} /><p>{filter.fresh && progress.done === progress.total ? '这一单已经全部解剖完了。' : '没有符合条件的词。换个关键词，或去掉筛选。'}</p></div> : <>
          <div className="desk-list" aria-label={`${list.label}词单`}>
            {filtered.slice(0, limit).map((entry, i) => <DeskRow key={entry.w} entry={entry} done={analyzed(entry.w)} index={i} showBand={goal === 'idioms'} onPick={onPick} />)}
          </div>
          {filtered.length > limit && <button className="desk-more" onClick={() => setLimit(current => current + PAGE)}><ChevronDown size={14} />还有 {filtered.length - limit} 个</button>}
        </>}
      </>}

      {index && <p className="desk-source">词单来自 <a href={index.sourceUrl} target="_blank" rel="noreferrer">{index.source}</a>（{index.license}），已去掉{index.excluded.label}。释义只作挑选参考，正式解析由模型按所选英语变体生成。</p>}
    </>}
  </div>;
}

function GoalTab({ goal, active, onSelect }: { goal: WordGoal; active: boolean; onSelect: () => void }) {
  return <button role="tab" aria-selected={active} className={active ? 'desk-goal active' : 'desk-goal'} onClick={onSelect} title={goal.description}>
    <strong>{goal.label}</strong><small>{goal.count.toLocaleString('zh-CN')}</small>
  </button>;
}

function DeskRow({ entry, done, index, showBand, onPick }: { entry: WordEntry; done: boolean; index: number; showBand: boolean; onPick: (word: string) => void }) {
  // Exam lists are sorted by frequency, so the rarity chip would repeat on every
  // row; the expression lists use the same field for the kind of expression.
  const chip = showBand || entry.b > 0;
  return <button className={`desk-row${done ? ' done' : ''}`} style={{ '--i': Math.min(index, 12) } as CSSProperties} onClick={() => onPick(entry.w)}>
    <span className="desk-row-word"><strong lang="en">{entry.w}</strong></span>
    <span className="desk-row-gloss">{entry.z}</span>
    <span className="desk-row-meta">{done ? <span className="desk-done"><CheckCircle2 size={12} />已解剖</span> : chip ? <span className={`desk-band band-${entry.b}`}>{entry.bl}</span> : null}<Sparkles size={13} className="desk-open" /></span>
  </button>;
}
