import { z } from 'zod';
import {
  apiConfigSchema,
  dimensionSchemas,
  draftSchema,
  type AnalysisDraft,
  type AnalysisEvent,
  type DimensionKey,
} from '@/lib/schema';
import { callJson, isAbortedError, publicMessage } from '@/lib/llm';
import { buildDimensionMessages } from '@/lib/prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;
const DIMENSION_TIMEOUT_MS = 120_000;
const DIMENSION_MAX_TOKENS = 9_000;
const DIMENSION_ORDER: DimensionKey[] = ['one', 'two', 'three'];

const requestSchema = z.object({
  config: apiConfigSchema,
  draft: draftSchema,
});

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('请求体必须是 JSON。', 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('接口配置或分析草稿不完整、格式不正确。', 400);
  }

  const { config, draft } = parsed.data;
  const encoder = new TextEncoder();
  const upstreamAbort = new AbortController();
  const abortUpstream = () => {
    if (!upstreamAbort.signal.aborted) upstreamAbort.abort();
  };
  if (request.signal.aborted) abortUpstream();
  else request.signal.addEventListener('abort', abortUpstream, { once: true });

  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: AnalysisEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      const run = async () => {
        // Draft dimensions that already exist are never regenerated, so a
        // failed/retried request resumes from the first missing dimension.
        const dimensions: AnalysisDraft['dimensions'] = { ...draft.dimensions };
        let current: DimensionKey = 'one';

        try {
          for (const dimension of DIMENSION_ORDER) {
            if (closed || request.signal.aborted) break;
            if (dimensions[dimension]) continue;

            current = dimension;
            send({ type: 'dimension-start', dimension });

            const data = await callJson({
              config,
              schema: dimensionSchemas[dimension],
              messages: buildDimensionMessages({ draft, dimension, completed: dimensions }),
              signal: upstreamAbort.signal,
              timeoutMs: DIMENSION_TIMEOUT_MS,
              maxTokens: DIMENSION_MAX_TOKENS,
            });

            (dimensions as Record<DimensionKey, unknown>)[dimension] = data;
            send({ type: 'dimension-complete', dimension, data });
          }

          if (!closed && !request.signal.aborted) send({ type: 'complete' });
        } catch (error) {
          if (!isAbortedError(error) && !request.signal.aborted) {
            send({ type: 'error', message: publicMessage(error), dimension: current });
          }
        } finally {
          request.signal.removeEventListener('abort', abortUpstream);
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = undefined;
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // Already cancelled by the client.
            }
          }
        }
      };

      void run();
    },
    cancel() {
      closed = true;
      abortUpstream();
      request.signal.removeEventListener('abort', abortUpstream);
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
