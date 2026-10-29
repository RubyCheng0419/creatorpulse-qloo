import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { lookupBrand } from '@/lib/brand';
import { ApiError, errorMessage } from '@/lib/errors';

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 'brand-lookup', 10);
  if (limited) return limited;

  let body: Record<string, unknown> | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request: expected JSON.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await lookupBrand(body?.brandName, body?.category));
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
    return NextResponse.json({ error: errorMessage(e) || 'Brand lookup failed.' }, { status: 500 });
  }
}
