'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowRight, BookMarked, CheckCircle2, ChevronDown, Loader2, Search } from 'lucide-react';
import { t } from '@/lib/i18n';
import { usePrefs } from '@/lib/prefs';
import { findLanguage } from '@/lib/languages';
import {
  emptyFilter, goalProgress, goalsByLanguage, languageGroups, loadIndex, loadWords,
  type WordEntry, type WordFilter, type WordGoal, type WordList, type WordListIndex, matchesFilter,
} from '@/lib/wordlists';

const PAGE = 120;
const bandNames = ['少见', '较难', '罕见'];

/**
 * The word desk: pick a language, pick a list, see what is left, open a word in
 * the study sheet. Progress counts analyses that already exist locally, so the
 * same archive drives both halves of the app.
 */
export function WordDesk({ analyzed, onPick }: { analyzed: (word: string) => boolean; onPick: (word: string) => void }) {
  const { prefs } = usePrefs();
  const studied = findLanguage(prefs.language)?.id ?? 'en';
  const [index, setIndex] = useState<WordListIndex | null>(null);
  const [group, setGroup] = useState(studied);
  const [goal, setGoal] = useState('');
  const [list, setList] = useState<WordList | null>(null);
  const [filter, setFilter] = useState<WordFilter>(emptyFilter);
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    loadIndex()
      .then(data => { if (live) setIndex(data); })
      .catch(() => { if (live) setError(t('词单索引读取失败，请重新构建前端后再试。')); });
    return () => { live = false; };
  }, []);

  const groups = useMemo(() => (index ? goalsByLanguage(index.goals) : []), [index]);
  // A studied language without a list falls back to the first group available.
  const activeGroup = groups.find(item => item.id === group) ?? groups[0];
  const activeGoal = activeGroup?.goals.find(item => item.slug === goal) ?? activeGroup?.goals[0];

  useEffect(() => {
    if (!activeGoal) return;
    let live = true;
    setList(null);
    setError('');
    loadWords(activeGoal.slug)
      .then(data => { if (live) { setList(data); setLimit(PAGE); } })
      .catch(() => { if (live) setError(t('这个词单没能读取。换一个目标，或重新构建前端。')); });
    return () => { live = false; };
  }, [activeGoal]);

  const bands = useMemo(() => {
    const present = new Set(list?.words.map(entry => entry.b) ?? []);
    if (present.size < 2) return [];
    return bandNames.map((name, value) => ({ value, name, present: present.has(value) })).filter(item => item.present);
  }, [list]);

  const filtered = useMemo(
    () => (list?.words ?? []).filter(entry => matchesFilter(entry, filter, analyzed)),
    [list, filter, analyzed],
  );
  const progress = list ? goalProgress(list.words, analyzed) : { done: 0, total: 0, ratio: 0 };
  const nextFresh = (list?.words ?? []).find(entry => !analyzed(entry.w));
  const showsReading = list ? list.lang !== 'en' : false;
  // Hand-written lists carry no source of their own; the index knows it.
  const source = {
    name: list?.source ?? activeGoal?.source ?? '',
    url: list?.sourceUrl ?? '',
    license: list?.license ?? activeGoal?.license ?? '',
  };

  function update(patch: Partial<WordFilter>) {
    setFilter(current => ({ ...current, ...patch }));
    setLimit(PAGE);
  }

  return <div className="word-desk">
    <div className="desk-groups" role="tablist" aria-label={t('学习语言')}>
      {groups.map(item => <button key={item.id} role="tab" aria-selected={item.id === activeGroup?.id}
        className={item.id === activeGroup?.id ? 'desk-goal active' : 'desk-goal'}
        onClick={() => { setGroup(item.id); setGoal(''); update({ band: null, fresh: false, query: '' }); }}>
        <strong>{t(languageGroups.find(entry => entry.id === item.id)?.zh ?? item.zh)}</strong>
        <small>{item.goals.reduce((sum, goalItem) => sum + goalItem.count, 0).toLocaleString('zh-CN')}</small>
      </button>)}
      {!index && !error && <span className="desk-loading"><Loader2 size={14} className="spin" />{t('读取词单…')}</span>}
    </div>

    {activeGroup && activeGroup.goals.length > 1 && <div className="desk-goals" role="tablist" aria-label={t('目标词单')}>
      {activeGroup.goals.map(item => <GoalTab key={item.slug} goal={item} active={item.slug === activeGoal?.slug}
        onSelect={() => { setGoal(item.slug); update({ band: null, fresh: false, query: '' }); }} />)}
    </div>}

    {error ? <p className="desk-error" role="alert">{error}</p> : <>
      <p className="desk-description">{t(list?.description ?? activeGoal?.description ?? '')}</p>

      {list && <>
        <div className="desk-progress">
          <div className="desk-progress-head">
            <span><BookMarked size={14} />{t('已解剖')} <strong>{progress.done}</strong> / {progress.total}</span>
            {nextFresh && <button className="desk-next" onClick={() => onPick(nextFresh.w)}>{t('下一个未解剖')} <ArrowRight size={13} /></button>}
          </div>
          <div className="desk-progress-track" role="img" aria-label={`${t('已解剖')} ${progress.done} / ${progress.total}`}>
            <span style={{ transform: `scaleX(${progress.ratio})` }} />
          </div>
        </div>

        <div className="desk-tools">
          <label className="desk-search"><Search size={16} /><input value={filter.query} onChange={event => update({ query: event.target.value })} placeholder={t('搜索单词或中文释义')} aria-label={t('搜索词单')} autoComplete="off" /></label>
          <div className="desk-filters">
            <button className={filter.band === null ? 'selected' : ''} onClick={() => update({ band: null })}>{t('全部')}</button>
            {bands.map(band => <button key={band.value} className={filter.band === band.value ? 'selected' : ''} onClick={() => update({ band: band.value })}>{t(band.name)}</button>)}
            <button className={filter.fresh ? 'selected' : ''} aria-pressed={filter.fresh} onClick={() => update({ fresh: !filter.fresh })}>{t('只看未解剖')}</button>
          </div>
        </div>

        {filtered.length === 0 ? <div className="desk-empty"><CheckCircle2 size={28} strokeWidth={1} /><p>{filter.fresh && progress.done === progress.total ? t('这一单已经全部解剖完了。') : t('没有符合条件的词。换个关键词，或去掉筛选。')}</p></div> : <>
          <div className="desk-list" aria-label={list.label}>
            {filtered.slice(0, limit).map((entry, i) => <DeskRow key={entry.w} entry={entry} done={analyzed(entry.w)} index={i} lang={list.lang} reading={showsReading} onPick={onPick} />)}
          </div>
          {filtered.length > limit && <button className="desk-more" onClick={() => setLimit(current => current + PAGE)}><ChevronDown size={14} />{t('还有 {count} 个', { count: filtered.length - limit })}</button>}
        </>}
      </>}

      {list && <p className="desk-source">
        {t('词单来自')} {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a> : source.name}
        {source.license ? `（${source.license}）` : ''}
        {index ? `，${t('已去掉')}${index.excluded.label}` : ''}。{t('释义只作挑选参考，正式解析由模型按所选语言变体生成。')}
      </p>}
    </>}
  </div>;
}

function GoalTab({ goal, active, onSelect }: { goal: WordGoal; active: boolean; onSelect: () => void }) {
  return <button role="tab" aria-selected={active} className={active ? 'desk-goal active' : 'desk-goal'} onClick={onSelect} title={goal.description}>
    <strong>{t(goal.label)}</strong><small>{goal.count.toLocaleString('zh-CN')}</small>
  </button>;
}

function DeskRow({ entry, done, index, lang, reading, onPick }: { entry: WordEntry; done: boolean; index: number; lang: string; reading: boolean; onPick: (word: string) => void }) {
  // English lists are sorted by frequency, so a rarity chip would repeat on
  // every row; only bands that actually differ are worth showing.
  const chip = entry.b > 0;
  return <button className={`desk-row${done ? ' done' : ''}`} style={{ '--i': Math.min(index, 12) } as CSSProperties} onClick={() => onPick(entry.w)} lang={lang}>
    <span className="desk-row-word">
      <strong>{entry.w}</strong>
      {reading && entry.p && <small className="desk-reading">{entry.p}</small>}
    </span>
    {entry.z && <span className="desk-row-gloss">{entry.z}</span>}
    <span className="desk-row-meta">
      {done ? <span className="desk-done"><CheckCircle2 size={12} />{t('已解剖')}</span> : chip ? <span className={`desk-band band-${entry.b}`}>{t(entry.bl)}</span> : null}
      <span className="desk-open" aria-hidden="true">{t('解剖')}<ArrowRight size={12} /></span>
    </span>
  </button>;
}
