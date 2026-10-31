/**
 * Interface locale.
 *
 * Two layers are translated differently on purpose:
 *
 * - The interface chrome has a fixed set of strings, translated here so the app
 *   reads naturally in each offered locale.
 * - The teaching content is written by the model in the explanation language
 *   chosen in settings, so an analysis is stored in the language it was made in.
 *   Switching the interface later does not rewrite old records.
 *
 * `t()` is keyed by the Chinese source text. Anything not yet translated comes
 * back unchanged, which keeps a missing entry readable instead of blank.
 */

import { useSyncExternalStore } from 'react';

export type UiLocale = 'zh-CN' | 'en';

export const uiLocales: { id: UiLocale; label: string; native: string }[] = [
  { id: 'zh-CN', label: '简体中文', native: '简体中文' },
  { id: 'en', label: '英语', native: 'English' },
];

const english: Record<string, string> = {
  // Navigation and chrome
  '词汇研究台': 'Word desk',
  '学习档案': 'Archive',
  '目标词单': 'Word lists',
  '解剖目录': 'Anatomy',
  '8 个模块': '8 modules',
  '从词源到语境，读懂一个词。': 'From root to usage, understand a word.',
  '追溯词根与同源关系，辨析近义词，练习自然表达。': 'Trace the root, weigh the synonyms, practise natural use.',
  '探索示例': 'Explore the example',
  '模型设置': 'Model settings',
  '连接你的模型': 'Connect your model',
  '模型已配置': 'Model connected',
  '连接模型': 'Connect a model',
  '单词、短语、俚语，都可以探索': 'Words, phrases and slang are all fair game',
  '输入一个单词或短语': 'Enter a word or phrase',
  '目标单词或短语': 'Target word or phrase',
  '目标英语变体': 'Variety',
  '开始解剖': 'Analyse',
  '解剖中': 'Analysing',
  '暂停生成': 'Pause',
  '词汇笔记': 'Word notes',
  '示例研究': 'Example study',
  '个人词汇': 'My words',
  '导出 Anki': 'Export Anki',
  '查询下一个词': 'Look up the next word',
  '重新解析': 'Re-analyse',
  '三大维度': 'Three dimensions',

  // Status and errors
  '正在完成': 'Generating',
  '生成未完成': 'Generation stopped',
  '查看原因与重试': 'See why and retry',
  '继续完成这份词汇研究': 'Finish this study',
  '定位未完成处': 'Jump to the gap',
  '已完成': 'Ready',
  '八个模块已就绪，开始探索吧。': 'All eight modules are ready.',
  '已暂停，完成的维度已经保存。': 'Paused. Finished dimensions are saved.',
  '这一维度等待超时，已停止请求。可以重试当前维度，或更换响应更快的模型。': 'This dimension timed out. Retry it, or switch to a faster model.',
  '生成未完成，请重试。': 'Generation did not finish. Try again.',
  '完成三个维度后即可导出。': 'Finish all three dimensions to export.',
  '已打开本地学习记录，可点击「重新解析」更新。': 'Opened the saved record. Use Re-analyse to refresh it.',

  // Modules
  '词源与同源词': 'Roots & cognates',
  '词义与近义词': 'Meaning & synonyms',
  '用法与练习': 'Usage & practice',
  '词源与演化': 'Etymology',
  '同源词': 'Cognates',
  '核心词义': 'Core meaning',
  '近义词辨析': 'Synonyms',
  '语域与正式度': 'Register',
  '常见搭配': 'Collocations',
  '易错对比': 'Common mistakes',
  '语境与练习': 'Practice',
  '从哪儿来，一路上经历了什么': 'Where it came from',
  '同一个词根下的亲属': 'Relatives under one root',
  '它真正在说什么': 'What it actually says',
  '近义词之间的分界在哪里': 'Where synonyms part ways',
  '什么场合才用它': 'When to reach for it',
  '它习惯和谁一起出现': 'What it keeps company with',
  '最容易错在哪': 'Where learners slip',
  '放进真实对话里练': 'Try it in real dialogue',
  '记忆画面': 'Memory image',
  '底层画面': 'Underlying image',
  '共同词根': 'Shared root',
  '触发前提': 'Trigger',
  '内心状态': 'Inner state',
  '动作力度': 'Force of the act',
  '适用情境': 'Fits when',
  '语义韵': 'Semantic prosody',
  '言外之意': 'Under the surface',
  '常见中文译法': 'Common Chinese renderings',
  '中文多带了什么': 'What Chinese adds',
  '中文漏掉了什么': 'What Chinese drops',
  '中立': 'Neutral',
  '积极': 'Positive',
  '消极': 'Negative',
  '日常 · 口语': 'Everyday · spoken',
  '街头 · 俚语': 'Street · slang',
  '法律 · 学术': 'Legal · academic',
  '朋友闲聊': 'Friends',
  '职场社交': 'Work',
  '影视文化': 'Culture',
  '看看第 {level} 档': 'See level {level}',
  '此档暂无自然表达': 'Nothing natural at this level yet',
  '可拖动探索': 'Drag to explore',
  '正式度': 'Formality',
  '对比 {index}': 'Contrast {index}',
  '读懂这一句': 'Read the line',
  '放进句子里': 'Into a sentence',
  '随语境变化': 'Shifts with context',
  '同一现场': 'Same scene',
  '示例': 'Example',
  '词条': 'Entry',
  '重试当前维度': 'Retry this dimension',
  '继续生成': 'Continue',
  '这个维度尚未完成': 'This dimension is not finished',
  '这个维度生成未完成': 'This dimension stopped early',
  '等待前序维度完成': 'Waiting for the previous dimension',
  '完成前一个维度后，会继续生成这里的内容。': 'This fills in once the previous dimension is done.',
  '从这里继续生成，无需重做前面的维度。': 'Continue from here; earlier dimensions stay as they are.',
  '模型正在推理，准备词汇内容。': 'The model is thinking.',
  '正在接收模型输出，可以随时暂停。': 'Receiving output. You can pause any time.',
  '正在校正输出结构…': 'Correcting the structure…',
  '正在挖掘词源与同源关系…': 'Digging into roots and cognates…',
  '正在描绘独立概念坐标…': 'Mapping the concept…',
  '正在构建真实语境与练习…': 'Building context and practice…',
  '请求未完成，请重试当前维度。': 'The request did not finish. Retry this dimension.',
  '已接收 {count} 字': '{count} characters received',
  '正式度温度计': 'Formality thermometer',

  // Word desk
  '地道表达': 'Idioms & slang',
  '考研': 'Postgraduate',
  '雅思': 'IELTS',
  '托福': 'TOEFL',
  'GRE': 'GRE',
  'JLPT N1': 'JLPT N1',
  'JLPT N2': 'JLPT N2',
  'HSK 5': 'HSK 5',
  'HSK 6': 'HSK 6',
  '英语词单': 'English',
  '日语词单': 'Japanese',
  '中文词单': 'Chinese',
  '阅读里学不到的俚语、习语和职场行话': 'Slang, idioms and office shorthand reading never teaches',
  '硕士研究生入学考试大纲词汇，去掉四级及以下': 'Postgraduate entrance exam vocabulary, above the CET-4 band',
  '雅思常见词汇，去掉四级及以下': 'IELTS vocabulary, above the CET-4 band',
  '托福常见词汇，去掉四级及以下': 'TOEFL vocabulary, above the CET-4 band',
  'GRE 常见词汇，去掉四级及以下': 'GRE vocabulary, above the CET-4 band',
  '日本语能力测试 N1 词汇': 'JLPT N1 vocabulary',
  '日本语能力测试 N2 词汇': 'JLPT N2 vocabulary',
  'HSK 5 级词汇': 'HSK 5 vocabulary',
  'HSK 6 级词汇': 'HSK 6 vocabulary',
  '全部': 'All',
  '少见': 'Uncommon',
  '较难': 'Hard',
  '罕见': 'Rare',
  '只看未解剖': 'Unanalysed only',
  '已解剖': 'Analysed',
  '解剖': 'Analyse',
  '下一个未解剖': 'Next unanalysed',
  '搜索词单': 'Search the list',
  '搜索单词或中文释义': 'Search a word or meaning',
  '读取词单…': 'Loading lists…',
  '还有 {count} 个': '{count} more',
  '这一单已经全部解剖完了。': 'Every word in this list is analysed.',
  '没有符合条件的词。换个关键词，或去掉筛选。': 'No word matches. Try another term or clear the filters.',
  '词单索引读取失败，请重新构建前端后再试。': 'The list index could not be read.',
  '这个词单没能读取。换一个目标，或重新构建前端。': 'This list could not be read.',
  '词单来自': 'Lists from',
  '已去掉': ' removed ',
  '英语': 'English',
  '日语': 'Japanese',
  '中文': 'Chinese',
  '释义只作挑选参考，正式解析由模型按所选语言变体生成。': 'Glosses are for picking only; the analysis is written by the model in your chosen variety.',

  // Settings
  '连接你的语言模型': 'Connect your language model',
  'OpenAI 兼容接口': 'OpenAI-compatible endpoint',
  'API 根路径，例如 https://api.openai.com/v1': 'API base URL, e.g. https://api.openai.com/v1',
  '模型名称': 'Model',
  '拉取模型': 'Fetch models',
  '拉取中': 'Fetching',
  '使用服务商提供的完整模型 ID。': 'Use the full model ID your provider lists.',
  '记住在本机': 'Remember on this device',
  '设置保留到当前标签页会话结束。': 'Settings last for this tab only.',
  '设置将保存在此浏览器，供下次使用。': 'Settings are kept in this browser.',
  '测试连接': 'Test connection',
  '保存设置': 'Save settings',
  '凭证只留在这台设备的设置里，不会写进学习记录，也不会随导出文件离开。': 'Credentials stay in this device\u2019s settings; they never enter learning records or exports.',
  '连接成功，模型已经准备好了。': 'Connected. The model is ready.',
  'API 设置已保存。': 'Settings saved.',

  // Learning items
  '学习语言': 'Learning language',
  '讲解语言': 'Explanation language',
  '界面语言': 'Interface language',
  '语言：': 'Language',
  '语言与变体': 'Language and variety',
  '目标语言': 'Target language',
  '变体': 'Variety',
  '语言设置': 'Language settings',

  // Library and export
  '导出 Anki 卡片': 'Export Anki cards',
  'Anki 牌组名称': 'Anki deck name',
  '导出 Anki 牌组': 'Export deck',
  '下载 TSV': 'Download TSV',
  '完整 JSON': 'Full JSON',
  '导入 JSON': 'Import JSON',
  '查看背面': 'Show answer',
  '张卡片已选': 'cards selected',
  '删除': 'Delete',
  '删除这份记录？': 'Delete this record?',

  // Practice
  '造句练习': 'Sentence practice',
  '交给考官': 'Send to examiner',
  '再次提交批改': 'Submit again',
  '考官正在斟酌': 'The examiner is thinking',
  '看看参考回答': 'Show a reference answer',
  '收起参考': 'Hide reference',
  '更自然的说法': 'More natural version',
  '地道度': 'Idiomatic',
  '语域匹配': 'Register',
  '画面感': 'Imagery',
  '用 {target} 或相关语块回应': 'Reply with {target} or a related chunk',
  '听者脑中发生了什么？': 'What happens in the listener’s head?',
  '文化与习语': 'Culture and idiom',
  '义项演化': 'Sense development',
  '近义词对比': 'Synonym contrast',
  '对话场景': 'Dialogue scenes',
  '保留': 'Keep',
  '手动输入': 'Type a model ID',
  '从列表选择': 'Pick from the list',
  '请填写有效的 API 地址、密钥和模型名。': 'Enter a valid API URL, key and model name.',
  '请先填写有效的 API 地址和密钥。': 'Enter a valid API URL and key first.',
  '服务商返回的模型列表为空，可直接填写模型 ID。': 'The provider returned no models; type an ID instead.',
  '模型列表拉取失败，请重试。': 'Could not fetch the model list. Try again.',
  '连接未完成，请重试。': 'The connection test did not finish. Try again.',
  '设置未保存，请检查浏览器存储权限。': 'Settings were not saved. Check this browser’s storage permission.',
  '浏览器未允许保存 API 设置。': 'This browser blocked saving API settings.',
  '本地存储暂不可用，请允许此站点存储数据。': 'Local storage is unavailable; allow this site to store data.',
  '已从本机移除此学习记录。': 'Removed this record from this device.',
  '删除未完成，请重试。': 'Delete did not finish. Try again.',
  '解析已导入学习档案。': 'The analysis was imported into your archive.',
  '文件结构不符合 LexiGene JSON 格式。': 'This file is not a LexiGene JSON record.',
  '请选择小于 4 MB 的解析文件。': 'Choose a file under 4 MB.',
  'Anki 牌组已准备好，导入后就能复习。': 'The deck is ready; import it to start reviewing.',
  '导出未完成，请重试。': 'Export did not finish. Try again.',
  '批改未完成，请重试。': 'Grading did not finish. Try again.',
  '词汇提示已加载，本机保存未完成。': 'Hints loaded, but saving locally did not finish.',
  '还没找到这个词': 'Not found yet',
  '让第一个词，成为起点。': 'Start with your first word.',
  '试试另一个关键词。': 'Try another term.',
  '生成的解析会自动收进这里。': 'Finished analyses collect here.',
  '请填写有效的 API 地址、密钥和模型名。 ': 'Enter a valid API URL, key and model name.',
};

const dictionaries: Record<UiLocale, Record<string, string>> = { 'zh-CN': {}, en: english };

let current: UiLocale = 'zh-CN';
const listeners = new Set<() => void>();

export function getUiLocale(): UiLocale {
  return current;
}

export function setUiLocale(locale: UiLocale) {
  if (locale === current) return;
  current = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Translate a Chinese source string. `{name}` placeholders are replaced.
 * Unknown strings return unchanged, so a missed entry never renders empty.
 */
export function t(source: string, params?: Record<string, string | number>): string {
  const template = dictionaries[current][source] ?? source;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/** Subscribe a component to locale changes and read the active locale. */
export function useUiLocale(): { locale: UiLocale; setLocale: (locale: UiLocale) => void; t: typeof t } {
  const locale = useSyncExternalStore(subscribe, getUiLocale, getUiLocale);
  return { locale, setLocale: setUiLocale, t };
}

export const localeStorageKey = 'lexigene.ui.locale';

export function readStoredLocale(): UiLocale {
  try {
    const stored = localStorage.getItem(localeStorageKey);
    return stored === 'en' || stored === 'zh-CN' ? stored : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

export function storeLocale(locale: UiLocale) {
  try { localStorage.setItem(localeStorageKey, locale); } catch { /* private mode: keep it for this session */ }
}
