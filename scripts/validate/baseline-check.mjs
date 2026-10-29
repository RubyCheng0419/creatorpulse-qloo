// Two-layer baseline check for the demo pairs, live runs.
//   Extraction layer: which LLM answered, which entities Qloo confirmed, whether Ridge was listed.
//     Differences here are the known LLM variance, not a regression.
//   Scoring layer: runs with the same confirmed entities must give the same Fit Score and
//     dimension scores. A difference here is a regression.
// Usage: node baseline-check.mjs <base> [appleRuns=4] [huggiesRuns=2]
const [base, appleRuns = '4', huggiesRuns = '2'] = process.argv.slice(2);
const MKBHD = ['_4ELeWAgMwo', 'ESABTN4VtrA', 'scwlR0QHGOk', 'QVv3mQzlrN0', '_0G4OG39XjI'].map((v) => `https://www.youtube.com/watch?v=${v}`);
const pairs = [
  ['Apple', Number(appleRuns), { videoUrls: MKBHD, brandName: 'Apple', category: 'Technology' }, [68, 75]],
  ['Huggies', Number(huggiesRuns), { videoUrls: MKBHD, brandName: 'Huggies' }, [36, 45]],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(body) {
  for (;;) {
    const r = await fetch(new URL('/api/match', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, live: true }) });
    const j = await r.json().catch(() => null);
    const wait = /wait (\d+) seconds/.exec(j?.error || '')?.[1];
    if (r.status === 429 && wait) { await sleep((Number(wait) + 1) * 1000); continue; }
    return j;
  }
}
let regressions = 0;
for (const [brand, n, body, [lo, hi]] of pairs) {
  const runs = [];
  for (let i = 0; i < n; i++) {
    const j = await post(body);
    const llm = (j.trace || []).filter((s) => /^(Gemini|Groq) \(/.test(s.tool) && s.ok !== false).map((s) => s.tool.split(' ')[0]).pop() || '?';
    const ents = (j.creator?.entities || []).map((e) => e.name).sort();
    const dims = (j.compatibility?.dimensions || []).map((d) => `${d.label.split(/[ ,&]/)[0]} ${d.score ?? '–'}${d.counted === false && d.score != null ? '(thin)' : ''}`).join(' · ');
    runs.push({ fit: j.compatibility?.fitScore, conf: j.compatibility?.confidence, llm, key: ents.join('|'), ents, dims, ridge: ents.includes('The Ridge') });
  }
  console.log(`\n## ${brand} × MKBHD, ${n} live runs (documented range ${lo}–${hi})`);
  runs.forEach((r, i) => console.log(`  run ${i + 1}: Fit ${r.fit} ${r.conf} · ${r.llm} · Ridge ${r.ridge ? 'yes' : 'no'} · ${r.ents.length} confirmed · ${r.dims}${r.fit < lo || r.fit > hi ? '  ← outside the documented range' : ''}`));
  const groups = new Map();
  for (const r of runs) groups.set(r.key, [...(groups.get(r.key) || []), r]);
  for (const [key, g] of groups) {
    const same = g.every((r) => r.fit === g[0].fit && r.dims === g[0].dims);
    if (!same) regressions++;
    console.log(`  scoring layer · ${g.length} run(s) with entities [${key.replace(/\|/g, ', ')}]: ${g.length < 2 ? 'single run, nothing to compare' : same ? `identical (Fit ${g[0].fit})` : `DIFFERENT: ${g.map((r) => r.fit).join(' / ')}  ← regression`}`);
  }
}
console.log(`\nScoring-layer regressions: ${regressions}`);
