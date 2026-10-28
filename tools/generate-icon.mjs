import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';

const svg = await readFile(new URL('../src/app/icon.svg', import.meta.url), 'utf8');
await mkdir(new URL('../resources/', import.meta.url), { recursive: true });
await mkdir(new URL('../android/res/drawable/', import.meta.url), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>' + svg);
  await page.screenshot({ path: new URL('../resources/icon.png', import.meta.url).pathname, omitBackground: true });
  await page.setViewportSize({ width: 192, height: 192 });
  await page.addStyleTag({ content: 'svg{width:192px;height:192px}' });
  await page.screenshot({ path: new URL('../android/res/drawable/ic_launcher.png', import.meta.url).pathname, omitBackground: true });
} finally { await browser.close(); }
