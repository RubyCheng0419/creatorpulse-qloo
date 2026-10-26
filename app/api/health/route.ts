import { NextRequest, NextResponse } from 'next/server';
import { GEMINI_MODEL, hasGemini } from '@/lib/gemini';
import { GROQ_MODEL, checkGroq } from '@/lib/groq';
import { rateLimit } from '@/lib/rate-limit';

// Which LLMs this deployment can use for name extraction. Says only whether each key is
// set (and, for Groq, accepted); never returns a key. Gemini isn't called here, so the
// check doesn't spend its daily quota.
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 'health', 10);
  if (limited) return limited;

  return NextResponse.json(
    {
      gemini: { model: GEMINI_MODEL, key: hasGemini() ? 'configured' : 'not configured' },
      groq: { model: GROQ_MODEL, key: await checkGroq() },
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
