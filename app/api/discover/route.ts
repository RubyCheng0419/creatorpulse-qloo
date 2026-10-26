import { NextRequest, NextResponse } from 'next/server';
import { DiscoverInput, runDiscover } from '@/lib/discover';
import { ApiError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';
import { withRequestContext } from '@/lib/request-context';

// About 70 throttled Qloo calls on a cold cache (≈12 s), plus a few YouTube lookups.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 'discover', 5);
  if (limited) return limited;

  let input: DiscoverInput;
  try {
    input = (await request.json()) || {};
  } catch {
    return NextResponse.json({ error: 'Invalid request: expected JSON.' }, { status: 400 });
  }

  try {
    // insufficient-data is HTTP 200 with status set, as for /api/match.
    return NextResponse.json(await withRequestContext({ bypassCache: input.live === true }, () => runDiscover(input)));
  } catch (e: any) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
    return NextResponse.json({ error: e?.message || 'Finding creators failed.' }, { status: 500 });
  }
}
