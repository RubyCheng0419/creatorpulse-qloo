import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getCreatorTaste } from '@/lib/creator';
import { ApiError, errorMessage } from '@/lib/errors';

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 'creator-taste', 5);
  if (limited) return limited;

  let body: Record<string, unknown> | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request: expected JSON.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await getCreatorTaste(body?.videoUrls));
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
    return NextResponse.json({ error: errorMessage(e) || 'Reading the creator’s taste failed.' }, { status: 500 });
  }
}
