import { describe, expect, it } from 'vitest';
import { explainLabel, findLanguage, isRtl, languageLabel, scriptOf, tagOf, targetLanguages, explainLanguages } from '../src/lib/languages';

describe('target language catalogue', () => {
  it('offers a broad set of languages, each with at least one variety', () => {
    expect(targetLanguages.length).toBeGreaterThanOrEqual(35);
    for (const language of targetLanguages) {
      expect(language.varieties.length).toBeGreaterThan(0);
      expect(language.zh.trim()).not.toBe('');
      expect(language.native.trim()).not.toBe('');
    }
  });

  it('keeps ids unique so a saved preference always resolves', () => {
    const ids = targetLanguages.map(language => language.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('labels the pair the way the model receives it', () => {
    expect(languageLabel('ja', 'ja-JP')).toBe('日语（标准语（东京））');
    expect(languageLabel('en', 'en-GB')).toBe('英语（英式英语）');
    // An unknown variety falls back to the language's default instead of failing.
    expect(languageLabel('en', 'xx-XX')).toBe('英语（美式英语）');
  });

  it('reads back the labels written into older records', () => {
    expect(findLanguage('日语（标准语（东京））')?.id).toBe('ja');
    expect(findLanguage('美式英语')?.id).toBe('en');
    expect(findLanguage('简体中文')?.id).toBe('zh');
    expect(findLanguage('日本語')).toBeUndefined();
  });

  it('picks the script and direction typography follows', () => {
    expect(scriptOf('日语（标准语（东京））')).toBe('kana');
    expect(scriptOf('中文（简体中文（大陆））')).toBe('han');
    expect(scriptOf('韩语（韩国标准语）')).toBe('hangul');
    expect(scriptOf('阿拉伯语（埃及）')).toBe('arabic');
    expect(scriptOf('印地语（标准印地语）')).toBe('devanagari');
    expect(scriptOf('英语（美式英语）')).toBe('latin');
    expect(scriptOf('something unknown')).toBe('latin');
    expect(isRtl('阿拉伯语（埃及）')).toBe(true);
    expect(isRtl('希伯来语（标准希伯来语）')).toBe(true);
    expect(isRtl('英语（美式英语）')).toBe(false);
  });

  it('exposes a BCP 47 tag for lang attributes', () => {
    expect(tagOf('英语（英式英语）')).toBe('en-GB');
    expect(tagOf('日语（标准语（东京））')).toBe('ja-JP');
    expect(tagOf('未知语言')).toBe('en');
  });

  it('offers explanation languages with a readable fallback', () => {
    expect(explainLanguages.length).toBeGreaterThan(10);
    expect(explainLabel('en')).toBe('英语');
    expect(explainLabel('not-a-language')).toBe('简体中文');
  });
});
