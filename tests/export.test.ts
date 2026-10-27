import { inflateRawSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { buildCards, cardsToTsv, escapeHtml, textToHtml } from '@/lib/cards';
import { analysisSchema, type AnalysisDocument, type StudyCard } from '@/lib/schema';
import { db, loadSelections } from '@/lib/storage';
import { POST } from '@/app/api/export/anki/route';

const API_KEY_SENTINEL = 'sk-live-THIS-MUST-NOT-LEAK-1234567890';

const example = (en: string, zh: string) => ({ en, zh });

function fixture(): AnalysisDocument {
  const levels = Array.from({ length: 10 }, (_, index) => ({
    level: index + 1,
    label: `Register level ${index + 1}`,
    candidates: [],
  }));

  const dialogueLines = [
    { speaker: 'Mia', en: 'You bounced back fast.', zh: '你恢复得真快。', annotation: 'warm praise' },
    { speaker: 'Leo', en: 'I had no choice.', zh: '我别无选择。', annotation: 'self-deprecating' },
  ];

  return {
    schemaVersion: 1,
    id: 'analysis-resilient',
    createdAt: '2026-10-27T10:00:00.000Z',
    target: 'resilient',
    language: 'English',
    dimensions: {
      one: {
        overview: {
          pronunciation: '/rɪˈzɪliənt/',
          core: 'able to recover quickly',
          definition: 'Able to withstand or recover quickly from difficulty.',
          partOfSpeech: 'adjective',
        },
        origin: {
          story: 'From Latin resilire, to leap back.',
          physicalImage: 'A spring bouncing back after being pressed.',
          evolution: [
            {
              id: 'origin-latin',
              label: 'Latin',
              period: '1st century',
              meaning: 'leap back',
              connection: 'Physical rebound',
              example: example('resilire', '弹回'),
            },
            {
              id: 'origin-french',
              label: 'Middle French',
              period: '15th century',
              meaning: 'rebound',
              connection: 'Metaphorical recovery',
              example: example('résilient', '有韧性'),
            },
          ],
        },
        bloodline: {
          family: 'Latin resilire family',
          route: ['Latin resiliens', 'Middle French résilient', 'English resilient'],
          socialFeel: 'Modern, slightly formal praise.',
          root: 'resilire',
          cognates: [{ word: 'result', meaning: 'outcome', connection: 'Both build on re- + salire' }],
        },
      },
      two: {
        concept: {
          scene: 'After a failed exam, a student studies again.',
          trigger: 'Setback',
          psychology: 'Bounce-back expectation',
          intensity: 'Moderate',
          boundary: 'Not the same as being unaffected',
          translation: {
            common: '有韧性',
            adds: 'implies recovery',
            misses: 'the Latin bounce image',
          },
        },
        nuance: {
          sharedScene: 'Recovering from hardship',
          words: [
            {
              word: 'resilient',
              image: 'a spring returning to shape',
              register: 5,
              distinction: 'recovers shape after pressure',
              example: example('She is resilient.', '她很有韧性。'),
            },
            {
              word: 'tough',
              image: 'a stone',
              register: 3,
              distinction: 'hard to break',
              example: example('He is tough.', '他很坚强。'),
            },
            {
              word: 'buoyant',
              image: 'a float',
              register: 7,
              distinction: 'rises again after pressure',
              example: example('They stayed buoyant.', '他们保持乐观。'),
            },
          ],
        },
      },
      three: {
        register: {
          score: 5,
          persona: 'Educated general audience',
          prosody: 'neutral',
          prosodyExplanation: 'Steady stress on the second syllable.',
          subtext: 'Praise for recovery.',
          levels,
        },
        chunks: {
          items: [
            { phrase: 'bounce back', meaning: 'recover <quickly> & "fully"', example: example('She bounced back.', '她恢复过来了。') },
            { phrase: 'bounce back from', meaning: 'recover after something', example: example('He bounced back from the loss.', '他从失败中恢复过来。') },
            { phrase: 'prove resilient', meaning: 'show toughness', example: example('The system proved resilient.', '这个系统证明很有韧性。') },
            { phrase: 'resilient to shocks', meaning: 'able to absorb shocks', example: example('The economy is resilient to shocks.', '经济能承受冲击。') },
          ],
          culture: [
            {
              expression: 'resilience training',
              explanation: 'Workplace programs that teach recovery habits.',
              example: example('The team started resilience training.', '团队开始进行韧性训练。'),
            },
          ],
        },
        pitfalls: {
          items: [
            {
              wrong: 'resilient to',
              right: 'resilient in the face of',
              explanation: 'Use a full situation, not a bare noun, after the adjective.',
              image: 'A spring meeting a wall',
              translation: '面对……有韧性',
            },
            {
              wrong: 'very resilient person',
              right: 'a resilient person',
              explanation: 'The adjective already carries intensity; avoid very.',
              image: 'A spring already stretched',
              translation: '一个有韧性的人',
            },
          ],
        },
        slices: {
          dialogues: [
            { setting: 'friends', title: 'Catching up', lines: dialogueLines },
            { setting: 'work', title: 'Performance review', lines: dialogueLines },
            { setting: 'culture', title: 'Documentary', lines: dialogueLines },
          ],
          quiz: [
            {
              id: 'quiz-recovery',
              scenario: 'A teammate misses a deadline but recovers.',
              challenge: 'Which word best praises their recovery?',
              focus: 'resilient versus tough',
              reference: example('They were resilient.', '他们很有韧性。'),
            },
            {
              id: 'quiz-register',
              scenario: 'A formal performance review.',
              challenge: 'Choose the most neutral option.',
              focus: 'register',
              reference: example('She recovered quickly.', '她很快恢复了。'),
            },
          ],
        },
      },
    },
  };
}

function cardFixture(overrides: Partial<StudyCard> = {}): StudyCard {
  return {
    id: 'lexigene|resilient|english|core|resilient',
    type: 'core',
    front: 'resilient',
    back: 'able to recover quickly',
    tags: ['lexigene', 'type::core', 'lang::english'],
    ...overrides,
  };
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new Error('ZIP end of central directory record not found');
}

/** Minimal dependency-free ZIP reader (stored + deflate), enough for `.apkg`. */
function readZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(bytes);
  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid ZIP central directory entry');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 0 ? raw : new Uint8Array(inflateRawSync(raw)));

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

const tempDir = mkdtempSync(join(tmpdir(), 'lexigene-export-test-'));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

interface ArchiveNotes {
  guids: string[];
  fields: string[][];
  tags: string[];
  deckNames: string[];
  cardCount: number;
  sqlite: Uint8Array;
  raw: Uint8Array;
}

let archiveSequence = 0;

function openArchive(bytes: Uint8Array): ArchiveNotes {
  const entries = readZipEntries(bytes);
  const collection = entries.get('collection.anki2');
  if (!collection) throw new Error(`collection.anki2 missing; entries: ${[...entries.keys()].join(', ')}`);

  const databasePath = join(tempDir, `collection-${archiveSequence += 1}.anki2`);
  writeFileSync(databasePath, collection);
  const database = new DatabaseSync(databasePath);
  try {
    const notes = database.prepare('SELECT guid, flds, tags FROM notes ORDER BY id').all() as unknown as Array<{
      guid: string;
      flds: string;
      tags: string;
    }>;
    const decksRow = database.prepare('SELECT decks FROM col LIMIT 1').get() as unknown as { decks: string };
    const decks = JSON.parse(decksRow.decks) as Record<string, { name: string }>;
    const countRow = database.prepare('SELECT COUNT(*) AS count FROM cards').get() as unknown as { count: number };

    return {
      guids: notes.map(note => note.guid),
      fields: notes.map(note => note.flds.split('\x1f')),
      tags: notes.map(note => note.tags),
      deckNames: Object.values(decks).map(deck => deck.name),
      cardCount: countRow.count,
      sqlite: collection,
      raw: bytes,
    };
  } finally {
    database.close();
  }
}

async function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://127.0.0.1:3000/api/export/anki', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function readArchive(response: Response): Promise<ArchiveNotes> {
  expect(response.status).toBe(200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return openArchive(bytes);
}

describe('local storage schema', () => {
  it('declares the typed tables and indexes without credential stores', () => {
    const tables = db.tables.map(table => ({
      name: table.name,
      keyPath: table.schema.primKey.keyPath,
      indexes: table.schema.indexes.map(index => index.name),
    }));

    expect(tables).toEqual([
      { name: 'analyses', keyPath: 'id', indexes: ['target', 'createdAt'] },
      { name: 'drafts', keyPath: 'id', indexes: [] },
      { name: 'attempts', keyPath: 'id', indexes: ['analysisId'] },
      { name: 'selections', keyPath: 'analysisId', indexes: [] },
    ]);
    expect(tables.some(table => /api|key|config|credential/i.test(table.name))).toBe(false);
  });
});

describe('loadSelections', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns undefined when nothing was saved so callers can apply defaults', async () => {
    vi.spyOn(db.selections, 'get').mockResolvedValue(undefined);
    await expect(loadSelections('never-saved')).resolves.toBeUndefined();
  });

  it('returns [] when the user explicitly cleared the selection', async () => {
    vi.spyOn(db.selections, 'get').mockResolvedValue({ analysisId: 'cleared', cardIds: [] });
    await expect(loadSelections('cleared')).resolves.toEqual([]);
  });

  it('returns the stored card ids', async () => {
    vi.spyOn(db.selections, 'get').mockResolvedValue({ analysisId: 'kept', cardIds: ['core', 'chunk'] });
    await expect(loadSelections('kept')).resolves.toEqual(['core', 'chunk']);
  });
});

describe('buildCards', () => {
  it('keeps the fixture valid against the fixed schema', () => {
    expect(() => analysisSchema.parse(fixture())).not.toThrow();
  });

  it('emits core, chunk, nuance, pitfall and quiz cards as plain text', () => {
    const cards = buildCards(fixture());
    const types = new Set(cards.map(card => card.type));

    expect(types).toEqual(new Set(['core', 'chunk', 'nuance', 'pitfall', 'quiz']));
    expect(cards.filter(card => card.type === 'core')).toHaveLength(1);
    expect(cards.filter(card => card.type === 'chunk')).toHaveLength(5); // 4 chunks + 1 culture
    expect(cards.filter(card => card.type === 'nuance')).toHaveLength(3);
    expect(cards.filter(card => card.type === 'pitfall')).toHaveLength(2);
    expect(cards.filter(card => card.type === 'quiz')).toHaveLength(2);

    // Content stays plain text until export: markup is preserved literally.
    const chunk = cards.find(card => card.type === 'chunk' && card.front === 'bounce back');
    expect(chunk?.back).toContain('recover <quickly> & "fully"');
    expect(chunk?.back).not.toContain('&lt;quickly&gt;');
    expect(chunk?.back).toContain('\n');
  });

  it('derives stable readable ids without timestamps or content hashes', () => {
    const cards = buildCards(fixture());
    const core = cards.find(card => card.type === 'core');

    expect(core?.id).toBe(JSON.stringify(['lexigene', 'resilient', 'english', 'core', 'resilient']));
    expect(core?.id).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(core?.id).not.toMatch(/\b[0-9a-f]{32,}\b/);
    expect(new Set(cards.map(card => card.id)).size).toBe(cards.length);
  });

  it('keeps ids stable when explanations change but semantics stay put', () => {
    const base = fixture();
    const edited = fixture();
    edited.dimensions.one.overview.definition = 'A completely rewritten definition.';
    edited.dimensions.three.chunks.items[0]!.meaning = 'rewritten meaning';

    const before = buildCards(base);
    const after = buildCards(edited);
    expect(after.map(card => card.id)).toEqual(before.map(card => card.id));
    expect(after.map(card => card.front)).toEqual(before.map(card => card.front));
  });

  it('changes ids when target, language or semantic key changes', () => {
    const base = buildCards(fixture()).map(card => card.id);

    const otherTarget = fixture();
    otherTarget.target = 'stoic';
    expect(new Set(buildCards(otherTarget).map(card => card.id))).not.toEqual(new Set(base));

    const otherLanguage = fixture();
    otherLanguage.language = 'German';
    expect(new Set(buildCards(otherLanguage).map(card => card.id))).not.toEqual(new Set(base));

    const rewordedChunk = fixture();
    rewordedChunk.dimensions.three.chunks.items[0]!.phrase = 'spring back';
    expect(new Set(buildCards(rewordedChunk).map(card => card.id))).not.toEqual(new Set(base));
  });

  it('is independent of array order for semantic keys', () => {
    const original = buildCards(fixture());
    const reordered = fixture();
    reordered.dimensions.three.chunks.items.reverse();
    const shuffled = buildCards(reordered);

    expect(shuffled.map(card => card.id).sort()).toEqual(original.map(card => card.id).sort());
  });
});

describe('HTML and TSV export helpers', () => {
  it('escapes the five HTML characters exactly once', () => {
    expect(escapeHtml('<script>alert("x") & \'y\'</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    );
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
    expect(escapeHtml('plain text')).toBe('plain text');
  });

  it('converts line breaks to <br> after escaping and drops forbidden controls', () => {
    expect(textToHtml('line 1\r\nline 2\rline 3\n<b>&</b>')).toBe(
      'line 1<br>line 2<br>line 3<br>&lt;b&gt;&amp;&lt;/b&gt;',
    );
    expect(textToHtml('a\u0000b\u001fc')).toBe('abc');
  });

  it('renders TSV with tab columns, escaped HTML line breaks and a trailing newline', () => {
    const cards = [
      cardFixture({ front: 'front\twith tab', back: 'line 1\nline 2 <tag> & "quote"', tags: ['a', 'b'] }),
      cardFixture({ id: 'second', front: 'front 2', back: 'back 2', tags: [] }),
    ];
    const rows = cardsToTsv(cards).split('\n');

    expect(rows).toHaveLength(3);
    expect(rows[2]).toBe('');
    expect(rows[0]!.split('\t')).toEqual([
      'front&#9;with tab',
      'line 1<br>line 2 &lt;tag&gt; &amp; &quot;quote&quot;',
      'a b',
    ]);
    expect(rows[1]!.split('\t')).toEqual(['front 2', 'back 2', '']);
    expect(cardsToTsv([])).toBe('');

    const unicode = cardsToTsv([cardFixture({ front: '有韧性 resilient', back: 'rɪˈzɪliənt — 弹回', tags: ['中文'] })]);
    expect(unicode).toContain('有韧性 resilient');
    expect(unicode).toContain('rɪˈzɪliənt — 弹回');
    expect(unicode).toContain('中文');
  });
});

describe('POST /api/export/anki', () => {
  it('returns a downloadable .apkg with escaped fields and stable GUIDs', async () => {
    const cards = buildCards(fixture());
    const body = { deckName: 'LexiGene', cards, apiKey: API_KEY_SENTINEL };

    const response = await post(body);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toContain('LexiGene.apkg');
    expect(response.headers.get('content-disposition')).toContain('attachment');

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get('content-length')).toBe(String(bytes.length));
    expect(Array.from(bytes.subarray(0, 2))).toEqual([0x50, 0x4b]); // ZIP magic

    const archive = openArchive(bytes);
    expect(archive.deckNames).toContain('LexiGene');
    expect(archive.fields).toHaveLength(cards.length);
    expect(archive.cardCount).toBe(cards.length);
    expect(archive.fields.every(fields => fields.length === 2)).toBe(true);

    const expected = cards.map(card => [textToHtml(card.front), textToHtml(card.back)]).sort();
    expect([...archive.fields].sort()).toEqual(expected);
    expect(archive.fields.flat().join('\n')).toContain('&lt;quickly&gt;');
    expect(archive.fields.flat().join('\n')).not.toContain('<quickly>');

    // Re-exporting the same cards must reuse the same Anki note GUIDs.
    const second = await readArchive(await post({ deckName: 'LexiGene', cards }));
    expect(second.guids).toEqual(archive.guids);

    // API credentials must never reach the archive.
    const collectionText = Buffer.from(archive.sqlite).toString('utf8');
    expect(collectionText).not.toContain(API_KEY_SENTINEL);
    expect(collectionText).not.toContain('apiKey');
    expect(Buffer.from(archive.raw).includes(Buffer.from(API_KEY_SENTINEL))).toBe(false);
    for (const name of readZipEntries(archive.raw).keys()) {
      expect(name).not.toMatch(/key|config|setting|credential/i);
    }
  });

  it('defaults the deck to LexiGene', async () => {
    const response = await post({ cards: [cardFixture()] });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('LexiGene.apkg');
    const archive = await readArchive(await post({ cards: [cardFixture()] }));
    expect(archive.deckNames).toContain('LexiGene');
  });

  it('encodes newlines as <br> and HTML as escaped text in the SQLite fields', async () => {
    const card = cardFixture({
      id: 'xss-card',
      front: '<script>alert("x")</script>',
      back: 'first & second\nthird "quoted"',
      tags: ['lexigene'],
    });
    const archive = await readArchive(await post({ deckName: 'Safe', cards: [card] }));
    const [front, back] = archive.fields[0]!;

    expect(front).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(front).not.toContain('<script>');
    expect(back).toBe('first &amp; second<br>third &quot;quoted&quot;');
  });

  it('rejects invalid, oversized and missing payloads', async () => {
    const invalidBodies: unknown[] = [
      {},
      { cards: [] },
      { deckName: '   ', cards: [cardFixture()] },
      { deckName: 'x'.repeat(81), cards: [cardFixture()] },
      { deckName: 'bad\u0000name', cards: [cardFixture()] },
      { cards: [cardFixture({ type: 'bogus' as StudyCard['type'] })] },
      { cards: [cardFixture({ front: '' })] },
      { cards: [cardFixture({ back: 'x'.repeat(30_001) })] },
      { cards: [cardFixture({ tags: Array.from({ length: 31 }, (_, index) => `tag${index}`) })] },
      { cards: Array.from({ length: 1001 }, (_, index) => cardFixture({ id: `card-${index}` })) },
      {
        cards: Array.from({ length: 140 }, (_, index) =>
          cardFixture({ id: `bulk-${index}`, front: `front ${index}`, back: 'y'.repeat(30_000) }),
        ),
      },
    ];

    for (const body of invalidBodies) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');
      const error = (await response.json()) as { error: string };
      expect(error.error).toBeTruthy();
    }
  });

  it('rejects a non-JSON body', async () => {
    const response = await POST(
      new Request('http://127.0.0.1:3000/api/export/anki', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
    );
    expect(response.status).toBe(400);
  });
});
