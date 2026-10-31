/** Vocabulary ribbons projected from two strands around the same cylinder. */
export const brandVocabulary = [
  'word', 'root', 'sense', 'voice', 'lexis', 'phrase', 'syntax', 'meaning',
  'idiom', 'sound', 'context', 'usage', 'verb', 'noun', 'morpheme', 'origin',
  'lexeme', 'tone', 'speech', 'semantic', 'cognate', 'language',
];

/**
 * Width of a word at a given size. Latin letters are narrow or wide depending
 * on the letter; Han, kana, Hangul, Arabic and Indic scripts are square, so a
 * single width per character keeps CJK ribbons from overlapping.
 * @param {string} word @param {number} size
 */
function estimateWidth(word, size) {
  return [...word].reduce((width, letter) => {
    if (/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(letter)) return width + 1;
    if (/[\u0600-\u06ff\u0590-\u05ff\u0900-\u0dff\u0e00-\u0e7f]/.test(letter)) return width + .62;
    return width + (/[iljtf'’.-]/.test(letter) ? .3 : /[mwMW]/.test(letter) ? .85 : .55);
  }, 0) * size;
}

/** @param {string[]} words @param {{compact?: boolean}} options */
export function buildWordHelix(words, { compact = false } = {}) {
  if (!words.length) return [];
  const turns = 1.32;
  const height = 390;
  const radius = compact ? 100 : 108;
  const lanes = compact ? [-.65, .65] : [-1.5, -.5, .5, 1.5];
  const laneWidth = compact ? 15 : 13;
  const samples = 600;
  const tokens = [];

  for (let strand = 0; strand < 2; strand++) {
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      const lane = lanes[laneIndex];
      const points = Array.from({ length: samples + 1 }, (_, index) => {
        const t = index / samples;
        const theta = t * Math.PI * 2 * turns - .7 + strand * Math.PI;
        const depth = Math.cos(theta);
        const dx = radius * Math.cos(theta) * Math.PI * 2 * turns;
        const dy = height;
        const length = Math.hypot(dx, dy);
        const thickness = laneWidth * (.78 + .22 * (depth + 1) / 2);
        return {
          x: 210 + radius * Math.sin(theta) - lane * thickness * dy / length,
          y: 34 + height * t + lane * thickness * dx / length,
          depth,
          distance: 0,
        };
      });
      for (let i = 1; i < points.length; i++) {
        points[i].distance = points[i - 1].distance + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      }
      let offset = 4 + laneIndex * 3;
      let wordIndex = strand * 9 + laneIndex * 7;
      let start = 0;
      while (offset < points[samples].distance - 18) {
        while (start < samples && points[start].distance < offset) start++;
        const depth = points[start].depth;
        const perspective = .8 + .2 * (depth + 1) / 2;
        const word = words[wordIndex % words.length];
        const base = compact ? [18, 15, 17, 15][wordIndex % 4] : [12, 10, 13, 11, 10, 12][wordIndex % 6];
        const size = base * perspective;
        const width = estimateWidth(word, size);
        let end = start;
        while (end < samples && points[end].distance < offset + width) end++;
        if (end === samples) break;
        const section = points.slice(start, end + 1);
        const middle = section[Math.floor(section.length / 2)];
        // Reverse leftward segments so every word stays upright on the curve.
        if (section[section.length - 1].x < section[0].x) section.reverse();
        tokens.push({
          word,
          size: Number(size.toFixed(2)),
          strand,
          depth: middle.depth,
          width: points[end].distance - points[start].distance,
          path: section.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '),
        });
        offset = points[end].distance + (compact ? 4 : 3.5);
        wordIndex++;
      }
    }
  }
  return tokens.sort((a, b) => a.depth - b.depth);
}

/** Foreground ribbon footprints hide rear words only at actual crossings. */
export function helixOcclusion(compact = false) {
  const paths = [];
  for (let strand = 0; strand < 2; strand++) {
    let current = '';
    for (let index = 0; index <= 600; index++) {
      const t = index / 600;
      const angle = t * Math.PI * 2 * 1.32 - .7 + strand * Math.PI;
      if (Math.cos(angle) > .72) {
        const x = 210 + (compact ? 100 : 108) * Math.sin(angle);
        const y = 30 + 390 * t;
        current += (current ? 'L' : 'M') + x.toFixed(2) + ',' + y.toFixed(2);
      } else if (current) { paths.push(current); current = ''; }
    }
    if (current) paths.push(current);
  }
  return paths;
}

/** @param {number} depth @param {number} strand @param {boolean} dark */
export function helixInk(depth, strand, dark = false) {
  const back = dark ? (strand ? [151, 122, 88] : [107, 142, 119]) : (strand ? [184, 143, 112] : [130, 151, 133]);
  const front = dark ? (strand ? [239, 187, 133] : [255, 254, 240]) : (strand ? [156, 78, 43] : [39, 77, 53]);
  const weight = (depth + 1) / 2;
  return `rgb(${front.map((value, index) => Math.round(back[index] + (value - back[index]) * weight)).join(',')})`;
}