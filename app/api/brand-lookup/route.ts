import { NextRequest, NextResponse } from 'next/server';
import { lookupBrand } from '@/lib/brand';
import { ApiError } from '@/lib/errors';

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request: expected JSON.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await lookupBrand(body?.brandName, body?.category));
  } catch (e: any) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
    return NextResponse.json({ error: e.message || 'Brand lookup failed.' }, { status: 500 });
  }
}
