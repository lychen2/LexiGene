import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { demo } from '../tests/fixtures/resent';

/**
 * Typography evidence. Each case measures its own property and saves a crop, so
 * the before and after states can be compared rather than eyeballed.
 * Run with TYPO_PHASE=before|after (default: after).
 */
const phase = process.env.TYPO_PHASE === 'before' ? 'before' : 'after';
const dir = `artifacts/typo-${phase}`;

test.beforeAll(async () => { await mkdir(dir, { recursive: true }); });

test('heading wrap, paragraph ending, changing numbers, truncated label, mixed paragraph', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  // 1. A heading that must wrap: line lengths should even out.
  const heading = page.locator('.page-intro h2');
  await heading.scrollIntoViewIfNeeded();
  await page.locator('.page-intro').screenshot({ path: `${dir}/1-heading.png` });
  console.log('HEADING ' + JSON.stringify(await heading.evaluate(node => {
    const style = getComputedStyle(node);
    const lineHeight = parseFloat(style.lineHeight);
    // Group the range's client rects by line, ignoring the zero-width boxes
    // that <wbr> introduces.
    const range = document.createRange();
    range.selectNodeContents(node);
    const lines = new Map<number, { min: number; max: number }>();
    for (const rect of [...range.getClientRects()]) {
      if (rect.width === 0) continue;
      const key = Math.round(rect.top);
      const line = lines.get(key) ?? { min: rect.left, max: rect.right };
      lines.set(key, { min: Math.min(line.min, rect.left), max: Math.max(line.max, rect.right) });
    }
    const widths = [...lines.values()].map(line => Math.round(line.max - line.min));
    return {
      lines: widths.length, widths, wbr: node.querySelectorAll('wbr').length,
      wrap: style.textWrap, keepAll: style.wordBreak, overflowWrap: style.overflowWrap,
    };
  })));

  // 2. A paragraph whose last line could hold one lonely word.
  const paragraph = page.locator('#module-1 .physical-image p').first();
  await paragraph.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await paragraph.screenshot({ path: `${dir}/2-paragraph.png` });
  console.log('PARAGRAPH ' + JSON.stringify(await paragraph.evaluate(node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()];
    const style = getComputedStyle(node);
    const lineHeight = parseFloat(style.lineHeight);
    const lines = Math.round(node.getBoundingClientRect().height / lineHeight);
    return { lines, widths: rects.map(rect => Math.round(rect.width)), wrap: style.textWrap, text: node.textContent?.slice(0, 24) };
  })));

  // 3. Numbers that change in place must not move.
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.goto('/');
  await page.locator('.workspace-link').nth(2).click();
  const desk = page.getByRole('dialog');
  await expect(desk.getByRole('tab', { name: /GRE/ })).toBeVisible();
  await desk.getByRole('tab', { name: /GRE/ }).click();
  await page.waitForTimeout(400);
  const counter = desk.locator('.desk-progress-head strong');
  await desk.locator('.desk-progress').screenshot({ path: `${dir}/3-numbers.png` });
  console.log('NUMBERS ' + JSON.stringify(await counter.evaluate(node => {
    const measure = (value: string) => { node.textContent = value; return Math.round(node.getBoundingClientRect().width * 100) / 100; };
    const sameLength = [measure('111'), measure('888')];
    const growing = [measure('1'), measure('11'), measure('111')];
    return { numeric: getComputedStyle(node).fontVariantNumeric, sameLength, growing };
  })));
  await page.keyboard.press('Escape');

  // 4. A label that has to truncate: a long target in the archive row.
  const long = { ...demo, id: 'long-target', target: 'counterproductive interdisciplinary misrepresentation', createdAt: new Date().toISOString() };
  const file = `${dir}/long-record.json`;
  await writeFile(file, JSON.stringify(long));
  await page.locator('.archive-trigger').click();
  await page.setInputFiles('input[type=file]', file);
  // The import closes the drawer and opens the record; reopen to see the row.
  await expect(page.locator('.toast')).toBeVisible({ timeout: 15000 });
  await page.locator('.archive-trigger').click();
  await expect(page.locator('.history-item').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(300);
  const row = page.locator('.history-open strong').first();
  await page.locator('.history-item').first().screenshot({ path: `${dir}/4-truncated-label.png` });
  console.log('TRUNCATION ' + JSON.stringify(await row.evaluate(node => {
    const style = getComputedStyle(node);
    return {
      client: Math.round(node.clientWidth), scroll: Math.round(node.scrollWidth),
      cut: node.scrollWidth > node.clientWidth + 1,
      overflow: style.overflow, nowrap: style.whiteSpace, ellipsis: style.textOverflow,
      title: node.closest('button')?.getAttribute('title') ?? null,
    };
  })));

  // 5. A mixed Chinese-English paragraph: justify, thin gaps, trimmed brackets.
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.locator('#module-1').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const story = page.locator('#module-1 .physical-image p').first();
  await story.screenshot({ path: `${dir}/5-mixed.png` });
  console.log('MIXED ' + JSON.stringify(await story.evaluate(node => {
    const style = getComputedStyle(node) as CSSStyleDeclaration & { textAutospace?: string; textSpacingTrim?: string };
    return { align: style.textAlign, autospace: style.textAutospace ?? null, trim: style.textSpacingTrim ?? null, lang: node.closest('[lang]')?.getAttribute('lang'), text: node.textContent?.slice(0, 30) };
  })));
});
