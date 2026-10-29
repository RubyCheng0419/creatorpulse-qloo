import { NextRequest, NextResponse } from 'next/server';
import { DiscoverInput, runDiscover } from '@/lib/discover';
import { ApiError, errorMessage } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';
import { withRequestContext } from '@/lib/request-context';
import type { OnDiscoverProgress } from '@/lib/stages';

// About 70 throttled Qloo calls on a cold cache (≈12 s), plus a few YouTube lookups.
export const maxDuration = 60;

function errorBody(e: unknown): { status: number; body: Record<string, unknown> } {
  if (e instanceof ApiError) return { status: e.status, body: { error: e.message, ...e.extra } };
  return { status: 500, body: { error: errorMessage(e) || 'Finding creators failed.' } };
}

const run = (input: DiscoverInput, onProgress?: OnDiscoverProgress) =>
  withRequestContext({ bypassCache: input.live === true }, () => runDiscover(input, onProgress));

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 'discover', 5);
  if (limited) return limited;

  let input: DiscoverInput;
  try {
    input = (await request.json()) || {};
  } catch {
    return NextResponse.json({ error: 'Invalid request: expected JSON.' }, { status: 400 });
  }

  // With Accept: application/x-ndjson the response streams one JSON object per line, as
  // /api/match does: {"type":"progress",...} as each step finishes, then {"type":"result"|"error",...}.
  if (request.headers.get('accept')?.includes('application/x-ndjson')) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (o: object) => controller.enqueue(encoder.encode(JSON.stringify(o) + '\n'));
        try {
          const discovery = await run(input, (p) => send({ type: 'progress', ...p }));
          send({ type: 'result', discovery });
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
    // insufficient-data is HTTP 200 with status set, as for /api/match.
    return NextResponse.json(await run(input));
  } catch (e) {
    const { status, body } = errorBody(e);
    return NextResponse.json(body, { status });
  }
}
