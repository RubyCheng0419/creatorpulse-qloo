// Validation 1 (known groups, Find creators): for each brand, the creator type that should fit
// vs one that shouldn't. Find creators uses no LLM, so a run is deterministic. Reports per brand
// the mean Fit of scored creators in each type, the gap, and the pairwise win rate (share of
// fit-type × misfit-type creator pairs where the fit-type creator scores higher; 0.5 = chance).
// Usage: node validate-discover.mjs <base> <out.json>
import { writeFileSync } from 'node:fs';
const [base, out] = process.argv.slice(2);
const CASES = [
  ['Razer', 'gaming', 'beauty'],
  ['Logitech', 'gaming', 'fashion'],
  ['Fenty Beauty', 'beauty', 'gaming'],
  ['Sephora', 'beauty', 'technology'],
  ['Apple', 'technology', 'beauty'],
  ['Samsung', 'technology', 'fashion'],
  ['Gucci', 'fashion', 'gaming'],
  ['Zara', 'fashion', 'technology'],
  ['Spotify', 'music', 'beauty'],
  ['Fender', 'music', 'beauty'],
  ['Huggies', 'lifestyle', 'gaming'],
  ['Nintendo', 'gaming', 'fashion'],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function discover(brandName, creatorCategory) {
  for (;;) {
    const r = await fetch(new URL('/api/discover', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brandName, creatorCategory, live: true }) });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    const wait = /wait (\d+) seconds/.exec(j?.error || '')?.[1];
    if (r.status === 429 && wait) { await sleep((Number(wait) + 1) * 1000); continue; }
    return { status: r.status, j };
  }
}
const scores = (j) => (j?.candidates || []).filter((c) => c.compatibility?.fitScore != null).map((c) => ({ name: c.name, fit: c.compatibility.fitScore, conf: c.compatibility.confidence }));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const rows = [];
for (const [brand, fitCat, misCat] of CASES) {
  const a = await discover(brand, fitCat);
  const b = await discover(brand, misCat);
  const basis = a.j?.brand?.basis ?? b.j?.brand?.basis;
  const fa = scores(a.j), fb = scores(b.j);
  let wins = 0, ties = 0;
  for (const x of fa) for (const y of fb) x.fit > y.fit ? wins++ : x.fit === y.fit && ties++;
  const pairs = fa.length * fb.length;
  const row = {
    brand, basis, fitCat, misCat,
    fitN: fa.length, misN: fb.length,
    fitMean: +mean(fa.map((x) => x.fit)).toFixed(1), misMean: +mean(fb.map((x) => x.fit)).toFixed(1),
    winRate: pairs ? +((wins + ties / 2) / pairs).toFixed(2) : null,
    fitTop: fa[0] ? `${fa[0].name} ${fa[0].fit}` : '—', misTop: fb[0] ? `${fb[0].name} ${fb[0].fit}` : '—',
    notes: [a, b].filter((x) => x.status !== 200 || x.j?.status !== 'completed').map((x) => `${x.status} ${x.j?.error || x.j?.errorMessage || x.j?.status}`).join('; '),
    fitScores: fa, misScores: fb,
  };
  row.gap = +(row.fitMean - row.misMean).toFixed(1);
  row.direction = Number.isNaN(row.gap) ? 'n/a' : row.gap > 0 ? 'correct' : 'WRONG';
  rows.push(row);
  console.log(`${brand} (${basis}): ${fitCat} ${row.fitMean} (n=${row.fitN}) vs ${misCat} ${row.misMean} (n=${row.misN}) · gap ${row.gap} · win rate ${row.winRate} · ${row.direction}${row.notes ? ` · ${row.notes}` : ''}`);
}
writeFileSync(out, JSON.stringify(rows, null, 1));
const ok = rows.filter((r) => r.direction !== 'n/a');
console.log(`\nDirection correct: ${ok.filter((r) => r.direction === 'correct').length} of ${ok.length} brands · mean win rate ${mean(ok.map((r) => r.winRate)).toFixed(2)}`);
