import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import { render } from '../artifacts/prerender/entry-server.js';

const path = new URL('../dist/index.html', import.meta.url);
const template = await readFile(path, 'utf8');
if (!template.includes('<!--app-html-->')) throw new Error('Missing app HTML marker.');
await writeFile(path, template.replace('<!--app-html-->', () => render()));
await mkdir(new URL('../dist/licenses/', import.meta.url), { recursive: true });
await copyFile(new URL('../LICENSE', import.meta.url), new URL('../dist/licenses/MIT.txt', import.meta.url));
await copyFile(new URL('../public/fonts/ReadingFont-OFL.txt', import.meta.url), new URL('../dist/licenses/OFL.txt', import.meta.url));
// The word lists are fetched at runtime, so they ship beside the page rather
// than through the bundler: publicDir is off, and the fonts are bundled.
await cp(new URL('../public/wordlists/', import.meta.url), new URL('../dist/wordlists/', import.meta.url), { recursive: true });
