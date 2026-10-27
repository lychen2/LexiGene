import AnkiExport from 'anki-apkg-export';
import { z } from 'zod';
import { textToHtml } from '@/lib/cards';
import { cardSchema } from '@/lib/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Hard caps so an oversized payload cannot exhaust the server. */
const MAX_CARDS = 1000;
const MAX_TOTAL_CHARS = 4_000_000;

const noControlChars = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

const exportCardSchema = cardSchema.extend({
  id: z.string().min(1).max(2048),
  front: z.string().min(1).max(10_000),
  back: z.string().min(1).max(30_000),
  tags: z.array(z.string().min(1).max(64).refine(noControlChars, 'Tag contains control characters')).max(30),
});

const exportRequestSchema = z
  .object({
    deckName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(noControlChars, 'Deck name contains control characters')
      .default('LexiGene'),
    cards: z.array(exportCardSchema).min(1).max(MAX_CARDS),
  })
  .refine(
    body => body.cards.reduce((total, card) => total + card.front.length + card.back.length, 0) <= MAX_TOTAL_CHARS,
    { message: 'Card content exceeds the export size limit', path: ['cards'] },
  );

function jsonError(status: number, error: string, issues?: unknown): Response {
  return new Response(JSON.stringify(issues === undefined ? { error } : { error, issues }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function fileSafeName(name: string): string {
  const safe = name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^\.+/, '').trim();
  return safe || 'LexiGene';
}

/**
 * POST /api/export/anki
 *
 * Body: `{ deckName?: string, cards: StudyCard[] }`
 * Response: `.apkg` bytes (`application/octet-stream`) for the client to download.
 *
 * Cards are plain text; HTML encoding plus `<br>` line breaks are applied here.
 * Note ids are passed through as stable Anki GUID keys. The generated archive
 * contains only deck/card data (never API configuration).
 */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, 'Request body must be valid JSON');
  }

  const parsed = exportRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError(
      400,
      'Invalid export request',
      parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }

  const { deckName, cards } = parsed.data;
  let bytes: Uint8Array;
  try {
    const apkg = await AnkiExport.create(deckName);
    try {
      for (const card of cards) {
        apkg.addCard(textToHtml(card.front), textToHtml(card.back), {
          noteId: card.id,
          tags: card.tags,
        });
      }
      bytes = await apkg.save();
    } finally {
      apkg.close();
    }
  } catch (error) {
    console.error('Anki export failed', error);
    return jsonError(500, 'Failed to build Anki package');
  }

  const filename = `${fileSafeName(deckName)}.apkg`;
  const asciiFilename = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
