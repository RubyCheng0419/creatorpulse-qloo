// Validation 2: real sponsorships as the reference answer. Each brand a creator actually links
// in their latest descriptions is scored (Check a creator, channel = latest 15 videos) against
// a fixed pool of creators; the question is where the creator who works with it ranks. The
// brand itself is never scored, so naming the sponsor can't raise its own creator's score.
// Usage: node validate-sponsors.mjs <base> <out.json>
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
const [base, out] = process.argv.slice(2);
const POOL = ['@mkbhd', '@LinusTechTips', '@Joeman', '@MrBeast', '@dcrainmaker', '@JoshuaWeissman', '@aliabdaal', '@NikkieTutorials'];
const SPONSORS = [
  ['The Ridge', ['@mkbhd']],
  ['Dbrand', ['@mkbhd', '@LinusTechTips']],
  ['Proton', ['@LinusTechTips']],
  ['Sony', ['@Joeman']],
  ['iFit', ['@MrBeast']],
  ['Marriott Hotels', ['@MrBeast']],
  ['Krispy Kreme', ['@MrBeast']],
  ["Lowe's", ['@MrBeast']],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function match(brandName, handle) {
  for (;;) {
    const r = await fetch(new URL('/api/match', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brandName, videoUrls: [`https://www.youtube.com/${handle}`] }) });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    const wait = /wait (\d+) seconds/.exec(j?.error || '')?.[1];
    if (r.status === 429 && wait) { await sleep((Number(wait) + 1) * 1000); continue; }
    return { status: r.status, j };
  }
}
const results = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {}; // resumable
for (const [brand, partners] of SPONSORS) {
  results[brand] ??= {};
  for (const h of POOL) {
    if (results[brand][h]) continue;
    const { status, j } = await match(brand, h);
    const e = j?.trace?.filter((s) => s.tool?.startsWith('Qloo') && s.ok === false && /gave up|no response/.test(s.http || '')).length ?? 0;
    results[brand][h] = { status, fit: j?.compatibility?.fitScore ?? null, conf: j?.compatibility?.confidence ?? null, basis: j?.scoreBasis ?? null, reason: j?.noDataReason ?? j?.error ?? null, failed: e, brandBasis: j?.brand?.basis ?? null };
    writeFileSync(out, JSON.stringify(results, null, 1));
    const r = results[brand][h];
    console.log(`${brand} × ${h}: ${r.fit ?? 'no score'} ${r.conf ?? ''} ${r.basis ?? ''} ${r.reason ?? ''}${partners.includes(h) ? '  ← partner' : ''}`);
  }
}
console.log('\n## Where the partner ranks (1 = highest Fit among scored creators)');
const ranks = [];
for (const [brand, partners] of SPONSORS) {
  const scored = Object.entries(results[brand]).filter(([, r]) => r.fit != null).sort((a, b) => b[1].fit - a[1].fit);
  for (const p of partners) {
    const r = results[brand][p];
    if (r?.fit == null) { console.log(`${brand} × ${p}: partner has no score (${r?.reason})`); continue; }
    const rank = 1 + scored.filter(([, x]) => x.fit > r.fit).length;
    const chance = (scored.length + 1) / 2;
    ranks.push({ rank, n: scored.length, chance });
    console.log(`${brand}: partner ${p} ranks ${rank} of ${scored.length} (Fit ${r.fit}; chance ${chance.toFixed(1)}) · ${scored.map(([h, x]) => `${h} ${x.fit}`).join(', ')}`);
  }
}
if (ranks.length) {
  const pct = ranks.map((r) => (r.n - r.rank) / Math.max(1, r.n - 1)); // 1 = top, 0 = bottom
  console.log(`\nPartners in the top half: ${ranks.filter((r) => r.rank <= r.n / 2).length} of ${ranks.length} · mean percentile ${(pct.reduce((a, b) => a + b, 0) / pct.length).toFixed(2)} (0.50 = chance)`);
}
