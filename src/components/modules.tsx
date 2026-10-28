'use client';

import './register-meter.css';
import { WordHelix } from './word-helix';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, Check, ChevronDown, Copy, CornerDownRight, Feather, Flame, GitBranch, Layers3, MessageCircle, Microscope, MoveUpRight, Sparkles, Thermometer, Users, X } from 'lucide-react';
import type { AnalysisDocument, AnalysisDraft, Example, GenerationProgress } from '@/lib/schema';

export const moduleNames = ['词源与演化', '同源星系', '概念坐标', '近义词手术刀', '语域温度计', '黄金语块', '翻车最小对比', '语境与实战'];
export const dimensionNames = ['纵向基因考古', '核心概念建模', '横向全息语用'];
export const moduleIcons = [GitBranch, Sparkles, Microscope, Layers3, Thermometer, Feather, CornerDownRight, MessageCircle];

export function Section({ number, title, children, className = '', action }: { number: number; title: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return <section id={`module-${number}`} className={`module ${className}`}>
    <header className="module-heading"><div className="module-number">{String(number).padStart(2, '0')}</div><div><h3>{title}</h3></div>{action && <div className="module-action">{action}</div>}</header>
    {children}
  </section>;
}

function navigateTabs(event: KeyboardEvent<HTMLDivElement>, select: (index: number) => void) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0) return;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); select(next); tabs[next].focus();
}

export function ExampleLine({ value }: { value: Example }) { return <div className="example"><p lang="en">{value.en}</p><span>{value.zh}</span></div>; }
export function DimensionHeading({ index }: { index: number }) {
  return <div className={`dimension-heading dimension-${index}`}><h2>{dimensionNames[index]}</h2><span className="dimension-rule" /></div>;
}
export function Origin({ data }: { data: AnalysisDocument['dimensions']['one']['origin'] }) {
  const [selected, setSelected] = useState(0);
  const active = data.evolution[selected] || data.evolution[0];
  return <Section number={1} title="词源与多义演化">
    <p className="body-copy">{data.story}</p>
    <div className="physical-image"><span className="eyebrow"><Flame size={13} /> 记忆画面</span><p>{data.physicalImage}</p><div className="physical-rings" aria-hidden="true"><span /><span /><span /><i /></div></div>
    <div className="evolution-track" role="tablist" aria-label="义项演化" onKeyDown={event => navigateTabs(event, setSelected)}>{data.evolution.map((node, index) => <button key={node.id} id={`origin-tab-${index}`} role="tab" aria-controls="origin-panel" tabIndex={selected === index ? 0 : -1} aria-selected={selected === index} onClick={() => setSelected(index)} className={index === selected ? 'active' : ''}><span className="evolution-dot" /><small>{node.period}</small><strong>{node.label}</strong>{index < data.evolution.length - 1 && <ArrowRight size={13} className="evolution-arrow" />}</button>)}</div>
    <div id="origin-panel" role="tabpanel" aria-labelledby={`origin-tab-${selected}`} className="node-detail"><p>{active.meaning}</p><span>{active.connection}</span><ExampleLine value={active.example} /></div>
  </Section>;
}
export function Bloodline({ target, data }: { target: string; data: AnalysisDocument['dimensions']['one']['bloodline'] }) {
  const [selected, setSelected] = useState(0);
  const points = [{ x: 26, y: 24 }, { x: 76, y: 26 }, { x: 23, y: 77 }, { x: 77, y: 76 }];
  return <Section number={2} title="血统与同源星系" className="bloodline-module">
    <div className="lineage-route">{data.route.map((step, i) => <span key={i}>{i > 0 && <ArrowRight size={12} />}{step}</span>)}</div>
    <div className="constellation"><div className="star-orbit orbit-one" /><div className="star-orbit orbit-two" /><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{data.cognates.map((_, i) => <path key={i} className={selected === i ? 'lit' : ''} d={`M50 50 Q${points[i].x} 50 ${points[i].x} ${points[i].y}`} />)}</svg><div className="root-star"><small>共同词根</small><strong>{data.root}</strong></div>{data.cognates.map((c, i) => <button key={c.word} className={`cognate-star ${selected === i ? 'selected' : ''}`} style={{ left: `${points[i].x}%`, top: `${points[i].y}%` }} onClick={() => setSelected(i)}><span className="star-point" /><strong>{c.word}</strong><small>{c.meaning}</small></button>)}</div>
    {data.cognates[selected] && <div className="cognate-detail"><Sparkles size={15} /><p><strong>{data.cognates[selected].word}</strong> · {data.cognates[selected].connection}</p></div>}
    <div className="lineage-note"><span className="pill">{data.family}</span><p>{data.socialFeel}</p></div>
  </Section>;
}
export function Concept({ data }: { data: AnalysisDocument['dimensions']['two']['concept'] }) {
  return <Section number={3} title="去中文化的概念坐标" className="concept-module">
    <div className="cinematic-scene"><span className="large-quote" aria-hidden="true">“</span><p>{data.scene}</p></div>
    <div className="concept-coordinates">{[['触发前提', data.trigger], ['内心状态', data.psychology], ['动作力度', data.intensity], ['适用情境', data.boundary]].map(([label, value], i) => <div key={label}><span className="coordinate-index">0{i + 1}</span><h4>{label}</h4><p>{value}</p></div>)}</div>
    <div className="translation-loss"><div className="translation-word"><small>常见中文译法</small><strong>{data.translation.common}</strong></div><div><span className="translation-label">中文多带了什么</span><p>{data.translation.adds}</p></div><div><span className="translation-label">中文漏掉了什么</span><p>{data.translation.misses}</p></div></div>
  </Section>;
}
export function Nuance({ data }: { data: AnalysisDocument['dimensions']['two']['nuance'] }) {
  const [selected, setSelected] = useState(0);
  const word = data.words[selected] || data.words[0];
  return <Section number={4} title="近义词手术刀">
    <p className="scene-label"><span>同一现场</span>{data.sharedScene}</p>
    <div className="synonym-register-legend" aria-hidden="true"><span>正式度</span><span>1</span><i className="synonym-register-legend-bar" /><span>10</span></div>
    <div className="word-tabs synonym-tabs" role="tablist" aria-label="近义词对比" onKeyDown={event => navigateTabs(event, setSelected)}>{data.words.map((w, i) => { const register = Math.min(10, Math.max(1, w.register)); return <button id={`nuance-tab-${i}`} role="tab" aria-controls="nuance-panel" tabIndex={i === selected ? 0 : -1} aria-selected={i === selected} className={`synonym-tab${i === selected ? ' active' : ''}`} onClick={() => setSelected(i)} key={w.word}>
      <span className="synonym-word">{w.word}</span>
      <span className="synonym-register">
        <span className="synonym-register-track" aria-hidden="true" style={{ '--synonym-register-position': `${(register - 1) / 9 * 100}%` } as React.CSSProperties}><span className="synonym-register-rest" /><span className="synonym-register-marker" /></span>
        <span className="synonym-register-readout"><span className="synonym-register-label">正式度</span><strong>{register}<span>/10</span></strong></span>
      </span>
    </button>; })}</div>
    <div id="nuance-panel" role="tabpanel" aria-labelledby={`nuance-tab-${selected}`} className="nuance-result" key={word.word}><div className="nuance-image"><span className="eyebrow">底层画面</span><p>{word.image}</p></div><p className="body-copy">{word.distinction}</p><ExampleLine value={word.example} /></div>
  </Section>;
}
const prosodyLabels = { positive: '积极', neutral: '中立', negative: '消极', mixed: '随语境变化' };
export function Register({ target, data }: { target: string; data: AnalysisDocument['dimensions']['three']['register'] }) {
  const [level, setLevel] = useState(data.score);
  const [index, setIndex] = useState(0);
  const current = data.levels.find(item => item.level === level)!;
  const candidate = current.candidates[index] || current.candidates[0];
  const nearest = [...data.levels].filter(item => item.candidates.length).sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level))[0];
  return <Section number={5} title="语域温度计" className="register-module" action={<span className="interactive-badge"><span /> 可拖动探索</span>}>
    <div className="register-intro"><div><span className="register-current"><strong>{data.score}</strong><span>/ 10</span><small>{target} 的正式度</small></span></div><div className="register-persona"><Users size={17} /><p>{data.persona}</p></div><div className={`prosody prosody-${data.prosody}`}><span className="tiny-label">语义韵</span><strong>{prosodyLabels[data.prosody]}</strong><p>{data.prosodyExplanation}</p></div></div>
    <div className="thermometer-panel"><div className="temperature-title"><span>正式度</span><strong>{String(level).padStart(2, '0')} <small>{current.label}</small></strong></div><div className="range-wrap"><div className="original-position" style={{ left: `${(data.score - 1) / 9 * 100}%` }}><span>{target}</span><i /></div><input aria-label="正式度温度计" type="range" min="1" max="10" step="1" value={level} style={{ '--range-progress': `${(level - 1) / 9 * 100}%` } as React.CSSProperties} onChange={e => { setLevel(Number(e.target.value)); setIndex(0); }} /><div className="range-ticks">{Array.from({ length: 10 }, (_, i) => <button key={i} aria-label={`正式度 ${i + 1}`} aria-pressed={level === i + 1} onClick={() => { setLevel(i + 1); setIndex(0); }}>{i + 1}</button>)}</div></div><div className="range-endpoints"><span>街头 · 俚语</span><span>日常 · 口语</span><span>法律 · 学术</span></div></div>
    <div className="register-words">{current.candidates.map((c, i) => <button className={index === i ? 'selected' : ''} key={c.word} onClick={() => setIndex(i)}><span>{c.word}</span><small>{c.nuance}</small><ArrowRight size={16} /></button>)}</div>
    <div className="register-example">{candidate ? <><ExampleLine value={candidate.example} /><div className="candidate-context"><span><Users size={13} /> {candidate.persona}</span><span>{candidate.prosody}</span></div><p className="meaning-shift"><MoveUpRight size={14} />{candidate.shift}</p></> : <div className="empty-level"><p>此档暂无自然表达</p>{nearest && <button className="text-button" onClick={() => { setLevel(nearest.level); setIndex(0); }}>看看第 {nearest.level} 档 <ArrowRight size={14} /></button>}</div>}</div>
    <p className="subtext"><span>言外之意</span>{data.subtext}</p>
  </Section>;
}
export function Chunks({ data, onAdd }: { data: AnalysisDocument['dimensions']['three']['chunks']; onAdd: (phrase: string) => void }) {
  const [copied, setCopied] = useState('');
  async function copy(phrase: string) { try { await navigator.clipboard.writeText(phrase); setCopied(phrase); window.setTimeout(() => setCopied(''), 1800); } catch { setCopied(''); } }
  return <Section number={6} title="高频黄金语块">
    <div className="chunks-list">{data.items.map((item, i) => <div className="chunk" key={item.phrase}><span className="chunk-index">0{i + 1}</span><div className="chunk-content"><h4>{item.phrase}</h4><p>{item.meaning}</p><details><summary>放进句子里 <ChevronDown size={12} /></summary><ExampleLine value={item.example} /></details></div><div className="chunk-actions"><button className="icon-button" aria-label={`复制 ${item.phrase}`} onClick={() => copy(item.phrase)}>{copied === item.phrase ? <Check size={15} /> : <Copy size={15} />}</button><button className="icon-button" aria-label={`收藏语块 ${item.phrase}`} onClick={() => onAdd(item.phrase)}><Layers3 size={15} /></button></div></div>)}</div>
    {!!data.culture.length && <div className="culture-block"><span className="eyebrow">文化与习语</span>{data.culture.map(c => <details key={c.expression}><summary>{c.expression}<ChevronDown size={14} /></summary><p>{c.explanation}</p><ExampleLine value={c.example} /></details>)}</div>}
  </Section>;
}
export function Pitfalls({ data }: { data: AnalysisDocument['dimensions']['three']['pitfalls'] }) {
  return <Section number={7} title="翻车最小对比组"><div className="pitfalls-list">{data.items.map((item, i) => <div className="pitfall" key={i}><span className="pitfall-index">对比 0{i + 1}</span><div className="wrong-sentence"><X size={17} /><span>{item.wrong}</span></div><details><summary>听者脑中发生了什么？<ChevronDown size={14} /></summary><div className="pitfall-explanation"><p>{item.image}</p><p>{item.explanation}</p></div><div className="right-sentence"><Check size={17} /><span>{item.right}</span></div><p className="sentence-translation">{item.translation}</p></details></div>)}</div></Section>;
}
export function Slices({ data, children }: { data: AnalysisDocument['dimensions']['three']['slices']; children: ReactNode }) {
  const [selected, setSelected] = useState(0);
  const dialogue = data.dialogues[selected];
  return <Section number={8} title="鲜活语境与考官实战" className="slices-module"><div className="slice-tabs" role="tablist" aria-label="对话场景" onKeyDown={event => navigateTabs(event, setSelected)}>{data.dialogues.map((d, i) => <button id={`dialogue-tab-${i}`} role="tab" aria-controls="dialogue-panel" tabIndex={i === selected ? 0 : -1} aria-selected={i === selected} className={i === selected ? 'active' : ''} key={d.setting} onClick={() => setSelected(i)}>{[<MessageCircle size={15} key="f" />, <Users size={15} key="w" />, <Sparkles size={15} key="c" />][i]}{({ friends: '朋友闲聊', work: '职场社交', culture: '影视文化' })[d.setting]}</button>)}</div><div id="dialogue-panel" role="tabpanel" aria-labelledby={`dialogue-tab-${selected}`} className="dialogue"><p className="dialogue-title">{dialogue.title}</p>{dialogue.lines.map((line, i) => <div className={`dialogue-line ${i % 2 ? 'other' : ''}`} key={`${selected}-${i}`}><span className="speaker-avatar">{line.speaker.slice(0, 1)}</span><div><span className="speaker-name">{line.speaker}</span><div className="speech"><p lang="en">{line.en}</p><span>{line.zh}</span></div><details className="annotation"><summary>读懂这一句 <ChevronDown size={12} /></summary><p>{line.annotation}</p></details></div></div>)}</div>{children}</Section>;
}
type DimensionLoadState = 'waiting' | 'running' | 'paused' | 'failed';
export function LoadingDimension({ label, state, error, progress, onResume, onPause }: { label: string; state: DimensionLoadState; error?: string; progress?: GenerationProgress; onResume?: () => void; onPause?: () => void }) {
  const title = { waiting: '等待前序维度完成', running: progress?.phase === 'repairing' ? '正在校正输出结构…' : label, paused: '这个维度尚未完成', failed: '这个维度生成未完成' }[state];
  const detail = { waiting: '完成前一个维度后，会继续生成这里的内容。', running: progress?.phase === 'thinking' ? '模型正在推理，准备词汇内容。' : '正在接收模型输出，可以随时暂停。', paused: '从这里继续生成，无需重做前面的维度。', failed: error || '请求未完成，请重试当前维度。' }[state];
  return <div className="loading-dimension" data-state={state} role={state === 'failed' ? 'alert' : 'status'}>
    {state === 'running' && <div className="loading-pulse" />}
    <p>{title}</p><span>{detail}</span>
    {state === 'running' && progress && progress.receivedChars > 0 && <span className="stream-progress" aria-live="off">已接收 {progress.receivedChars.toLocaleString('zh-CN')} 字</span>}
    {state === 'running' && <><div className="skeleton-line" /><div className="skeleton-line short" /></>}
    {onPause && <button className="secondary-button" onClick={onPause}>暂停生成</button>}
    {onResume && <button className="primary-button" onClick={onResume}>{state === 'failed' ? '重试当前维度' : '继续生成'}<ArrowRight size={15} /></button>}
  </div>;
}
export function WordHero({ doc, isDemo }: { doc: AnalysisDraft; isDemo: boolean }) {
  const one = doc.dimensions.one;
  return <div className="word-hero"><div className="word-hero-main"><div className="hero-kicker"><span className="live-dot" />{isDemo ? '示例' : '词条'}<span className="hero-language">{doc.language}</span></div><div className="word-title-row"><h1 lang="en">{doc.target}</h1>{one && <span className="part-of-speech">{one.overview.partOfSpeech}</span>}</div>{one && <><p className="pronunciation">{one.overview.pronunciation}</p><h2>{one.overview.core}</h2><p className="hero-definition">{one.overview.definition}</p></>}</div><div className="hero-art"><WordHelix doc={doc} /></div></div>;
}
export function DimensionContent({ doc, index, onAdd, sandbox, state, error, progress, onResume, onPause }: { doc: AnalysisDraft; index: number; onAdd: (phrase: string) => void; sandbox: ReactNode; state: DimensionLoadState; error?: string; progress?: GenerationProgress; onResume?: () => void; onPause?: () => void }) {
  const loading = <LoadingDimension label={['正在挖掘词源与同源关系…', '正在描绘独立概念坐标…', '正在构建真实语境与练习…'][index]} state={state} error={error} progress={progress} onResume={onResume} onPause={onPause} />;
  if (index === 0) return doc.dimensions.one ? <div className="module-grid"><Origin data={doc.dimensions.one.origin} /><Bloodline target={doc.target} data={doc.dimensions.one.bloodline} /></div> : loading;
  if (index === 1) return doc.dimensions.two ? <><Concept data={doc.dimensions.two.concept} /><Nuance data={doc.dimensions.two.nuance} /></> : loading;
  return doc.dimensions.three ? <><Register target={doc.target} data={doc.dimensions.three.register} /><div className="module-grid lower-grid"><Chunks data={doc.dimensions.three.chunks} onAdd={onAdd} /><Pitfalls data={doc.dimensions.three.pitfalls} /></div><Slices data={doc.dimensions.three.slices}>{sandbox}</Slices></> : loading;
}
