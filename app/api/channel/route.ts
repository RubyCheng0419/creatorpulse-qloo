import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { readChannel } from '@/lib/youtube-channel';
import { parseChannelRef } from '@/lib/youtube-url';
import { errorMessage } from '@/lib/errors';

// Reads one YouTube channel the user named (creator page: "Link the channel"), 1 quota unit.
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 'channel', 10);
  if (limited) return limited;

  let body: Record<string, unknown> | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request: expected JSON.' }, { status: 400 });
  }
  const ref = parseChannelRef(String(body?.url || ''));
  if (!ref) return NextResponse.json({ error: 'Not a channel URL: use youtube.com/@handle or youtube.com/channel/UC…' }, { status: 400 });
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return NextResponse.json({ error: 'YouTube is not configured.' }, { status: 503 });
  try {
    const channel = await readChannel(ref, key);
    return channel ? NextResponse.json({ channel }) : NextResponse.json({ error: 'YouTube has no channel at that address.' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: `YouTube didn’t answer: ${errorMessage(e)}` }, { status: 502 });
  }
}
