import { writeFile } from 'node:fs/promises';
import { brandVocabulary, buildWordHelix, helixInk, helixOcclusion } from '../src/lib/word-helix-layout.mjs';

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const tokens = buildWordHelix(brandVocabulary, { compact: true });
const paths = tokens.map((token, index) => '<path id="word-' + index + '" d="' + token.path + '"/>').join('');
const words = tokens.map((token, index) => '<text mask="' + (token.depth < 0 ? 'url(#depth)' : 'none') + '" font-size="' + token.size + '" fill="' + helixInk(token.depth, token.strand, true) + '" stroke="' + (token.depth > 0 ? '#293e32' : 'none') + '" stroke-width="1.2" paint-order="stroke"><textPath href="#word-' + index + '" textLength="' + token.width.toFixed(2) + '" lengthAdjust="spacingAndGlyphs">' + escape(token.word) + '</textPath></text>').join('');
const mask = '<mask id="depth" maskUnits="userSpaceOnUse" x="0" y="0" width="420" height="464"><rect width="420" height="464" fill="white"/>' + helixOcclusion(true).map(d => '<path d="' + d + '" fill="none" stroke="black" stroke-width="42" stroke-linecap="round"/>').join('') + '</mask>';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480" fill="none"><title>LexiGene vocabulary double helix</title><rect width="480" height="480" rx="108" fill="#293e32"/><rect x="1" y="1" width="478" height="478" rx="107" stroke="#fffefa" stroke-opacity=".12" stroke-width="2"/><defs>' + paths + mask + '</defs><g transform="translate(30 10)" font-family="Georgia,serif" font-weight="600">' + words + '</g></svg>\n';
await writeFile(new URL('../src/app/icon.svg', import.meta.url), svg);
console.log('Generated word-cloud logo with ' + tokens.length + ' curved words.');
