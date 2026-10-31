import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { demo } from '../tests/fixtures/resent';
import { demo as defaultDemo } from '../src/lib/demo';
import type { AnalysisDocument } from '../src/lib/schema';

let server: Server; let baseUrl: string;
let failTwo = false;
let hangThree = false;
let pauseThirdStream = false;
let releaseThirdStream: (() => void) | undefined;
const generationRequests: { stream: boolean; maxTokens: number }[] = [];
let modelsUnavailable = false;
let failHints = false;
const hintPrompts: string[] = [];
const vocabularyHints = [{ term: '部门', en: 'department' }, { term: '采购', en: 'procurement' }, { term: '招标', en: 'invite bids' }, { term: '门槛', en: 'threshold' }];
const modelRequests: { path?: string; authorization?: string }[] = [];
const probeModels: string[] = [];
const calls: string[] = [];
const grade = { scores: { naturalness: 8, register: 9, imagery: 8 }, feedback: '你的不满有了明确对象，语气也符合私下对话。', correction: { en: 'I resent being left out of the credit for my own work.', zh: '自己的工作成果被归给别人，我很不满。' }, changes: ['用 being left out 把受到的对待表达得更清楚。'], followUp: '如果对方是你的主管，你会怎样开场？', usesTarget: true };

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      modelRequests.push({ path: request.url, authorization: request.headers.authorization });
      response.writeHead(modelsUnavailable ? 404 : 200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(modelsUnavailable ? { error: 'upstream test-private-sentinel' } : { data: [{ id: 'test-model' }, { id: 'test-reasoner' }, { id: 'test-model' }] }));
      return;
    }
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); const content = body.messages.map((message: { content: string }) => message.content).join('\n');
    let data: unknown = 'OK';
    if (content.includes('"origin"')) { data = demo.dimensions.one; calls.push('one'); }
    else if (content.includes('"concept"')) { if (failTwo) { response.writeHead(429); response.end('{}'); return; } data = demo.dimensions.two; calls.push('two'); }
    else if (content.includes('"scores"')) { data = grade; calls.push('grade'); }
    else if (content.includes('"register"')) { calls.push('three'); if (hangThree) return; data = demo.dimensions.three; }
    else if (content.includes('"hints"')) {
      hintPrompts.push(content);
      if (failHints) { response.writeHead(429); response.end('{}'); return; }
      data = { hints: vocabularyHints };
    }
    else {
      calls.push('ping'); probeModels.push(body.model);
      if ((body.max_completion_tokens ?? body.max_tokens) <= 32) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: null, reasoning_content: 'Checking connectivity.' }, finish_reason: 'length' }] }));
        return;
      }
    }
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    if (body.stream) {
      generationRequests.push({ stream: body.stream, maxTokens: body.max_completion_tokens ?? body.max_tokens });
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (delta: object, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`);
      frame({ reasoning_content: 'hidden-stream-reasoning-sentinel' });
      const chars = Array.from(text);
      frame({ content: chars.slice(0, 256).join('') });
      if (pauseThirdStream && data === demo.dimensions.three) {
        await new Promise<void>(resolve => { releaseThirdStream = resolve; response.once('close', resolve); });
        if (response.destroyed) return;
      }
      for (let index = 256; index < chars.length; index += 512) frame({ content: chars.slice(index, index + 512).join('') });
      frame({}, 'stop'); response.end('data: [DONE]\n\n'); return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test provider');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
  await mkdir('artifacts', { recursive: true });
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
async function configure(page: Page) {
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByLabel('API Base URL').fill(baseUrl);
  await page.getByLabel('API Key', { exact: true }).fill('test-private-sentinel');
  await page.getByLabel('模型名称').fill('test-model');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText('连接成功，模型已经准备好了。')).toBeVisible();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
}

test('model discovery, selection, manual entry and unsupported provider recovery', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  modelRequests.length = 0; probeModels.length = 0;
  expect(await (await page.request.get('/api/health')).json()).toEqual({ runtime: 'go', desktop: 'mygo' });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '拉取模型', exact: true })).toBeDisabled();
  await page.getByLabel('API Base URL').fill(`${baseUrl}/chat/completions`);
  await page.getByLabel('API Key', { exact: true }).fill('test-private-sentinel');
  await page.getByLabel('模型名称').fill('');
  await page.getByRole('button', { name: '拉取模型', exact: true }).click();
  await expect(page.getByText('已获取 2 个模型，选择后即可测试连接。')).toBeVisible();
  expect(modelRequests).toEqual([{ path: '/v1/models', authorization: 'Bearer test-private-sentinel' }]);
  await page.getByLabel('模型名称').selectOption('test-reasoner');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText('连接成功，模型已经准备好了。')).toBeVisible();
  expect(probeModels).toEqual(['test-reasoner']);
  await page.getByRole('dialog').screenshot({ path: 'artifacts/settings-models.png' });
  await page.getByRole('button', { name: '手动输入', exact: true }).click();
  await expect(page.getByLabel('模型名称')).toHaveValue('test-reasoner');
  await page.getByLabel('模型名称').fill('custom-hidden-alias');
  await page.getByRole('button', { name: '从列表选择', exact: true }).click();
  await expect(page.getByLabel('模型名称')).toHaveValue('custom-hidden-alias');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(page.getByLabel('模型名称')).toHaveValue('custom-hidden-alias');
  modelsUnavailable = true;
  try {
    await page.getByRole('button', { name: '拉取模型', exact: true }).click();
    await expect(page.getByText(/模型列表接口不可用/)).toBeVisible();
    await expect(page.getByLabel('模型名称')).toHaveValue('custom-hidden-alias');
    await expect(page.locator('.model-field')).not.toContainText('test-private-sentinel');
    await page.getByLabel('API Base URL').fill('not-a-url');
    await page.getByRole('button', { name: '拉取模型', exact: true }).click();
    await expect(page.getByText('请先填写有效的 API 地址和密钥。')).toBeVisible();
  } finally { modelsUnavailable = false; }
  expect(errors).toEqual([]);
});

test('desktop visual modules, temperature, graph, dialogue and export', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1050 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: defaultDemo.target, exact: true })).toBeVisible();
  await expect(page.locator('section[id^="module-"]')).toHaveCount(8);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('#module-1')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'artifacts/desktop.png', fullPage: false });
  await page.locator('#module-2').getByRole('button', { name: /prognosis/ }).click();
  await expect(page.locator('.cognate-detail')).toContainText('prognosis');
  await expect(page.locator('#module-2')).toHaveCSS('opacity', '1');
  await page.locator('.module-grid').first().screenshot({ path: 'artifacts/dimension-one.png' });
  const slider = page.getByRole('slider', { name: '正式度温度计' }); await slider.scrollIntoViewIfNeeded();
  const range = await slider.boundingBox();
  if (!range) throw new Error('Thermometer is not visible');
  expect(range.height).toBeGreaterThanOrEqual(24);
  await page.mouse.click(range.x + range.width * 5 / 9, range.y + 2);
  await expect(slider).toHaveValue('6');
  await page.mouse.move(range.x + range.width * 4 / 9, range.y + range.height / 2);
  await page.mouse.down();
  await page.mouse.move(range.x + range.width * 2 / 3, range.y + range.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(slider).toHaveValue('7');
  await page.locator('#module-5').screenshot({ path: 'artifacts/thermometer.png' });
  await slider.focus(); await page.keyboard.press('ArrowRight'); await expect(slider).toHaveValue('8');
  await page.keyboard.press('Home'); await expect(slider).toHaveValue('1');
  await page.keyboard.press('End'); await expect(slider).toHaveValue('10');
  await page.getByRole('button', { name: '正式度 1', exact: true }).click(); await expect(page.getByText('此档暂无自然表达')).toBeVisible();
  await page.getByRole('tab', { name: '职场社交', exact: true }).click(); await expect(page.locator('.dialogue')).toContainText('Move the anagnorisis');
  await page.locator('.pitfall').first().locator('summary').click(); await expect(page.locator('.right-sentence').first()).toBeVisible();
  await page.getByRole('button', { name: '导出 Anki', exact: true }).click();
  await expect(page.locator('.export-card input:checked')).toHaveCount(9);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /导出 Anki 牌组/ }).click()]);
  expect(download.suggestedFilename()).toBe('anagnorisis.apkg'); await download.saveAs('artifacts/anagnorisis.apkg');
  expect(errors).toEqual([]);
});

test('real app routes: generation, local history, grade and restored attempt', async ({ page }) => {
  calls.length = 0; await page.goto('/'); await configure(page);
  await page.getByRole('textbox', { name: '目标单词或短语' }).fill('hold a grudge'); await page.getByRole('button', { name: '开始解剖', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'hold a grudge', exact: true })).toBeVisible();
  await expect(page.getByText('八个模块已就绪，开始探索吧。')).toBeVisible();
  expect(calls).toEqual(['ping', 'one', 'two', 'three']);
  await page.locator('#module-8').scrollIntoViewIfNeeded(); await expect(page.locator('.reference-answer')).toHaveCount(0);
  await page.getByLabel(/用 hold a grudge 或相关语块回应/).fill('I resent that he took credit for my work.');
  await page.getByRole('button', { name: '交给考官', exact: true }).click();
  await expect(page.locator('.grade-feedback')).toHaveText(grade.feedback);
  await page.reload(); await page.locator('.archive-trigger').click();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.locator('.history-open').click(); await expect(page.getByRole('heading', { name: 'hold a grudge', exact: true })).toBeVisible();
  await expect(page.locator('.grade-feedback')).toHaveText(grade.feedback);
  const exported = await page.evaluate(async () => { const request = indexedDB.open('lexigene'); const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); const tx = database.transaction(['analyses', 'drafts', 'attempts'], 'readonly'); const read = (name: string) => new Promise<unknown[]>(resolve => { const req = tx.objectStore(name).getAll(); req.onsuccess = () => resolve(req.result); }); const data = await Promise.all([read('analyses'), read('drafts'), read('attempts')]); database.close(); return data; });
  expect(exported[0]).toHaveLength(1); expect(exported[1]).toHaveLength(0); expect(exported[2]).toHaveLength(1); expect(JSON.stringify(exported)).not.toContain('test-private-sentinel');
  expect(calls.at(-1)).toBe('grade');
});

test('a new query sends its own target and no dimensions from the visible record', async ({ page }) => {
  await page.goto('/'); await configure(page);
  await expect(page.getByRole('heading', { name: defaultDemo.target, exact: true })).toBeVisible();
  let sentDraft: { target: string; dimensions: unknown; id: string } | undefined;
  await page.route('**/api/analyze', async route => {
    sentDraft = route.request().postDataJSON().draft;
    await route.fulfill({
      contentType: 'text/event-stream',
      body: 'data: {"type":"error","dimension":"one","message":"Local request capture complete."}\n\n',
    });
  });
  await page.getByRole('textbox', { name: '目标单词或短语' }).fill('dingleberry');
  await page.getByRole('button', { name: '开始解剖', exact: true }).click();
  await expect(page.locator('.generation-error')).toBeVisible();
  expect(sentDraft?.target).toBe('dingleberry');
  expect(sentDraft?.dimensions).toEqual({});
  expect(sentDraft?.id).not.toBe(defaultDemo.id);
});

test('failed dimension resumes without regenerating completed work', async ({ page }) => {
  calls.length = 0; failTwo = true;
  try { await page.goto('/'); await configure(page); await page.getByRole('textbox', { name: '目标单词或短语' }).fill('resent'); await page.getByRole('button', { name: '开始解剖', exact: true }).click(); await expect(page.locator('.generation-error')).toBeVisible(); expect(calls).toEqual(['ping', 'one']); failTwo = false; await page.getByRole('button', { name: /重试当前维度/ }).click(); await expect(page.getByText('八个模块已就绪，开始探索吧。')).toBeVisible(); expect(calls).toEqual(['ping', 'one', 'two', 'three']); }
  finally { failTwo = false; }
});

test('a stalled third dimension times out locally and resumes without losing earlier modules', async ({ page }) => {
  calls.length = 0; hangThree = true;
  try {
    await page.clock.install();
    await page.goto('/'); await configure(page);
    await page.getByRole('textbox', { name: '目标单词或短语' }).fill('timeout-test');
    await page.getByRole('button', { name: '开始解剖', exact: true }).click();
    await expect.poll(() => calls.at(-1)).toBe('three');
    await expect(page.locator('.generation-progress')).toContainText('用法与练习');
    await expect(page.locator('#module-4')).toBeAttached();
    await page.clock.fastForward(660_001);
    const failed = page.locator('#dimension-2 .loading-dimension[data-state="failed"]');
    await expect(failed).toContainText('等待超时');
    await expect(failed.locator('.loading-pulse')).toHaveCount(0);
    await expect(page.locator('section[id^="module-"]')).toHaveCount(4);
    await failed.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'artifacts/generation-timeout.png', fullPage: false });
    hangThree = false;
    await failed.getByRole('button', { name: '重试当前维度', exact: true }).click();
    await expect(page.getByText('八个模块已就绪，开始探索吧。')).toBeVisible();
    await expect(page.locator('section[id^="module-"]')).toHaveCount(8);
    expect(calls).toEqual(['ping', 'one', 'two', 'three', 'three']);
  } finally { hangThree = false; }
});

test('upstream streaming shows progress before completion and supports pause and missing-only resume', async ({ page }) => {
  calls.length = 0; generationRequests.length = 0; pauseThirdStream = true;
  try {
    await page.goto('/'); await configure(page);
    await page.getByRole('textbox', { name: '目标单词或短语' }).fill('stream-test');
    await page.getByRole('button', { name: '开始解剖', exact: true }).click();
    const current = page.locator('#dimension-2 .loading-dimension[data-state="running"]');
    await expect(current.locator('.stream-progress')).toContainText(/已接收 [\d,]+ 字/);
    await expect(page.locator('section[id^="module-"]')).toHaveCount(4);
    await expect(page.locator('body')).not.toContainText('hidden-stream-reasoning-sentinel');
    await current.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'artifacts/generation-stream.png', fullPage: false });
    await current.getByRole('button', { name: '暂停生成', exact: true }).click();
    await expect(page.locator('#dimension-2 .loading-dimension[data-state="paused"]')).toBeVisible();
    pauseThirdStream = false; releaseThirdStream?.();
    await page.getByRole('button', { name: '继续生成', exact: true }).click();
    await expect(page.getByText('八个模块已就绪，开始探索吧。')).toBeVisible();
    expect(calls).toEqual(['ping', 'one', 'two', 'three', 'three']);
    expect(generationRequests).toHaveLength(4);
    expect(generationRequests.every(request => request.stream && request.maxTokens === 32_768)).toBe(true);
  } finally { pauseThirdStream = false; releaseThirdStream?.(); releaseThirdStream = undefined; }
});

test('choosing a target language and explanation language reaches the model and the typography', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await configure(page);
  let sent: { target: string; language: string; explain?: string } | undefined;
  await page.route('**/api/analyze', async route => {
    sent = route.request().postDataJSON().draft;
    await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"error","dimension":"one","message":"Local capture complete."}\n\n' });
  });

  await page.getByRole('button', { name: '模型设置' }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('目标语言').selectOption('ja');
  await settings.getByLabel('变体').selectOption('ja-JP');
  await settings.getByLabel('讲解语言').selectOption('en');
  await page.keyboard.press('Escape');

  await expect(page.locator('.search-bar .language-select select')).toHaveValue('ja:ja-JP');
  await page.getByRole('textbox', { name: '目标单词或短语' }).fill('相変わらず');
  await page.getByRole('button', { name: '开始解剖', exact: true }).click();
  await expect.poll(() => sent?.language).toBe('日语（标准语（东京））');
  expect(sent?.explain).toBe('英语');

  // The sheet adopts the script of the language being studied.
  await page.evaluate(() => {
    const sheet = document.querySelector('.sheet-target') as HTMLElement;
    sheet.dataset.script = 'kana';
    sheet.setAttribute('lang', 'ja-JP');
  });
  const family = await page.locator('.word-hero h1').evaluate(node => getComputedStyle(node).fontFamily);
  expect(family).toContain('Noto Serif CJK JP');
  expect(await page.locator('.word-hero h1').evaluate(node => getComputedStyle(node).fontSize)).toBe('62px');
  await page.getByRole('dialog').count();

  // Arabic turns the sheet's own text right-to-left without flipping the layout.
  await page.evaluate(() => {
    const sheet = document.querySelector('.sheet-target') as HTMLElement;
    sheet.dataset.script = 'arabic';
    sheet.classList.add('is-rtl');
  });
  expect(await page.locator('.word-hero h1').evaluate(node => getComputedStyle(node).fontFamily)).toContain('Naskh');
});

test('the interface switches to English and the word desk follows the studied language', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await page.getByRole('button', { name: '模型设置' }).click();
  await page.getByRole('dialog').getByLabel('界面语言').selectOption('en');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: /Word desk/ })).toBeVisible();
  await expect(page.locator('.page-intro h2')).toHaveText('From root to usage, understand a word.');
  await expect(page.getByRole('button', { name: 'Analyse', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Word lists/ }).click();
  const desk = page.getByRole('dialog');
  await expect(desk.getByRole('tab', { name: /Japanese/ })).toBeVisible();
  await desk.getByRole('tab', { name: /Japanese/ }).click();
  await expect(desk.getByRole('tab', { name: /JLPT N1/ })).toHaveAttribute('aria-selected', 'true');
  await desk.getByLabel('Search the list').fill('あいそ');
  await expect(desk.getByText('愛想', { exact: true })).toBeVisible();
  await expect(desk.getByText('あいそ', { exact: true })).toBeVisible();
});

test('the word desk filters goal lists and starts an analysis for the chosen word', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await configure(page);
  await page.getByRole('button', { name: /目标词单/ }).click();
  const desk = page.getByRole('dialog');
  await expect(desk.getByRole('tab', { name: /地道表达/ })).toHaveAttribute('aria-selected', 'true');
  await expect(desk.getByRole('tab', { name: /GRE/ })).toBeVisible();

  await desk.getByRole('tab', { name: /GRE/ }).click();
  await expect(desk.getByText('GRE 常见词汇，去掉四级及以下')).toBeVisible();
  await expect(desk.getByRole('button', { name: /下一个未解剖/ })).toBeVisible();

  const search = desk.getByLabel('搜索词单');
  await search.fill('abstruse');
  await expect(desk.getByText('abstruse', { exact: true })).toBeVisible();
  await search.fill('不存在的一个词');
  await expect(desk.getByText('没有符合条件的词。换个关键词，或去掉筛选。')).toBeVisible();

  await search.fill('abstruse');
  await desk.getByText('abstruse', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: '目标单词或短语' })).toHaveValue('abstruse');
  await expect(page.getByRole('status').filter({ hasText: '正在完成' })).toBeVisible();
});

test('the word desk lists expressions that reading rarely teaches', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await page.getByRole('button', { name: /目标词单/ }).click();
  const desk = page.getByRole('dialog');
  await expect(desk.getByText('阅读里学不到的俚语、习语和职场行话')).toBeVisible();
  await desk.getByLabel('搜索词单').fill('说漏');
  await expect(desk.getByText('spill the beans', { exact: true })).toBeVisible();
  await expect(desk.getByText(/词单来自/)).toContainText('MIT');
});

test('mobile rendering, imported history, card selection persistence and deletion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { name: defaultDemo.target, exact: true })).toBeVisible();
  const titleLines = await page.getByRole('heading', { name: defaultDemo.target, exact: true }).evaluate(element => element.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(element).lineHeight));
  expect(titleLines).toBeLessThan(1.1);
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: false });
  await page.locator('#module-1').scrollIntoViewIfNeeded();
  await expect(page.locator('#module-1')).toHaveCSS('opacity', '1');
  await page.locator('#module-1').screenshot({ path: 'artifacts/mobile-module.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); expect(overflow).toBe(false);
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 JSON', exact: true }).click()]);
  expect(json.suggestedFilename()).toBe('anagnorisis.json');
  await json.saveAs('artifacts/anagnorisis.json');
  await page.locator('.archive-trigger').click();
  await page.locator('input[type=file]').setInputFiles('artifacts/anagnorisis.json');
  await expect(page.getByText('解析已导入学习档案。')).toBeVisible();
  await page.getByRole('button', { name: '导出 Anki', exact: true }).click();
  await expect(page.locator('.export-card').first()).toBeVisible();
  for (const checkbox of await page.locator('.export-card input').all()) await checkbox.uncheck();
  await expect(page.locator('.export-card input:checked')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '导出 Anki', exact: true }).click();
  await expect(page.locator('.export-card input:checked')).toHaveCount(0);
  await page.getByRole('button', { name: '情境造句', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 TSV', exact: true }).click()]); expect(download.suggestedFilename()).toBe('anagnorisis.tsv');
  await page.getByRole('button', { name: '关闭面板' }).click(); await page.getByRole('button', { name: '导出 Anki', exact: true }).click();
  await expect(page.locator('.export-card input:checked')).toHaveCount(2); await page.getByRole('button', { name: '关闭面板' }).click();
  await page.locator('.archive-trigger').click(); await page.getByRole('button', { name: '删除 anagnorisis', exact: true }).click(); await page.getByRole('button', { name: '删除', exact: true }).click(); await expect(page.locator('.history-item')).toHaveCount(0);
});

test('four synonym meters retain scores and fit desktop and mobile', async ({ page }) => {
  const record = structuredClone(demo);
  record.id = 'synonym-register-example'; record.target = 'circumvents';
  const words = [
    ['circumvents', 8, '沿墙绕行，找到规则的缺口。', '强调利用规则没有覆盖的路径达成目标。'],
    ['evade', 7, '躲开迎面而来的追问。', '侧重躲避责任、追问或难以应付的事。'],
    ['sidestep', 5, '侧身一步，让障碍从身边过去。', '强调用技巧避开直接处理一个问题。'],
    ['skirt', 6, '沿着问题的边缘走。', '接近话题，却没有触及关键。'],
  ] as const;
  record.dimensions.two.nuance = {
    sharedScene: '面对规则或限制，设法绕开。',
    words: words.map(([word, register, image, distinction]) => ({ word, register, image, distinction,
      example: { en: 'The company circumvents the hiring freeze by reclassifying full-time roles as contractors.', zh: '这家公司把全职岗位重新归类为合同工，从而绕过了招聘冻结。' },
    })),
  };
  await page.setViewportSize({ width: 1440, height: 1050 }); await page.goto('/');
  await page.locator('.archive-trigger').click();
  await page.locator('input[type=file]').setInputFiles({ name: 'synonyms.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(record)) });
  await expect(page.getByRole('heading', { name: 'circumvents', exact: true })).toBeVisible();
  const module = page.locator('#module-4'); await module.scrollIntoViewIfNeeded();
  await expect(module).toHaveCSS('opacity', '1'); await page.evaluate(() => document.fonts.ready);
  const tabs = module.getByRole('tab'); await expect(tabs).toHaveCount(4);
  for (let index = 0; index < words.length; index++) {
    await expect(tabs.nth(index).locator('.synonym-register-readout strong')).toHaveText(`${words[index][1]}/10`);
  }
  await tabs.nth(0).focus(); await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused(); await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(module.locator('.nuance-result')).toContainText('躲开迎面而来的追问。');
  await page.keyboard.press('Home'); await expect(tabs.nth(0)).toBeFocused();
  await module.screenshot({ path: 'artifacts/nuance-desktop.png' });
  await tabs.nth(2).click(); await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(module.locator('.nuance-result')).toContainText('侧身一步');
  await page.setViewportSize({ width: 390, height: 844 });
  await module.scrollIntoViewIfNeeded();
  const first = await tabs.nth(0).boundingBox(); const second = await tabs.nth(1).boundingBox(); const third = await tabs.nth(2).boundingBox();
  expect(first?.y).toBe(second?.y); expect(third!.y).toBeGreaterThan(first!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await module.screenshot({ path: 'artifacts/nuance-mobile.png' });
});

test('legacy quiz hints load, retry, persist and support hover, keyboard and touch', async ({ page, browser }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  hintPrompts.length = 0;
  const record = structuredClone(demo);
  record.id = 'quiz-vocabulary-legacy'; record.target = 'circumvents';
  const question = record.dimensions.three.slices.quiz[0];
  question.scenario = '你是一名合规分析师，要向管理层报告：某部门把一笔大额采购拆成四份小额订单，正好都低于需要公开招标的门槛，因此字面上没有违反任何规定。';
  question.challenge = '用 circumvents 写一句话，同时点出被绕开的门槛和政策本意，语气要冷静、专业，不做道德指控。';
  question.reference = { en: 'The department circumvents the bidding threshold by splitting purchases into smaller orders.', zh: '该部门通过把采购拆成小额订单，绕过了招标门槛。' };
  delete question.hints;
  await page.setViewportSize({ width: 1440, height: 1050 }); await page.goto('/'); await configure(page);
  await page.locator('.archive-trigger').click();
  await page.locator('input[type=file]').setInputFiles({ name: 'legacy-quiz.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(record)) });
  await expect(page.getByRole('heading', { name: 'circumvents', exact: true })).toBeVisible();
  expect(hintPrompts).toHaveLength(0);
  failHints = true;
  try {
    await page.locator('.sandbox').scrollIntoViewIfNeeded();
    await expect(page.getByText('词汇提示暂不可用')).toBeVisible();
    await page.getByLabel(/用 circumvents 或相关语块回应/).fill('The department circumvents the threshold.');
    expect(hintPrompts).toHaveLength(1);
    failHints = false;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    const purchase = page.locator('.quiz-scenario').getByRole('button', { name: '采购', exact: true });
    await expect(purchase).toBeVisible();
    expect(hintPrompts).toHaveLength(2);
    expect(hintPrompts[1]).not.toContain(question.reference.en);
    await expect(page.locator('.reference-answer')).toHaveCount(0);
    await expect(page.locator('.quiz-scenario > p')).toHaveText(question.scenario);
    await expect(page.locator('.quiz-scenario > strong')).toHaveText(question.challenge);
    await purchase.hover(); await expect(page.getByRole('tooltip')).toHaveText('procurement');
    await page.locator('.sandbox-header h4').hover(); await expect(page.getByRole('tooltip')).toHaveCount(0);
    await purchase.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    await expect(purchase).toBeFocused(); await expect(page.getByRole('tooltip')).toHaveText('procurement');
    await expect(purchase).toHaveAccessibleDescription('procurement');
    await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Enter'); await expect(page.getByRole('tooltip')).toHaveText('procurement');
    await page.keyboard.press('Space'); await expect(page.getByRole('tooltip')).toHaveCount(0);
    await purchase.hover(); await expect(page.getByRole('tooltip')).toHaveCSS('opacity', '1');
    await page.locator('.sandbox').screenshot({ path: 'artifacts/writing-hints-desktop.png' });
    await page.getByRole('button', { name: '情境 2', exact: true }).click();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.getByRole('button', { name: '情境 1', exact: true }).click();
    await expect(purchase).toBeVisible(); expect(hintPrompts).toHaveLength(2);
    await expect.poll(() => page.evaluate(async id => {
      const request = indexedDB.open('lexigene');
      const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
      const read = db.transaction('analyses').objectStore('analyses').get(id);
      const saved = await new Promise<AnalysisDocument | undefined>(resolve => { read.onsuccess = () => resolve(read.result); });
      db.close(); return saved?.dimensions.three.slices.quiz[0].hints;
    }, record.id)).toEqual(vocabularyHints);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 JSON', exact: true }).click()]);
    await download.saveAs('artifacts/quiz-hints.json');
    const exported = JSON.parse(await readFile('artifacts/quiz-hints.json', 'utf8'));
    expect(exported.dimensions.three.slices.quiz[0].hints).toEqual(vocabularyHints);
    expect(JSON.stringify(exported)).not.toContain('test-private-sentinel');
    await page.reload(); await page.locator('.archive-trigger').click();
    await page.locator('.history-open').filter({ hasText: 'circumvents' }).click();
    await page.locator('.sandbox').scrollIntoViewIfNeeded();
    await expect(purchase).toBeVisible(); expect(hintPrompts).toHaveLength(2);
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    try {
      const mobile = await context.newPage(); mobile.on('pageerror', error => errors.push(error.message));
      await mobile.goto('/');
      await mobile.locator('.archive-trigger').click();
      await mobile.locator('input[type=file]').setInputFiles({ name: 'quiz-with-hints.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
      await expect(mobile.getByRole('heading', { name: 'circumvents', exact: true })).toBeVisible();
      await mobile.locator('.sandbox').scrollIntoViewIfNeeded();
      const term = mobile.locator('.quiz-scenario').getByRole('button', { name: '门槛', exact: true }).last();
      await term.tap(); await expect(mobile.getByRole('tooltip')).toHaveText('threshold');
      const tooltip = await mobile.getByRole('tooltip').boundingBox();
      expect(tooltip!.x).toBeGreaterThanOrEqual(0); expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(390);
      expect(tooltip!.y).toBeGreaterThanOrEqual(0); expect(tooltip!.y + tooltip!.height).toBeLessThanOrEqual(844);
      await mobile.screenshot({ path: 'artifacts/writing-hints-mobile.png' });
      await term.tap(); await expect(mobile.getByRole('tooltip')).toHaveCount(0);
      await term.tap(); await expect(mobile.getByRole('tooltip')).toHaveText('threshold');
      await mobile.locator('.sandbox-header h4').tap(); await expect(mobile.getByRole('tooltip')).toHaveCount(0);
      expect(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await mobile.getByRole('button', { name: '打开目录', exact: true }).click();
      await expect(mobile.getByRole('dialog', { name: '词汇目录' })).toBeVisible();
      await mobile.keyboard.press('Tab');
      expect(await mobile.evaluate(() => Boolean(document.activeElement?.closest('#mobile-directory')))).toBe(true);
      await mobile.keyboard.press('Escape'); await expect(mobile.getByRole('dialog')).toHaveCount(0);
      await expect(mobile.getByRole('button', { name: '打开目录', exact: true })).toBeFocused();
      await mobile.keyboard.press('Control+k');
      await expect(mobile.getByRole('textbox', { name: '目标单词或短语' })).toBeFocused();
      await expect(mobile.locator('.search-bar .primary-button > span')).toBeVisible();
      expect((await mobile.locator('.search-bar .primary-button').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    } finally { await context.close(); }
  } finally { failHints = false; }
  expect(errors).toEqual([]);
});
