import { NextRequest, NextResponse } from 'next/server';
import { geminiJson, hasGemini } from '@/lib/gemini';

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    directions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          hook: { type: 'string' },
          rationale: { type: 'string' },
          signals: { type: 'array', items: { type: 'string' } },
          brandCategory: { type: 'string' },
          brandAngle: { type: 'string' },
        },
        required: ['title', 'hook', 'rationale', 'signals', 'brandCategory', 'brandAngle'],
      },
    },
  },
  required: ['summary', 'directions'],
};

interface TasteSignal {
  name: string;
  category: string;
  score: number;
  explainability?: any;
}

interface Direction {
  title: string;
  hook: string;
  rationale: string;
  signals: string[];
  brandCategory: string;
  brandAngle: string;
}

interface PlanResult {
  source: string;
  qlooError: string | null;
  planner: string;
  summary: string;
  tasteSignals: TasteSignal[];
  directions: Direction[];
  llmError?: string;
}

const qlooBase = process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com';

async function qlooJson(url: string) {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw Error('尚未設定 Qloo API Key。');

  const r = await fetch(url, {
    headers: { 'X-Api-Key': key, accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });

  let d: any = {};
  try {
    d = await r.json();
  } catch {}

  if (!r.ok) {
    const detail =
      d?.errors?.map((x: any) => x.message).join('; ') ||
      d?.error?.message ||
      d?.message ||
      `Qloo 回應 ${r.status}`;
    throw Error(detail);
  }

  return d;
}

function fallback(seeds: string[], signals: TasteSignal[], source: string, error: any): PlanResult {
  const picked = signals.slice(0, 3);
  const names = picked.map((x) => x.name);
  const seedText = seeds.slice(0, 3).join('、');

  const brandFor = (category: string): string => {
    const mapping: Record<string, string> = {
      artist: '耳機、音響與音樂服務',
      movie: '影像設備與串流服務',
      destination: '旅遊裝備與行動科技',
      book: '閱讀設備與出版品牌',
      brand: '互補型科技與生活品牌',
    };
    return mapping[category] || '科技與生活風格品牌';
  };

  const angleFor = (category: string, signal: string): string => {
    const mapping: Record<string, string> = {
      artist: `以${signal}情境呈現聲音或創作功能`,
      movie: `用${signal}主題做情境化實測`,
      destination: `在${signal}旅程中展示產品的實用性`,
      book: `從${signal}主題切入，展示閱讀或創作體驗`,
      brand: `把${signal}連結到真實使用情境`,
    };
    return mapping[category] || `以${signal}為情境，讓產品功能自然出現`;
  };

  const directions: Direction[] = picked.map((signal, i) => {
    const category = String(signal.category || '').toLowerCase();
    const topic = signal.name;
    const starts = ['把興趣帶進日常', '測試產品能否融入生活', '從圈外興趣找到新用法'];

    return {
      title: `${topic} × 科技實測：${starts[i]}`,
      hook: `以「${topic}」作為內容情境，實測${seedText}相關裝置或服務，觀察它能否解決實際需求。`,
      rationale: `Qloo 根據已確認的線索推薦「${topic}」作為跨域品味方向；這是一個可驗證的企劃假設，不代表已直接觀測到粉絲偏好。`,
      signals: [topic, ...seeds.slice(0, 2)],
      brandCategory: brandFor(category),
      brandAngle: angleFor(category, topic),
    };
  });

  return {
    source,
    qlooError: error,
    planner: 'template',
    summary: `從 ${seedText} 等已確認線索出發，Qloo 推薦 ${names.join('、')} 等跨域品味方向。以下企劃草稿依這些訊號組合，供創作者驗證。`,
    tasteSignals: signals,
    directions,
  };
}

async function plan({
  seeds,
  region,
}: {
  seeds: string[];
  region: string;
}): Promise<PlanResult> {
  let signals: TasteSignal[] = [];
  let source = 'demo';
  let qlooError = null;

  const key = process.env.QLOO_API_KEY;

  if (key) {
    try {
      const resolved = await Promise.all(
        seeds.map(async (name) => {
          try {
            const u = new URL('/search', qlooBase);
            u.searchParams.set('query', name);
            u.searchParams.set('take', '5');
            const d = await qlooJson(u.toString());
            const results = Array.isArray(d.results) ? d.results : [];
            if (!results.length) throw Error(`Qloo 找不到線索「${name}」`);

            const exact = results.find(
              (x: any) => String(x.name || '').trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()
            );
            const entity = exact || results[0];
            if (!entity.entity_id) throw Error(`Qloo 無法解析線索「${name}」`);

            return { name: entity.name || name, id: entity.entity_id };
          } catch (e: any) {
            return { error: e.message, input: name };
          }
        })
      );

      const valid = resolved.filter((x: any) => x.id);
      if (!valid.length) {
        const reasons = resolved
          .map((x: any) => x.error)
          .filter(Boolean)
          .slice(0, 3)
          .join('；');
        throw Error(`這些線索無法在 Qloo 找到對應項目：${reasons}。請移除或改用具體的品牌、作品、藝人或地點。`);
      }

      const types = ['urn:entity:artist', 'urn:entity:movie', 'urn:entity:brand', 'urn:entity:destination', 'urn:entity:book'];
      const batches = await Promise.all(
        types.map(async (type) => {
          const u = new URL('/v2/insights', qlooBase);
          u.searchParams.set('filter.type', type);
          u.searchParams.set('take', '8');
          u.searchParams.set('feature.explainability', 'true');
          u.searchParams.set('signal.interests.entities', valid.map((x: any) => x.id).join(','));
          if (region) u.searchParams.set('signal.location.query', region);

          const d = await qlooJson(u.toString());
          return (d?.results?.entities || [])
            .map((x: any) => ({
              name: x.name,
              category: type.replace('urn:entity:', ''),
              score: x.query?.affinity ?? x.score,
              explainability: x.query?.explainability,
            }))
            .filter((x: any) => x.name);
        })
      );

      signals = [...new Map(batches.flat().map((x: any) => [x.name, x])).values()].slice(0, 16);
      if (!signals.length) throw Error('Qloo 沒有找到這些線索對應的跨域結果。請換幾個更具體的線索再試一次。');

      source = 'qloo';
    } catch (e: any) {
      qlooError = e.message;
    }
  }

  if (!signals.length) {
    signals = [
      { name: '戶外探險與露營', category: 'destination', score: 0.89 },
      { name: '獨立音樂與現場音樂節', category: 'artist', score: 0.82 },
      { name: '近未來科幻', category: 'movie', score: 0.77 },
      { name: '設計感消費科技', category: 'brand', score: 0.74 },
      { name: '永續移動', category: 'destination', score: 0.69 },
    ];
  }

  const result = fallback(seeds, signals, source, qlooError);

  if (!hasGemini()) return result;

  try {
    const g = await geminiJson<{ summary: string; directions: Direction[] }>(
      'You are CreatorPulse, a creator strategy agent. Return JSON with keys: summary and directions (exactly 3 objects with title, hook, rationale, signals array, brandCategory, brandAngle). Ground each suggestion in supplied taste signals. Call results hypotheses; never claim actual audience behavior or purchase intent.',
      JSON.stringify({ channel: 'technology YouTuber', region, seeds, tasteSignals: signals }),
      PLAN_SCHEMA,
      0.65
    );
    if (!Array.isArray(g.directions) || g.directions.length !== 3) throw Error('Unexpected model response');

    return { ...result, ...g, planner: 'gemini' };
  } catch (e: any) {
    result.llmError = e.message;
    return result;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as any;

    if (!Array.isArray(body.seeds) || body.seeds.length < 1 || body.seeds.length > 12) {
      return NextResponse.json({ error: '請提供 1 至 12 個品味線索。' }, { status: 400 });
    }

    const result = await plan({
      seeds: body.seeds
        .map(String)
        .map((s: string) => s.trim())
        .filter(Boolean),
      region: String(body.region || 'Taiwan'),
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '產生企劃時發生錯誤。' }, { status: 500 });
  }
}
