import { NextResponse } from 'next/server';

// Per-IP sliding-window limit, so a public demo can't drain the Gemini, Qloo and
// YouTube quotas. In-memory, so each server instance counts separately: a cheap
// guard against bursts, not a global quota.

const hits = new Map<string, number[]>();

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

// Returns a 429 response when the caller is over the limit, otherwise null.
export function rateLimit(request: Request, bucket: string, max: number, windowMs = 60_000): NextResponse | null {
  const now = Date.now();
  const key = `${bucket}:${clientIp(request)}`;
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    const retryAfter = Math.ceil((recent[0] + windowMs - now) / 1000);
    return NextResponse.json(
      { error: `Too many requests. Please wait ${retryAfter} seconds and try again.` },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now - v[v.length - 1] >= windowMs) hits.delete(k);
  }
  return null;
}
