import { analysisSchema, type AnalysisDocument } from '@/lib/schema';
import { demo as english } from './resent';

/**
 * A Japanese analysis of 日本, used by browser tests that check furigana, pitch
 * accent, grammar notes and the script the hero and the helix are drawn in. The
 * shape is the same as the English fixture; only the language-specific parts
 * differ, so a schema change is caught here too.
 */
const base = structuredClone(english);

export const japanese: AnalysisDocument = analysisSchema.parse({
  ...base,
  id: 'nihon',
  target: '日本',
  language: '日语（标准语（东京））',
  explain: '简体中文',
  dimensions: {
    ...base.dimensions,
    one: {
      ...base.dimensions.one,
      overview: {
        pronunciation: 'にほん／にっぽん（Nihon / Nippon）',
        core: '太阳升起的地方。',
        definition:
          '日本的国名，读作「にほん」时语气中性、日常；读作「にっぽん」更郑重，常见于典礼、纸币与体育代表队的正式称呼。',
        partOfSpeech: '名詞・固有名詞',
        ruby: [
          { base: '日', ruby: 'に' },
          { base: '本', ruby: 'ほん' },
        ],
        pitch: '0 型（平板）：にほん￣，第一拍低、之后保持高，后续助词也停在髙位',
        grammar: '名词，无性数格变化；作定语时接「の」，如「日本の文化」',
      },
      bloodline: {
        ...base.dimensions.one.bloodline,
        family: '日系词族',
        root: '日',
        route: ['太陽', '日輪', '日本'],
        cognates: [
          { word: '日', meaning: '太阳、日子', connection: '同字同源，读法随語種变化' },
          { word: '日子', meaning: '汉语里的对应词', connection: '同源汉字词，但不是同一语言' },
        ],
      },
    },
    two: {
      ...base.dimensions.two,
      nuance: {
        ...base.dimensions.two.nuance,
        words: ['日本', 'にっぽん', 'ジャパン'].map((target, index) => ({
          ...base.dimensions.two.nuance.words[index],
          word: target,
        })),
      },
    },
    three: {
      ...base.dimensions.three,
      chunks: {
        ...base.dimensions.three.chunks,
        items: ['日本の文化', '日本国内', '日本製', '日本らしい'].map((target, index) => ({
          ...base.dimensions.three.chunks.items[index % base.dimensions.three.chunks.items.length],
          phrase: target,
        })),
        culture: [],
      },
    },
  },
});
