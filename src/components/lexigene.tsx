'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import * as m from 'motion/react-m';
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Clock3, Download, FileJson, FlaskConical, FolderHeart, History, Layers3, Loader2, Menu, Plus, Search, Send, Settings2, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { demo } from '@/lib/demo';
import { analysisSchema, apiConfigSchema, dimensionSchemas, gradeSchema, type AnalysisDocument, type AnalysisDraft, type ApiConfig, type Attempt, type DimensionKey, type GenerationProgress, type QuizQuestion, type StudyCard, type VocabularyHint } from '@/lib/schema';
import { buildCards, cardsToTsv } from '@/lib/cards';
import { deleteAnalysis, getAttempts, getDrafts, getHistory, loadSelections, saveAnalysis, saveAttempt, saveDraft, saveSelections } from '@/lib/storage';
import { apiFetch as fetch, defaultConfig, downloadBlob, persistConfig, readConfig, readEvents, responseError, safeFilename } from '@/lib/client';
import { DimensionContent, DimensionHeading, dimensionNames, ExampleLine, moduleIcons, moduleNames, WordHero } from './modules';
import { QuizScenario } from './quiz-scenario';
import brandIcon from '@/app/icon.svg';

type DrawerKind = 'settings' | 'history' | 'export' | null;
const keys: DimensionKey[] = ['one', 'two', 'three'];
const cardTypeNames = { core: '核心概念', chunk: '常见搭配', pitfall: '易错对比', nuance: '近义辨析', quiz: '情境造句' };
const initialTypes = new Set(['core', 'chunk', 'pitfall']);

export default function LexiGene() {
  const [doc, setDoc] = useState<AnalysisDraft>(demo);
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('美式英语');
  const [config, setConfig] = useState<ApiConfig>(defaultConfig);
  const [remember, setRemember] = useState(false);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [history, setHistory] = useState<AnalysisDocument[]>([]);
  const [drafts, setDrafts] = useState<AnalysisDraft[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<DimensionKey>('one');
  const [progress, setProgress] = useState<GenerationProgress>();
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [activeModule, setActiveModule] = useState(1);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const directoryTrigger = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parsed = useMemo(() => analysisSchema.safeParse(doc), [doc]);
  const complete = parsed.success ? parsed.data : null;
  const firstMissing = keys.find(key => !doc.dimensions[key]);
  const cards = useMemo(() => complete ? buildCards(complete) : [], [complete]);
  const notify = useCallback((message: string) => { setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4200); }, []);
  const refreshHistory = useCallback(async () => { const [a, d] = await Promise.all([getHistory(), getDrafts()]); setHistory(a); setDrafts(d); }, []);

  useEffect(() => {
    try { const saved = readConfig(); setConfig(saved.config); setRemember(saved.remember); } catch { notify('浏览器未允许保存 API 设置。'); }
    void refreshHistory().catch(() => notify('本地存储暂不可用，请允许此站点存储数据。'));
    return () => { controller.current?.abort(); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [notify, refreshHistory]);
  useEffect(() => {
    let current = true;
    void getAttempts(doc.id).then(data => { if (current) setAttempts(data); }).catch(() => {});
    return () => { current = false; };
  }, [doc.id]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) setActiveModule(Number(entry.target.id.replace('module-', ''))); }, { rootMargin: '-12% 0px -65% 0px' });
    document.querySelectorAll('section[id^="module-"]').forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [doc]);

  function jump(id: string) { document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); setMobileMenu(false); }
  async function openExport(phrase?: string) {
    if (!complete) return notify('完成三个维度后即可导出。');
    try {
      const stored = await loadSelections(complete.id);
      const defaults = cards.filter(card => initialTypes.has(card.type)).map(card => card.id);
      const chosen = stored ?? defaults;
      const match = phrase ? cards.find(card => card.type === 'chunk' && card.front.includes(phrase)) : undefined;
      setSelectedCards(match ? Array.from(new Set([...chosen, match.id])) : chosen);
      setDrawer('export');
    } catch { notify('无法读取本地导出选择，请重试。'); }
  }
  async function openRecord(record: AnalysisDraft) { if (busy) return; setDoc(record); setLanguage(record.language); setQuery(''); setError(''); setDrawer(null); window.scrollTo({ top: 0, behavior: 'instant' }); }
  async function generate(targetDraft?: AnalysisDraft) {
    if (busy) return;
    if (!apiConfigSchema.safeParse(config).success) { setDrawer('settings'); return; }
    const target = query.trim();
    if (!targetDraft && !target) { document.getElementById('target-input')?.focus(); return; }
    if (!targetDraft) {
      const found = history.find(item => item.target.toLowerCase() === target.toLowerCase() && item.language === language);
      if (found) { await openRecord(found); notify('已打开本地学习记录，可点击「重新解析」更新。'); return; }
    }
    const working: AnalysisDraft = targetDraft ? structuredClone(targetDraft) : { schemaVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), target, language, dimensions: {} };
    const abort = new AbortController(); controller.current = abort;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const armTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; abort.abort(); }, 660_000);
    };
    armTimeout();
    setDoc(working); setBusy(true); setProgress(undefined); setError(''); setDrawer(null); setStage(keys.find(key => !working.dimensions[key]) || 'one');
    try {
      await saveDraft(working);
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config, draft: working }), signal: abort.signal });
      await readEvents(response, async event => {
        if (event.type === 'dimension-start') { armTimeout(); setStage(event.dimension); setProgress(undefined); }
        if (event.type === 'dimension-progress') setProgress({ receivedChars: event.receivedChars, phase: event.phase });
        if (event.type === 'dimension-complete') {
          armTimeout();
          const data = dimensionSchemas[event.dimension].parse(event.data);
          Object.assign(working.dimensions, { [event.dimension]: data });
          setDoc(structuredClone(working)); await saveDraft(working);
        }
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'complete') {
          const result = analysisSchema.parse(working); await saveAnalysis(result); setDoc(result); await refreshHistory(); notify('八个模块已就绪，开始探索吧。');
        }
      });
    } catch (cause) {
      if (timedOut) setError('这一维度等待超时，已停止请求。可以重试当前维度，或更换响应更快的模型。');
      else if (abort.signal.aborted) notify('已暂停，完成的维度已经保存。');
      else setError(cause instanceof Error ? cause.message : '生成未完成，请重试。');
      await saveDraft(working).catch(() => {});
      await refreshHistory().catch(() => {});
    } finally { clearTimeout(timer); setBusy(false); controller.current = null; }
  }
  async function importJson(file?: File) {
    if (!file) return;
    try { if (file.size > 4 * 1024 * 1024) throw new Error('请选择小于 4 MB 的解析文件。'); const record = analysisSchema.parse(JSON.parse(await file.text())); await saveAnalysis(record); await refreshHistory(); await openRecord(record); notify('解析已导入学习档案。'); }
    catch (cause) { notify(cause instanceof Error && cause.message.includes('4 MB') ? cause.message : '文件结构不符合 LexiGene JSON 格式。'); }
    if (fileInput.current) fileInput.current.value = '';
  }
  async function removeRecord(id: string) { try { await deleteAnalysis(id); await refreshHistory(); notify('已从本机移除此学习记录。'); } catch { notify('删除未完成，请重试。'); } }
  function saveConfig(next: ApiConfig, persistent: boolean) { try { persistConfig(next, persistent); setConfig(next); setRemember(persistent); setDrawer(null); notify('API 设置已保存。'); } catch { notify('设置未保存，请检查浏览器存储权限。'); } }
  async function storeQuestionHints(questionId: string, hints: VocabularyHint[]) {
    const next = structuredClone(doc);
    const question = next.dimensions.three?.slices.quiz.find(item => item.id === questionId);
    if (!question || question.hints !== undefined) return;
    question.hints = hints;
    setDoc(current => current.id === next.id ? next : current);
    try {
      const ready = analysisSchema.safeParse(next);
      if (ready.success) await saveAnalysis(ready.data);
      else await saveDraft(next);
      await refreshHistory();
    } catch { notify('词汇提示已加载，本机保存未完成。'); }
  }
  function showDemo() { if (busy) return; void openRecord(demo); }
  const focusSearch = useCallback(() => {
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    requestAnimationFrame(() => document.getElementById('target-input')?.focus({ preventScroll: true }));
  }, []);

  const sidebar = <><div className="sidebar-workspace"><button className="workspace-link selected" onClick={focusSearch}><FlaskConical size={17} /> 词汇研究台 <span className="shortcut">⌘ K</span></button><button className="workspace-link" onClick={() => { setMobileMenu(false); setDrawer('history'); }}><FolderHeart size={17} /> 学习档案 <span className="count-badge">{history.length}</span></button></div><div className="sidebar-chapters"><div className="sidebar-label chapter-label">解剖目录 <span>8 个模块</span></div>{dimensionNames.map((name, d) => <div className={`chapter-group chapter-${d}`} key={name}><span className="chapter-group-name"><i />{name}</span>{moduleNames.map((name, i) => { if ((d === 0 && i > 1) || (d === 1 && (i < 2 || i > 3)) || (d === 2 && i < 4)) return null; const Icon = moduleIcons[i]; return <button key={name} onClick={() => jump(`module-${i + 1}`)} aria-current={activeModule === i + 1 ? 'location' : undefined} className={activeModule === i + 1 ? 'active' : ''}><Icon size={15} /><span>{name}</span><small>{String(i + 1).padStart(2, '0')}</small></button>; })}</div>)}</div><div className="sidebar-bottom"><button className="api-sidebar" onClick={() => { setMobileMenu(false); setDrawer('settings'); }}><span className={`api-status ${config.apiKey ? 'configured' : ''}`} /><span><strong>{config.apiKey ? '模型已配置' : '连接你的模型'}</strong>{config.apiKey && <small>{config.model}</small>}</span><Settings2 size={16} /></button></div></>;

  useEffect(() => { const handle = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); focusSearch(); } }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle); }, [focusSearch]);

  return <MotionConfig reducedMotion="user"><LazyMotion features={domAnimation} strict><div className="app-shell">
    <header className="topbar">
      <a href="#" className="brand" aria-label="LexiGene 首页" onClick={e => { e.preventDefault(); showDemo(); }}><span className="brand-icon"><BrandMark /></span><span>LexiGene<span className="brand-dot">.</span></span></a>
      <div className="topbar-actions">
        <button className="top-link" onClick={showDemo} disabled={busy}><Sparkles size={15} />探索示例</button>
        <button className="topbar-button" aria-label="学习历史" onClick={() => setDrawer('history')}><History size={17} /><span className="top-action-label">学习档案</span></button>
        <button className="topbar-button settings-trigger" aria-label="模型设置" onClick={() => setDrawer('settings')}><Settings2 size={17} /><span className="top-action-label">模型设置</span><span className={`api-status ${config.apiKey ? 'configured' : ''}`} /></button>
        <button ref={directoryTrigger} className="mobile-menu icon-button" aria-label="打开目录" aria-expanded={mobileMenu} aria-controls="mobile-directory" onClick={() => setMobileMenu(true)}><Menu size={20} /></button>
      </div>
    </header>
    <aside className="sidebar" aria-label="词汇导航">{sidebar}</aside>
    {mobileMenu && <Drawer title="词汇目录" subtitle="" side="left" onClose={() => { setMobileMenu(false); requestAnimationFrame(() => directoryTrigger.current?.focus({ preventScroll: true })); }}><div className="directory-body">{sidebar}</div></Drawer>}
    <main className="main"><div className="canvas"><div className="page-intro"><div><h2>从词源到语境，读懂一个词。</h2><p>追溯词根与同源关系，辨析近义词，练习自然表达。</p></div></div>
    <form className="search-bar" onSubmit={e => { e.preventDefault(); void generate(); }}><Search size={20} /><input id="target-input" value={query} maxLength={120} autoComplete="off" onChange={e => setQuery(e.target.value)} placeholder="输入一个英文单词或短语" aria-label="目标单词或短语" disabled={busy} /><div className="language-select"><select aria-label="目标英语变体" value={language} onChange={e => setLanguage(e.target.value)} disabled={busy}><option>美式英语</option><option>英式英语</option><option>澳大利亚英语</option><option>加拿大英语</option><option>通用英语</option></select><ChevronDown size={13} /></div><button type="submit" className="primary-button" disabled={busy}>{busy ? <><Loader2 size={15} className="spin" /><span>解剖中</span></> : <><span>开始解剖</span><ArrowRight size={16} /></>}</button></form>
    <div className="search-foot"><span>单词、短语、俚语，都可以探索</span><button className="text-button" onClick={() => setDrawer('settings')}><span className={`api-status ${config.apiKey ? 'configured' : ''}`} /><span className="model-name">{config.apiKey ? config.model : '连接模型'}</span><ArrowRight size={12} /></button></div>
    <div className="study-sheet"><div className="sheet-toolbar"><span><BookOpen size={16} />词汇笔记<i>/</i><span>{doc.id === demo.id ? '示例研究' : '个人词汇'}</span></span><div><button aria-label="下载 JSON" title="下载 JSON" className="icon-button json-export" disabled={!complete} onClick={() => complete && downloadBlob(new Blob([JSON.stringify(complete, null, 2)], { type: 'application/json' }), `${safeFilename(doc.target)}.json`)}><FileJson size={16} /><span>JSON</span></button><button className="export-button" disabled={!complete} onClick={() => void openExport()}><Layers3 size={14} /><span>导出 Anki</span><ArrowDownToLine size={13} /></button></div></div>
    <WordHero key={doc.id} doc={doc} isDemo={doc.id === demo.id} />
    <nav className="dimension-nav" aria-label="三大维度">{dimensionNames.map((name, i) => <button key={name} onClick={() => jump(`dimension-${i}`)} className={`dimension-nav-${i} ${Math.floor((activeModule - 1) / 2) === i || (i === 2 && activeModule >= 5) ? 'current' : ''}`}><span>0{i + 1}</span>{name}<ArrowRight size={13} /></button>)}</nav>
    {busy && <div className="generation-progress" role="status"><Loader2 size={15} className="spin" /><span>正在完成{dimensionNames[keys.indexOf(stage)]}…</span><button onClick={() => controller.current?.abort()}>暂停生成</button></div>}
    {error && <div className="generation-error" role="status"><p>{dimensionNames[keys.indexOf(firstMissing || stage)]}生成未完成</p><button className="text-button" onClick={() => jump(`dimension-${keys.indexOf(firstMissing || stage)}`)}>查看原因与重试 <ArrowRight size={14} /></button></div>}
    {!busy && !error && !complete && <div className="generation-progress"><Clock3 size={15} /><span>继续完成这份词汇研究</span><button onClick={() => jump(`dimension-${keys.indexOf(firstMissing || stage)}`)}>定位未完成处</button></div>}
    <div className="study-content">{dimensionNames.map((_, i) => <div id={`dimension-${i}`} key={`${doc.id}-${i}`} className={`dimension-content dim-${i}`}><DimensionHeading index={i} /><DimensionContent doc={doc} index={i} progress={busy && stage === keys[i] ? progress : undefined} onPause={busy && stage === keys[i] ? () => controller.current?.abort() : undefined} state={busy ? (stage === keys[i] ? 'running' : 'waiting') : (firstMissing === keys[i] ? (error ? 'failed' : 'paused') : 'waiting')} error={firstMissing === keys[i] ? error : undefined} onResume={!busy && firstMissing === keys[i] ? () => void generate(doc) : undefined} onAdd={phrase => void openExport(phrase)} sandbox={doc.dimensions.three ? <Sandbox key={doc.id} doc={doc} config={config} attempts={attempts} onConfigure={() => setDrawer('settings')} onAttempt={async attempt => { await saveAttempt(attempt); setAttempts(current => [...current, attempt]); }} onQuestionHints={(questionId, hints) => void storeQuestionHints(questionId, hints)} /> : null} /></div>)}</div>
    <footer className="study-footer"><span className="footer-mark"><BrandMark /> LexiGene.</span><button className="text-button" onClick={focusSearch}>查询下一个词 <ArrowRight size={14} /></button></footer></div>
    <div className="page-bottom">{complete && doc.id !== demo.id && <button onClick={() => void generate({ ...doc, id: crypto.randomUUID(), createdAt: new Date().toISOString(), dimensions: {} })} disabled={busy}>重新解析 {doc.target}</button>}</div></div></main>
    <AnimatePresence>{toast && <m.div role="status" className="toast" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}><CheckCircle2 size={17} />{toast}</m.div>}</AnimatePresence>
    {drawer && <Drawer title={{ settings: '连接你的语言模型', history: '学习档案', export: '导出 Anki 卡片' }[drawer]} subtitle="" onClose={() => setDrawer(null)}>
      {drawer === 'settings' && <SettingsForm config={config} remember={remember} onSave={saveConfig} />}
      {drawer === 'history' && <HistoryPanel history={history} drafts={drafts} busy={busy} onOpen={openRecord} onDelete={removeRecord} onImport={() => fileInput.current?.click()} />}
      {drawer === 'export' && complete && <ExportPanel doc={complete} cards={cards} selected={selectedCards} onChange={ids => { setSelectedCards(ids); void saveSelections(complete.id, ids).catch(() => notify('无法保存卡片选择，请重试。')); }} notify={notify} />}
    </Drawer>}
    <input type="file" hidden ref={fileInput} accept="application/json,.json" aria-label="导入 JSON 文件" onChange={e => void importJson(e.target.files?.[0])} /></div></LazyMotion></MotionConfig>;
}

function BrandMark() { return <img src={brandIcon} width={36} height={36} alt="" aria-hidden="true" />; }

function Drawer({ title, subtitle, onClose, children, side = 'right' }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; side?: 'left' | 'right' }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { dialog?.close(); document.body.style.overflow = previous; }; }, []);
  return <dialog id={side === 'left' ? 'mobile-directory' : undefined} className={`drawer-dialog${side === 'left' ? ' directory-dialog' : ''}`} ref={ref} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby={side === 'left' ? 'directory-title' : 'drawer-title'}><m.div className="drawer-content" initial={{ opacity: 0, x: side === 'left' ? -20 : 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .2, ease: 'easeOut' }}><header className="drawer-header">{subtitle && <span className="eyebrow">{subtitle}</span>}<h2 id={side === 'left' ? 'directory-title' : 'drawer-title'}>{title}</h2><button className="icon-button" aria-label="关闭面板" onClick={onClose}><X size={20} /></button></header>{children}</m.div></dialog>;
}
function SettingsForm({ config, remember, onSave }: { config: ApiConfig; remember: boolean; onSave: (config: ApiConfig, remember: boolean) => void }) {
  const [form, setForm] = useState(config);
  const [persistent, setPersistent] = useState(remember);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showModelList, setShowModelList] = useState(false);
  const [modelsMessage, setModelsMessage] = useState('');
  const [modelsError, setModelsError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const pending = testing || loadingModels;
  useEffect(() => () => request.current?.abort(), []);

  function update(key: keyof ApiConfig, value: string) {
    request.current?.abort();
    setTesting(false); setLoadingModels(false); setMessage('');
    setForm(current => ({ ...current, [key]: value }));
    if (key === 'baseUrl' || key === 'apiKey') {
      setModels([]); setShowModelList(false); setModelsMessage(''); setModelsError(false);
    }
  }
  function validated() {
    const value = { ...form, baseUrl: form.baseUrl.trim().replace(/\/+$/, ''), model: form.model.trim(), apiKey: form.apiKey.trim() };
    const parsed = apiConfigSchema.safeParse(value);
    if (!parsed.success) { setMessage('请填写有效的 API 地址、密钥和模型名。'); setSuccess(false); return null; }
    return parsed.data;
  }
  async function loadModels() {
    const parsed = apiConfigSchema.pick({ baseUrl: true, apiKey: true }).safeParse({ baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim() });
    if (!parsed.success) { setModelsError(true); setModelsMessage('请先填写有效的 API 地址和密钥。'); return; }
    const abort = new AbortController(); request.current = abort;
    setLoadingModels(true); setModelsMessage(''); setModelsError(false);
    try {
      const response = await fetch('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: parsed.data }), signal: abort.signal });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { models: string[] };
      if (abort.signal.aborted) return;
      setModels(data.models); setShowModelList(data.models.length > 0);
      setModelsMessage(data.models.length ? `已获取 ${data.models.length} 个模型，选择后即可测试连接。` : '服务商返回的模型列表为空，可直接填写模型 ID。');
    } catch (cause) {
      if (!abort.signal.aborted) { setModelsError(true); setModelsMessage(cause instanceof Error ? cause.message : '模型列表拉取失败，请重试。'); }
    } finally {
      if (request.current === abort) { request.current = null; setLoadingModels(false); }
    }
  }
  async function test() {
    const value = validated(); if (!value) return;
    const abort = new AbortController(); request.current = abort;
    setTesting(true); setMessage('');
    try {
      const response = await fetch('/api/connection-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: value }), signal: abort.signal });
      if (!response.ok) throw new Error(await responseError(response));
      if (!abort.signal.aborted) { setSuccess(true); setMessage('连接成功，模型已经准备好了。'); }
    } catch (cause) {
      if (!abort.signal.aborted) { setSuccess(false); setMessage(cause instanceof Error ? cause.message : '连接未完成，请重试。'); }
    } finally {
      if (request.current === abort) { request.current = null; setTesting(false); }
    }
  }
  return <form className="settings-form" onSubmit={e => { e.preventDefault(); const value = validated(); if (value) onSave(value, persistent); }}>
    <div className="provider-mark"><span className="provider-icon"><Sparkles size={22} /></span><div><strong>OpenAI 兼容接口</strong></div></div>
    <label>API Base URL<input type="url" placeholder="https://api.openai.com/v1" value={form.baseUrl} onChange={e => update('baseUrl', e.target.value)} required /><small>填写 API 根路径，例如 https://api.openai.com/v1</small></label>
    <label>API Key<input type="password" autoComplete="off" placeholder="sk-…" value={form.apiKey} onChange={e => update('apiKey', e.target.value)} required /></label>
    <div className="model-field">
      <div className="model-field-heading"><label htmlFor="model-name">模型名称</label><span>
        {models.length > 0 && <button type="button" className="text-button" onClick={() => setShowModelList(value => !value)}>{showModelList ? '手动输入' : '从列表选择'}</button>}
        <button type="button" className="text-button" disabled={pending || !form.baseUrl.trim() || !form.apiKey.trim()} onClick={() => void loadModels()}>{loadingModels ? <Loader2 size={13} className="spin" /> : <Download size={13} />}{loadingModels ? '拉取中' : '拉取模型'}</button>
      </span></div>
      {showModelList ? <select id="model-name" value={form.model} onChange={e => update('model', e.target.value)} required>
        {!form.model && <option value="" disabled>选择一个模型</option>}
        {form.model && !models.includes(form.model) && <option value={form.model}>{form.model}（当前填写）</option>}
        {models.map(model => <option key={model} value={model}>{model}</option>)}
      </select> : <input id="model-name" placeholder="gpt-4.1-mini" value={form.model} onChange={e => update('model', e.target.value)} required />}
      <small role={modelsMessage ? 'status' : undefined} className={modelsError ? 'model-list-error' : ''}>{modelsMessage || '使用服务商提供的完整模型 ID。'}</small>
    </div>
    <label className="checkbox-label"><input type="checkbox" checked={persistent} onChange={e => setPersistent(e.target.checked)} />记住在本机</label>
    <p className="storage-hint">{persistent ? '设置将保存在此浏览器，供下次使用。' : '设置保留到当前标签页会话结束。'}</p>
    {message && <p role="status" className={`form-message ${success ? 'success' : 'failure'}`}>{message}</p>}
    <div className="form-actions"><button type="button" className="secondary-button" disabled={pending} onClick={() => void test()}>{testing ? <Loader2 size={15} className="spin" /> : <FlaskConical size={15} />}测试连接</button><button className="primary-button" type="submit" disabled={pending}>保存设置 <ArrowRight size={15} /></button></div>
  </form>;
}
function HistoryPanel({ history, drafts, busy, onOpen, onDelete, onImport }: { history: AnalysisDocument[]; drafts: AnalysisDraft[]; busy: boolean; onOpen: (doc: AnalysisDraft) => Promise<void>; onDelete: (id: string) => Promise<void>; onImport: () => void }) {
  const [search, setSearch] = useState(''); const [confirm, setConfirm] = useState('');
  const records = [...history.map(doc => ({ doc, draft: false })), ...drafts.filter(d => !history.some(h => h.id === d.id)).map(doc => ({ doc, draft: true }))].filter(({ doc }) => doc.target.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.doc.createdAt.localeCompare(a.doc.createdAt));
  return <div className="history-panel"><div className="history-search"><Search size={17} /><input aria-label="搜索学习记录" placeholder="寻找一个学过的词…" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="history-meta"><span>{records.length} 份词汇研究</span><button className="text-button" onClick={onImport} disabled={busy}><Upload size={14} />导入 JSON</button></div>{!records.length && <div className="empty-state"><BookOpen size={35} strokeWidth={1} /><h3>{search ? '还没找到这个词' : '让第一个词，成为起点。'}</h3><p>{search ? '试试另一个关键词。' : '生成的解析会自动收进这里。'}</p></div>}<div className="history-list">{records.map(({ doc, draft }) => <div className="history-item" key={doc.id}><button disabled={busy} className="history-open" onClick={() => void onOpen(doc)}><strong>{doc.target}</strong><span>{doc.language}<i>·</i>{new Date(doc.createdAt).toLocaleDateString('zh-CN')}{draft && <em>待完成</em>}</span></button>{confirm === doc.id ? <div className="delete-confirm"><span>删除这份记录？</span><button onClick={() => { void onDelete(doc.id); setConfirm(''); }}>删除</button><button onClick={() => setConfirm('')}>保留</button></div> : <button className="icon-button" aria-label={`删除 ${doc.target}`} disabled={busy} onClick={() => setConfirm(doc.id)}><Trash2 size={16} /></button>}</div>)}</div></div>;
}
function ExportPanel({ doc, cards, selected, onChange, notify }: { doc: AnalysisDocument; cards: StudyCard[]; selected: string[]; onChange: (ids: string[]) => void; notify: (message: string) => void }) {
  const [deckName, setDeckName] = useState('LexiGene'); const [busy, setBusy] = useState(false);
  const chosen = cards.filter(card => selected.includes(card.id));
  function toggle(id: string) { onChange(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]); }
  async function rememberChoice() { await saveSelections(doc.id, selected); }
  async function exportApkg() { if (!chosen.length) return; setBusy(true); try { await rememberChoice(); const response = await fetch('/api/export/anki', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deckName: deckName.trim() || 'LexiGene', cards: chosen }) }); if (!response.ok) throw new Error(await responseError(response)); downloadBlob(await response.blob(), `${safeFilename(doc.target)}.apkg`); notify('Anki 牌组已准备好，导入后就能复习。'); } catch (cause) { notify(cause instanceof Error ? cause.message : '导出未完成，请重试。'); } finally { setBusy(false); } }
  async function exportTsv() { try { await rememberChoice(); downloadBlob(new Blob([cardsToTsv(chosen)], { type: 'text/tab-separated-values;charset=utf-8' }), `${safeFilename(doc.target)}.tsv`); } catch { notify('无法保存导出选择，请重试。'); } }
  return <div className="export-panel"><div className="export-word"><strong>{doc.target}</strong><small>{chosen.length} / {cards.length} 张卡片已选</small></div><label className="deck-label">Anki 牌组名称<input value={deckName} onChange={e => setDeckName(e.target.value)} maxLength={100} /></label><div className="card-type-toggles">{Object.entries(cardTypeNames).map(([type, name]) => { const group = cards.filter(c => c.type === type); const checked = group.length > 0 && group.every(c => selected.includes(c.id)); return <button className={checked ? 'selected' : ''} key={type} onClick={() => onChange(checked ? selected.filter(id => !group.some(c => c.id === id)) : Array.from(new Set([...selected, ...group.map(c => c.id)])))}>{checked && <Check size={12} />}{name}</button>; })}</div><div className="export-cards">{cards.map(card => <label className={`export-card ${selected.includes(card.id) ? 'selected' : ''}`} key={card.id}><input type="checkbox" checked={selected.includes(card.id)} onChange={() => toggle(card.id)} /><span><small>{cardTypeNames[card.type]}</small><strong>{card.front}</strong><details onClick={e => e.stopPropagation()}><summary>查看背面</summary><p>{card.back}</p></details></span></label>)}</div><div className="export-sticky"><button className="primary-button" disabled={!chosen.length || busy} onClick={() => void exportApkg()}>{busy ? <Loader2 size={16} className="spin" /> : <Download size={16} />}导出 Anki 牌组 <span>{chosen.length}</span></button><div><button disabled={!chosen.length || busy} onClick={() => void exportTsv()}>下载 TSV</button><span>·</span><button onClick={() => downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${safeFilename(doc.target)}.json`)}>完整 JSON</button></div></div></div>;
}
function Sandbox({ doc, config, attempts, onConfigure, onAttempt, onQuestionHints }: { doc: AnalysisDraft; config: ApiConfig; attempts: Attempt[]; onConfigure: () => void; onAttempt: (attempt: Attempt) => Promise<void>; onQuestionHints: (questionId: string, hints: VocabularyHint[]) => void }) {
  const [questionIndex, setQuestionIndex] = useState(0); const [answers, setAnswers] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [reference, setReference] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const three = doc.dimensions.three!; const question = three.slices.quiz[questionIndex];
  const matching = attempts.filter(a => a.questionId === question.id); const latest = matching[matching.length - 1];
  const answer = answers[question.id] ?? latest?.answer ?? '';
  useEffect(() => () => abortRef.current?.abort(), []);
  async function submit(e: FormEvent) { e.preventDefault(); if (!answer.trim() || busy) return; if (!apiConfigSchema.safeParse(config).success) { onConfigure(); return; } setBusy(true); setError(''); const abort = new AbortController(); abortRef.current = abort;
    try { const response = await fetch('/api/grade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config, target: doc.target, language: doc.language, question, answer: answer.trim(), context: { core: doc.dimensions.one?.overview.core || doc.target, register: three.register.score, subtext: three.register.subtext, chunks: three.chunks.items.map(item => item.phrase) } }), signal: abort.signal }); if (!response.ok) throw new Error(await responseError(response)); const grade = gradeSchema.parse(await response.json()); await onAttempt({ id: crypto.randomUUID(), analysisId: doc.id, questionId: question.id, answer: answer.trim(), createdAt: new Date().toISOString(), grade }); }
    catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '批改未完成，请重试。'); } finally { setBusy(false); }
  }
  return <div className="sandbox"><header className="sandbox-header"><span className="examiner-avatar">✳</span><div><h4>造句练习</h4></div><span className="quiz-count">{questionIndex + 1} / 2</span></header><div className="quiz-switch">{three.slices.quiz.map((q, i) => <button className={i === questionIndex ? 'active' : ''} disabled={busy} onClick={() => { setQuestionIndex(i); setReference(false); setError(''); }} key={q.id}>情境 {i + 1}</button>)}</div><QuizScenario key={question.id} question={question} config={config} target={doc.target} language={doc.language} onHints={hints => onQuestionHints(question.id, hints)} /><form onSubmit={submit}><label htmlFor="quiz-answer" className="tiny-label">用 {doc.target} 或相关语块回应</label><textarea id="quiz-answer" lang="en" value={answer} onChange={e => setAnswers({ ...answers, [question.id]: e.target.value })} placeholder="Here’s what I would say…" maxLength={3000} rows={3} disabled={busy} required /><div className="quiz-actions"><button type="button" className="text-button" onClick={() => setReference(!reference)}>{reference ? '收起参考' : '看看参考回答'}<ChevronDown size={13} /></button><button className="primary-button" disabled={busy || !answer.trim()}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={14} />}{busy ? '考官正在斟酌' : latest ? '再次提交批改' : '交给考官'}</button></div></form>{reference && <div className="reference-answer"><ExampleLine value={question.reference} /></div>}{error && <p role="alert" className="form-message failure">{error}</p>}{latest && <div className="grade-result"><div className="grade-scores">{([['naturalness', '地道度'], ['register', '语域匹配'], ['imagery', '画面感']] as const).map(([key, label]) => <div key={key}><span>{label}</span><strong>{latest.grade.scores[key]}<small>/10</small></strong><div className="score-track"><span style={{ transform: `scaleX(${latest.grade.scores[key] / 10})` }} /></div></div>)}</div>{!latest.grade.usesTarget && <p className="target-reminder">把目标词或相关语块加进回应，再试一次。</p>}<p className="grade-feedback">{latest.grade.feedback}</p><div className="polished-answer"><span className="eyebrow">更自然的说法</span><ExampleLine value={latest.grade.correction} /></div><ul className="grade-changes">{latest.grade.changes.map((change, i) => <li key={i}>{change}</li>)}</ul><p className="grade-followup">{latest.grade.followUp}</p><span className="attempt-count">已练习 {matching.length} 次 · 本机自动保存</span></div>}</div>;
}
