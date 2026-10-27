import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as hintsPOST } from '@/app/api/quiz-hints/route';
import { hintActivationAction, splitHintSegments } from '@/components/quiz-scenario';
import { demo } from './fixtures/resent';
import { buildDimensionMessages, buildHintMessages } from '@/lib/prompts';
import {
  analysisSchema,
  quizQuestionSchema,
  vocabularyHintSchema,
  type AnalysisDraft,
  type QuizQuestion,
  type VocabularyHint,
} from '@/lib/schema';

const API_KEY = '{{SECRET_hintsk}}';
const CONFIG = { baseUrl: 'https://api.example.com/v1', apiKey: API_KEY, model: 'gpt-4o-mini' };

const reference = {
  en: 'REFERENCE_ANSWER_SHOULD_NOT_LEAK',
  zh: '参考答案不应出现在提示请求里',
};

const question: QuizQuestion = {
  id: 'scenario-1',
  scenario: '某部门把一笔大额采购拆成四份小额订单，正好都低于需要公开招标的门槛。',
  challenge: '扮演合规分析师，向管理层报告这一做法，并点出被绕开的门槛。',
  focus: '用目标词说明规则被绕开的方式。',
  reference,
};

const legacyQuestion = {
  id: 'q1',
  scenario: '你在整理旧物时突然想起童年。',
  challenge: '用 nostalgia 描述这一刻的感受。',
  focus: '名词搭配与情绪层次',
  reference: { en: 'A wave of nostalgia washed over me.', zh: '一阵怀念涌上心头。' },
};

const draft: AnalysisDraft = {
  schemaVersion: 1,
  id: 'draft-1',
  createdAt: '2026-10-27T00:00:00.000Z',
  target: 'loophole',
  language: '美式英语',
  dimensions: {},
};

const completion = (content: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    body: { cancel: async () => undefined },
  }) as unknown as Response;

const textCompletion = (content: string): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    body: { cancel: async () => undefined },
  }) as unknown as Response;

const failure = (status: number, raw: string): { response: Response; cancel: ReturnType<typeof vi.fn> } => {
  const cancel = vi.fn(async () => undefined);
  return {
    cancel,
    response: {
      ok: false,
      status,
      body: { cancel },
      json: async () => JSON.parse(raw),
      text: async () => raw,
    } as unknown as Response,
  };
};

function stubFetch(responses: Response[]) {
  const mock = vi.fn();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/quiz-hints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function requestBody(mock: ReturnType<typeof stubFetch>, index = 0) {
  return JSON.parse(mock.mock.calls[index][1].body as string) as {
    model: string;
    messages: Array<{ role: string; content: string }>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('vocabulary hint schema', () => {
  it('keeps old quiz records without hints valid', () => {
    const parsed = quizQuestionSchema.parse(legacyQuestion);
    expect(parsed.hints).toBeUndefined();
    expect(quizQuestionSchema.safeParse({ ...legacyQuestion, hints: undefined }).success).toBe(true);

    const legacyDoc = structuredClone(demo);
    for (const quiz of legacyDoc.dimensions.three!.slices.quiz) delete quiz.hints;
    const parsedDoc = analysisSchema.parse(legacyDoc);
    expect(parsedDoc.dimensions.three!.slices.quiz.every(item => item.hints === undefined)).toBe(true);
  });

  it('accepts the shared {term,en} contract and rejects malformed hints', () => {
    const valid = { ...legacyQuestion, hints: [{ term: '童年', en: 'childhood' }] };
    expect(quizQuestionSchema.safeParse(valid).success).toBe(true);
    expect(vocabularyHintSchema.parse({ term: '部门', en: 'department/section' })).toEqual({
      term: '部门',
      en: 'department/section',
    });

    expect(quizQuestionSchema.safeParse({ ...legacyQuestion, hints: [{ term: '', en: 'x' }] }).success).toBe(false);
    expect(quizQuestionSchema.safeParse({ ...legacyQuestion, hints: [{ term: '童年' }] }).success).toBe(false);
    expect(quizQuestionSchema.safeParse({ ...legacyQuestion, hints: '童年' }).success).toBe(false);
    expect(quizQuestionSchema.safeParse({ ...legacyQuestion, hints: [null] }).success).toBe(false);
  });

  it('ships truthful demo hints that occur in the demo text and avoid the target word', () => {
    const quizzes = demo.dimensions.three!.slices.quiz;
    const target = demo.target;

    for (const quiz of quizzes) {
      expect(quiz.hints).toBeDefined();
      expect(quiz.hints!.length).toBeGreaterThanOrEqual(4);
      expect(quiz.hints!.length).toBeLessThanOrEqual(8);
      const corpus = `${quiz.scenario}\n${quiz.challenge}`;
      const terms = new Set<string>();
      for (const hint of quiz.hints!) {
        expect(hint.term.trim().length).toBeGreaterThan(0);
        expect(hint.en.trim().length).toBeGreaterThan(0);
        expect(corpus).toContain(hint.term);
        expect(hint.term.toLowerCase()).not.toBe(target.toLowerCase());
        expect(terms.has(hint.term)).toBe(false);
        terms.add(hint.term);
      }
    }
  });
});

describe('quiz hints route', () => {
  it('filters duplicates, unmatched terms and the target word, and never forwards the reference', async () => {
    const generated = {
      hints: [
        { term: '部门', en: 'department/section' },
        { term: '部门', en: 'department' },
        { term: '采购', en: 'procurement/purchase' },
        { term: '招标', en: 'invite bids' },
        { term: '门槛', en: 'threshold' },
        { term: '不存在的词', en: 'missing' },
        { term: '合规分析师', en: 'compliance analyst' },
        { term: '管理层', en: 'management' },
        { term: '订单', en: 'order' },
        { term: '门槛', en: 'threshold again' },
        { term: 'loophole', en: 'loophole' },
      ],
    };
    const mock = stubFetch([completion(generated)]);

    const response = await hintsPOST(post({ config: CONFIG, target: 'loophole', language: '美式英语', question }));
    expect(response.status).toBe(200);

    const text = await response.text();
    const payload = JSON.parse(text) as { hints: VocabularyHint[] };
    expect(payload.hints).toEqual([
      { term: '部门', en: 'department/section' },
      { term: '采购', en: 'procurement/purchase' },
      { term: '招标', en: 'invite bids' },
      { term: '门槛', en: 'threshold' },
      { term: '合规分析师', en: 'compliance analyst' },
      { term: '管理层', en: 'management' },
      { term: '订单', en: 'order' },
    ]);

    // No reference answer, key or upstream credential can reach the browser.
    expect(text).not.toContain(reference.en);
    expect(text).not.toContain(reference.zh);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain('threshold again');
    expect(text).not.toContain('不存在的词');
    expect(text).not.toContain('loophole');

    const body = requestBody(mock);
    const prompt = body.messages.map(message => message.content).join('\n');
    expect(prompt).toContain(question.scenario);
    expect(prompt).toContain(question.challenge);
    expect(prompt).toContain('loophole');
    expect(prompt).toContain('4–8');
    expect(prompt).toContain('精确子串');
    expect(prompt).toContain('不要标注正在练习的目标词');
    expect(prompt).not.toContain(reference.en);
    expect(prompt).not.toContain(reference.zh);
    expect(prompt).not.toContain(API_KEY);
    expect(mock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('repairs one malformed model response through the shared callJson machinery', async () => {
    const mock = stubFetch([
      textCompletion('Sure! Here are the hints you asked for.'),
      completion({ hints: [{ term: '采购', en: 'procurement/purchase' }] }),
    ]);

    const response = await hintsPOST(post({ config: CONFIG, target: 'loophole', language: '美式英语', question }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hints: [{ term: '采购', en: 'procurement/purchase' }] });
    expect(mock).toHaveBeenCalledTimes(2);
    const repairPrompt = requestBody(mock, 1).messages.map(message => message.content).join('\n');
    expect(repairPrompt).toContain('不是合法的 JSON 对象');
  });

  it('sanitizes provider auth failures without leaking the key or upstream body', async () => {
    const { response: upstream, cancel } = failure(401, JSON.stringify({ error: `bad key ${API_KEY}` }));
    stubFetch([upstream]);

    const response = await hintsPOST(post({ config: CONFIG, target: 'loophole', language: '美式英语', question }));
    expect(response.status).toBe(502);
    const text = await response.text();

    expect(cancel).toHaveBeenCalled();
    expect(text).toContain('API Key 无效或没有访问权限');
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain('bad key');
    expect(text).not.toContain(reference.en);
  });

  it('stays sanitized when the model keeps returning malformed output', async () => {
    const mock = stubFetch([textCompletion('not json'), textCompletion('still not json')]);

    const response = await hintsPOST(post({ config: CONFIG, target: 'loophole', language: '美式英语', question }));
    expect(response.status).toBe(502);
    const text = await response.text();

    expect(mock).toHaveBeenCalledTimes(2);
    expect(text).toContain('模型返回的内容格式不正确，请重试。');
    expect(text).not.toContain('not json');
    expect(text).not.toContain(API_KEY);
  });

  it('rejects malformed input before touching the model', async () => {
    const mock = stubFetch([]);

    const missingScenario = await hintsPOST(
      post({ config: CONFIG, target: 'loophole', language: '美式英语', question: { id: 'q', challenge: question.challenge } }),
    );
    expect(missingScenario.status).toBe(400);

    const missingConfig = await hintsPOST(post({ target: 'loophole', language: '美式英语', question }));
    expect(missingConfig.status).toBe(400);

    const badUrl = await hintsPOST(
      post({ config: { ...CONFIG, baseUrl: 'ftp://example.com' }, target: 'loophole', language: '美式英语', question }),
    );
    expect(badUrl.status).toBe(400);

    const invalidJson = await hintsPOST(post('not-json'));
    expect(invalidJson.status).toBe(400);

    expect(mock).not.toHaveBeenCalled();
  });

  it('returns an empty list when no generated term matches the scenario text', async () => {
    stubFetch([completion({ hints: [{ term: '不相关', en: 'unrelated' }] })]);

    const response = await hintsPOST(post({ config: CONFIG, target: 'loophole', language: '美式英语', question }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hints: [] });
  });
});

describe('hint filtering through the route', () => {
  it('keeps the first occurrence and trims generated terms', async () => {
    const hints = [
      { term: ' 采购 ', en: ' procurement/purchase ' },
      { term: '采购', en: 'purchase' },
      { term: '门槛', en: 'threshold' },
    ];
    stubFetch([completion({ hints })]);

    const response = await hintsPOST(post({ config: CONFIG, target: 'loophole', language: '美式英语', question }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hints: [
        { term: '采购', en: 'procurement/purchase' },
        { term: '门槛', en: 'threshold' },
      ],
    });
  });

  it('caps generated hints at eight entries', async () => {
    const terms = ['部门', '采购', '订单', '合规分析师', '管理层', '门槛', '做法', '绕开', '公开招标', '报告'];
    stubFetch([completion({ hints: terms.map(term => ({ term, en: `gloss of ${term}` })) })]);

    const response = await hintsPOST(post({ config: CONFIG, target: 'loophole', language: '美式英语', question }));
    const payload = (await response.json()) as { hints: VocabularyHint[] };

    expect(payload.hints.map(hint => hint.term)).toEqual(terms.slice(0, 8));
  });
});

describe('keyboard and touch activation', () => {
  it('toggles on keyboard activation, even after an earlier pointer interaction', () => {
    expect(hintActivationAction(0, '')).toBe('toggle');
    expect(hintActivationAction(0, 'mouse')).toBe('toggle');
  });

  it('keeps toggling on repeated touch taps', () => {
    expect(hintActivationAction(1, 'touch')).toBe('toggle');
    expect(hintActivationAction(1, 'touch')).toBe('toggle');
  });

  it('leaves plain mouse clicks to hover and focus handling', () => {
    expect(hintActivationAction(1, 'mouse')).toBe('ignore');
    expect(hintActivationAction(2, 'pen')).toBe('ignore');
  });
});

describe('inline hint segmentation', () => {
  const texts = (segments: ReturnType<typeof splitHintSegments>) => segments.map(segment => segment.text).join('');
  const hinted = (segments: ReturnType<typeof splitHintSegments>) =>
    segments.filter(segment => segment.hint).map(segment => segment.text);

  it('preserves the complete original text and punctuation', () => {
    const quiz = demo.dimensions.three!.slices.quiz[0];
    const scenario = splitHintSegments(quiz.scenario, quiz.hints!);
    const challenge = splitHintSegments(quiz.challenge, quiz.hints!);

    expect(texts(scenario)).toBe(quiz.scenario);
    expect(texts(challenge)).toBe(quiz.challenge);
    expect(hinted(scenario)).toEqual(expect.arrayContaining(['同事', '全员会', '方案', '散会后']));
    expect(hinted(challenge)).toEqual(expect.arrayContaining(['造一句', '哪一层', '解释']));
  });

  it('gives the longest term priority for overlapping matches', () => {
    const text = '审批需要公开招标的门槛，而不仅是一次招标。';
    const segments = splitHintSegments(text, [
      { term: '招标', en: 'invite bids' },
      { term: '公开招标', en: 'public tender' },
    ]);

    expect(texts(segments)).toBe(text);
    expect(hinted(segments)).toEqual(['公开招标', '招标']);
  });

  it('annotates every repeated occurrence exactly once', () => {
    const text = '采购之后又采购';
    const segments = splitHintSegments(text, [{ term: '采购', en: 'procurement/purchase' }]);

    expect(texts(segments)).toBe(text);
    expect(hinted(segments)).toEqual(['采购', '采购']);
  });

  it('ignores terms that are absent and never interprets markup', () => {
    const text = '<b>部门</b>与"采购"';
    const segments = splitHintSegments(text, [
      { term: '部门', en: 'department/section' },
      { term: '<script>', en: 'script' },
    ]);

    expect(texts(segments)).toBe(text);
    expect(hinted(segments)).toEqual(['部门']);
    expect(segments.every(segment => !segment.text.includes('<script>'))).toBe(true);
  });

  it('ignores empty terms and duplicate terms in the hint list', () => {
    const segments = splitHintSegments('门槛', [
      { term: ' ', en: 'space' },
      { term: '门槛', en: 'threshold' },
      { term: '门槛', en: 'threshold duplicate' },
    ]);

    expect(hinted(segments)).toEqual(['门槛']);
    expect(segments[0]?.hint?.en).toBe('threshold');
  });
});

describe('hint prompts', () => {
  it('asks generation for 4–8 exact contextual terms without translating the target', () => {
    const user = buildDimensionMessages({ draft, dimension: 'three', completed: {} })[1].content;

    expect(user).toContain('slices.quiz[].hints');
    expect(user).toContain('4–8');
    expect(user).toContain('精确子串');
    expect(user).toContain('不要标注正在练习的目标词');
    expect(user).toContain('不泄露参考答案');
  });

  it('sends only the scenario and challenge to the hint request', () => {
    const messages = buildHintMessages({
      target: 'loophole',
      language: '美式英语',
      question: { id: question.id, scenario: question.scenario, challenge: question.challenge },
    });
    const prompt = messages.map(message => message.content).join('\n');

    expect(prompt).toContain(question.scenario);
    expect(prompt).toContain(question.challenge);
    expect(prompt).toContain('loophole');
    expect(prompt).toContain('精确子串');
    expect(prompt).not.toContain(reference.en);
    expect(prompt).not.toContain(reference.zh);
  });
});
