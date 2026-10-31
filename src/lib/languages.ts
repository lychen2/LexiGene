/**
 * Target languages and their varieties.
 *
 * A learner picks what to study — a language and one of its varieties — and
 * the app adapts pronunciation, examples, usage labels and typography to it.
 * The variety is what the model is told to write in: en-GB spellings differ
 * from en-US, and Mexican Spanish differs from Spain's in vocabulary.
 *
 * Names are given twice: `zh` for the Chinese interface, `native` for the
 * language's own name. The label the model receives is always `zh(variant)`.
 */

export type Script =
  | 'latin'
  | 'cyrillic'
  | 'greek'
  | 'han'
  | 'kana'
  | 'hangul'
  | 'arabic'
  | 'hebrew'
  | 'devanagari'
  | 'thai'
  | 'bengali'
  | 'tamil'
  | 'telugu'
  | 'kannada'
  | 'malayalam';

export interface TargetLanguage {
  /** Stable id, also used to group word lists. */
  id: string;
  /** Name in the Chinese interface. */
  zh: string;
  /** Name in the language itself. */
  native: string;
  /** BCP 47 tag of the default variety. */
  tag: string;
  script: Script;
  dir: 'ltr' | 'rtl';
  /** Varieties the model can be told to write in; the first one is default. */
  varieties: { tag: string; zh: string; native?: string }[];
}

const v = (tag: string, zh: string, native?: string) => ({ tag, zh, native });

export const targetLanguages: TargetLanguage[] = [
  {
    id: 'en', zh: '英语', native: 'English', tag: 'en-US', script: 'latin', dir: 'ltr',
    varieties: [v('en-US', '美式英语'), v('en-GB', '英式英语'), v('en-AU', '澳大利亚英语'), v('en-CA', '加拿大英语'),
      v('en-NZ', '新西兰英语'), v('en-IE', '爱尔兰英语'), v('en-ZA', '南非英语'), v('en-IN', '印度英语'), v('en', '中性英语')],
  },
  {
    id: 'ja', zh: '日语', native: '日本語', tag: 'ja-JP', script: 'kana', dir: 'ltr',
    varieties: [v('ja-JP', '标准语（东京）'), v('ja-KS', '关西方言（仅用于口语说明）')],
  },
  {
    id: 'zh', zh: '中文', native: '中文', tag: 'zh-CN', script: 'han', dir: 'ltr',
    varieties: [v('zh-CN', '简体中文（大陆）'), v('zh-TW', '繁体中文（台湾）'), v('zh-HK', '繁体中文（香港）'), v('zh-SG', '简体中文（新加坡）')],
  },
  {
    id: 'ko', zh: '韩语', native: '한국어', tag: 'ko-KR', script: 'hangul', dir: 'ltr',
    varieties: [v('ko-KR', '韩国标准语'), v('ko-KP', '朝鲜标准语')],
  },
  {
    id: 'es', zh: '西班牙语', native: 'Español', tag: 'es-ES', script: 'latin', dir: 'ltr',
    varieties: [v('es-ES', '西班牙'), v('es-MX', '墨西哥'), v('es-AR', '阿根廷'), v('es-419', '拉丁美洲通用')],
  },
  {
    id: 'fr', zh: '法语', native: 'Français', tag: 'fr-FR', script: 'latin', dir: 'ltr',
    varieties: [v('fr-FR', '法国'), v('fr-CA', '魁北克'), v('fr-BE', '比利时'), v('fr-CH', '瑞士'), v('fr-CI', '西非')],
  },
  {
    id: 'de', zh: '德语', native: 'Deutsch', tag: 'de-DE', script: 'latin', dir: 'ltr',
    varieties: [v('de-DE', '德国'), v('de-AT', '奥地利'), v('de-CH', '瑞士')],
  },
  {
    id: 'pt', zh: '葡萄牙语', native: 'Português', tag: 'pt-BR', script: 'latin', dir: 'ltr',
    varieties: [v('pt-BR', '巴西'), v('pt-PT', '葡萄牙'), v('pt-AO', '安哥拉'), v('pt-MZ', '莫桑比克')],
  },
  { id: 'it', zh: '意大利语', native: 'Italiano', tag: 'it-IT', script: 'latin', dir: 'ltr', varieties: [v('it-IT', '标准意大利语'), v('it-CH', '瑞士意大利语')] },
  { id: 'ru', zh: '俄语', native: 'Русский', tag: 'ru-RU', script: 'cyrillic', dir: 'ltr', varieties: [v('ru-RU', '俄罗斯'), v('ru-KZ', '哈萨克斯坦')] },
  { id: 'uk', zh: '乌克兰语', native: 'Українська', tag: 'uk-UA', script: 'cyrillic', dir: 'ltr', varieties: [v('uk-UA', '标准乌克兰语')] },
  { id: 'ar', zh: '阿拉伯语', native: 'العربية', tag: 'ar', script: 'arabic', dir: 'rtl', varieties: [v('ar', '现代标准阿拉伯语'), v('ar-EG', '埃及'), v('ar-SA', '海湾'), v('ar-MA', '马格里布'), v('ar-SY', '黎凡特')] },
  { id: 'he', zh: '希伯来语', native: 'עברית', tag: 'he-IL', script: 'hebrew', dir: 'rtl', varieties: [v('he-IL', '标准希伯来语')] },
  { id: 'hi', zh: '印地语', native: 'हिन्दी', tag: 'hi-IN', script: 'devanagari', dir: 'ltr', varieties: [v('hi-IN', '标准印地语')] },
  { id: 'bn', zh: '孟加拉语', native: 'বাংলা', tag: 'bn-BD', script: 'bengali', dir: 'ltr', varieties: [v('bn-BD', '孟加拉国'), v('bn-IN', '西孟加拉')] },
  { id: 'ta', zh: '泰米尔语', native: 'தமிழ்', tag: 'ta-IN', script: 'tamil', dir: 'ltr', varieties: [v('ta-IN', '印度'), v('ta-LK', '斯里兰卡')] },
  { id: 'te', zh: '泰卢固语', native: 'తెలుగు', tag: 'te-IN', script: 'telugu', dir: 'ltr', varieties: [v('te-IN', '标准泰卢固语')] },
  { id: 'kn', zh: '卡纳达语', native: 'ಕನ್ನಡ', tag: 'kn-IN', script: 'kannada', dir: 'ltr', varieties: [v('kn-IN', '标准卡纳达语')] },
  { id: 'ml', zh: '马拉雅拉姆语', native: 'മലയാളം', tag: 'ml-IN', script: 'malayalam', dir: 'ltr', varieties: [v('ml-IN', '标准马拉雅拉姆语')] },
  { id: 'th', zh: '泰语', native: 'ไทย', tag: 'th-TH', script: 'thai', dir: 'ltr', varieties: [v('th-TH', '标准泰语')] },
  { id: 'vi', zh: '越南语', native: 'Tiếng Việt', tag: 'vi-VN', script: 'latin', dir: 'ltr', varieties: [v('vi-VN', '北部（河内）'), v('vi-CM', '南部（胡志明市）')] },
  { id: 'id', zh: '印尼语', native: 'Bahasa Indonesia', tag: 'id-ID', script: 'latin', dir: 'ltr', varieties: [v('id-ID', '标准印尼语')] },
  { id: 'ms', zh: '马来语', native: 'Bahasa Melayu', tag: 'ms-MY', script: 'latin', dir: 'ltr', varieties: [v('ms-MY', '马来西亚'), v('ms-BN', '文莱')] },
  { id: 'tl', zh: '菲律宾语', native: 'Filipino', tag: 'fil-PH', script: 'latin', dir: 'ltr', varieties: [v('fil-PH', '标准菲律宾语')] },
  { id: 'tr', zh: '土耳其语', native: 'Türkçe', tag: 'tr-TR', script: 'latin', dir: 'ltr', varieties: [v('tr-TR', '土耳其'), v('tr-CY', '塞浦路斯')] },
  { id: 'pl', zh: '波兰语', native: 'Polski', tag: 'pl-PL', script: 'latin', dir: 'ltr', varieties: [v('pl-PL', '标准波兰语')] },
  { id: 'cs', zh: '捷克语', native: 'Čeština', tag: 'cs-CZ', script: 'latin', dir: 'ltr', varieties: [v('cs-CZ', '标准捷克语')] },
  { id: 'ro', zh: '罗马尼亚语', native: 'Română', tag: 'ro-RO', script: 'latin', dir: 'ltr', varieties: [v('ro-RO', '罗马尼亚'), v('ro-MD', '摩尔多瓦')] },
  { id: 'nl', zh: '荷兰语', native: 'Nederlands', tag: 'nl-NL', script: 'latin', dir: 'ltr', varieties: [v('nl-NL', '荷兰'), v('nl-BE', '比利时弗拉芒')] },
  { id: 'sv', zh: '瑞典语', native: 'Svenska', tag: 'sv-SE', script: 'latin', dir: 'ltr', varieties: [v('sv-SE', '瑞典'), v('sv-FI', '芬兰瑞典语')] },
  { id: 'no', zh: '挪威语', native: 'Norsk', tag: 'nb-NO', script: 'latin', dir: 'ltr', varieties: [v('nb-NO', '书面挪威语'), v('nn-NO', '新挪威语')] },
  { id: 'da', zh: '丹麦语', native: 'Dansk', tag: 'da-DK', script: 'latin', dir: 'ltr', varieties: [v('da-DK', '标准丹麦语')] },
  { id: 'fi', zh: '芬兰语', native: 'Suomi', tag: 'fi-FI', script: 'latin', dir: 'ltr', varieties: [v('fi-FI', '标准芬兰语')] },
  { id: 'el', zh: '希腊语', native: 'Ελληνικά', tag: 'el-GR', script: 'greek', dir: 'ltr', varieties: [v('el-GR', '现代希腊语'), v('el-CY', '塞浦路斯希腊语')] },
  { id: 'hu', zh: '匈牙利语', native: 'Magyar', tag: 'hu-HU', script: 'latin', dir: 'ltr', varieties: [v('hu-HU', '标准匈牙利语')] },
  { id: 'sw', zh: '斯瓦希里语', native: 'Kiswahili', tag: 'sw-KE', script: 'latin', dir: 'ltr', varieties: [v('sw-KE', '肯尼亚'), v('sw-TZ', '坦桑尼亚')] },
  { id: 'af', zh: '南非荷兰语', native: 'Afrikaans', tag: 'af-ZA', script: 'latin', dir: 'ltr', varieties: [v('af-ZA', '标准南非荷兰语')] },
];

/** Explanation languages offered for teaching copy. */
export interface ExplainLanguage { id: string; zh: string; native: string; tag: string }

export const explainLanguages: ExplainLanguage[] = [
  { id: 'zh-CN', zh: '简体中文', native: '简体中文', tag: 'zh-CN' },
  { id: 'zh-TW', zh: '繁体中文', native: '繁體中文', tag: 'zh-TW' },
  { id: 'en', zh: '英语', native: 'English', tag: 'en-US' },
  { id: 'ja', zh: '日语', native: '日本語', tag: 'ja-JP' },
  { id: 'ko', zh: '韩语', native: '한국어', tag: 'ko-KR' },
  { id: 'es', zh: '西班牙语', native: 'Español', tag: 'es-ES' },
  { id: 'fr', zh: '法语', native: 'Français', tag: 'fr-FR' },
  { id: 'de', zh: '德语', native: 'Deutsch', tag: 'de-DE' },
  { id: 'pt', zh: '葡萄牙语', native: 'Português', tag: 'pt-BR' },
  { id: 'ru', zh: '俄语', native: 'Русский', tag: 'ru-RU' },
  { id: 'it', zh: '意大利语', native: 'Italiano', tag: 'it-IT' },
  { id: 'ar', zh: '阿拉伯语', native: 'العربية', tag: 'ar' },
  { id: 'hi', zh: '印地语', native: 'हिन्दी', tag: 'hi-IN' },
  { id: 'th', zh: '泰语', native: 'ไทย', tag: 'th-TH' },
  { id: 'vi', zh: '越南语', native: 'Tiếng Việt', tag: 'vi-VN' },
  { id: 'tr', zh: '土耳其语', native: 'Türkçe', tag: 'tr-TR' },
  { id: 'nl', zh: '荷兰语', native: 'Nederlands', tag: 'nl-NL' },
  { id: 'pl', zh: '波兰语', native: 'Polski', tag: 'pl-PL' },
  { id: 'id', zh: '印尼语', native: 'Bahasa Indonesia', tag: 'id-ID' },
];

export const defaultTarget = { language: 'en', variety: 'en-US' };
export const defaultExplain = 'zh-CN';

export function findLanguage(idOrLabel: string): TargetLanguage | undefined {
  const query = idOrLabel.trim().toLowerCase();
  if (!query) return undefined;
  const byId = targetLanguages.find(language => language.id === query);
  if (byId) return byId;
  // Saved records store the human label, so recognise those too.
  const label = idOrLabel.trim();
  return targetLanguages.find(language =>
    language.zh === label ||
    label.startsWith(language.zh) ||
    language.varieties.some(variety =>
      variety.zh === label ||
      variety.zh.startsWith(label) ||
      label.includes(variety.zh) ||
      `${language.zh}（${variety.zh}）` === label,
    ),
  );
}

/** The label the model receives, e.g. 「日语（标准语（东京））」. */
export function languageLabel(languageId: string, varietyTag: string): string {
  const language = findLanguage(languageId);
  if (!language) return languageId;
  const variety = language.varieties.find(item => item.tag === varietyTag) ?? language.varieties[0];
  return `${language.zh}（${variety.zh}）`;
}

export function explainLabel(id: string): string {
  return explainLanguages.find(language => language.id === id)?.zh ?? '简体中文';
}

/** Which script a saved or chosen label belongs to. Unknown labels are Latin. */
export function scriptOf(label: string): Script {
  return findLanguage(label)?.script ?? 'latin';
}

export function isRtl(label: string): boolean {
  return findLanguage(label)?.dir === 'rtl';
}

/** BCP 47 tag of the variety, used for `lang` attributes and typography. */
export function tagOf(label: string): string {
  const language = findLanguage(label);
  if (!language) return 'en';
  const variety = language.varieties.find(item => label.includes(item.zh));
  return variety?.tag ?? language.tag;
}
