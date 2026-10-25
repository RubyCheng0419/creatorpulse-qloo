import { NextRequest, NextResponse } from 'next/server';
import { withDemoFallback } from '@/lib/demo-snapshot';
import { ApiError } from '@/lib/errors';
import { MatchInput, runMatch } from '@/lib/match';
import type { OnStage } from '@/lib/stages';

// ~60 throttled Qloo calls on a cold cache (≈8s); leave room above the 20s target.
export const maxDuration = 60;

function errorBody(e: any): { status: number; body: Record<string, unknown> } {
  if (e instanceof ApiError) return { status: e.status, body: { error: e.message, ...e.extra } };
  return { status: 500, body: { error: e?.message || 'Matching failed.' } };
}

const run = (input: MatchInput, onStage?: OnStage) => withDemoFallback(input, () => runMatch(input, onStage));

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request: expected JSON.' }, { status: 400 });
  }
  const input: MatchInput = body || {};

  // With Accept: application/x-ndjson the response streams one JSON object per line:
  // {"type":"stage","stage":...} as each step finishes, then {"type":"result"|"error",...}.
  if (request.headers.get('accept')?.includes('application/x-ndjson')) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (o: object) => controller.enqueue(encoder.encode(JSON.stringify(o) + '\n'));
        try {
          const match = await run(input, (stage) => send({ type: 'stage', stage }));
          send({ type: 'result', match });
        } catch (e) {
          const { status, body } = errorBody(e);
          send({ type: 'error', status, ...body });
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
  }

  try {
    // insufficient-data is HTTP 200 with status set (PRODUCT_SPEC §9), never a made-up score.
    return NextResponse.json(await run(input));
  } catch (e) {
    const { status, body } = errorBody(e);
    return NextResponse.json(body, { status });
  }
}
