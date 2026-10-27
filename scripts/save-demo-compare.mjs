// Saves the demo comparison (one brand, three creators) to public/demo-compare.json.
// Run with a server up:
//   node scripts/save-demo-compare.mjs [base-url]
// Apple × MKBHD is taken from data/demo-snapshot.json, so the comparison and the one-click
// demo show the same run; the other two are live, LLM-backed runs, refused otherwise.

import { readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:3000';
const BRAND = { brandName: 'Apple', category: 'Technology' };
const CHANNELS = [
  'https://www.youtube.com/@LinusTechTips', // another tech reviewer
  'https://www.youtube.com/@NikkieTutorials', // a beauty creator: the expected mismatch
];

const matches = [JSON.parse(readFileSync(new URL('../data/demo-snapshot.json', import.meta.url), 'utf8'))];
for (const [i, url] of CHANNELS.entries()) {
  if (i) await new Promise((r) => setTimeout(r, 13_000)); // 5 matches per minute
  const r = await fetch(`${base}/api/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...BRAND, videoUrls: [url], live: true }),
  });
  const match = await r.json();
  if (!r.ok) throw Error(`${url}: HTTP ${r.status}: ${match.error}`);
  if (match.status !== 'completed') throw Error(`${url}: not completed: ${match.errorMessage}`);
  if (match.creator.keywordSource === 'unavailable') throw Error(`${url}: no LLM extracted names; refusing to save a degraded result.`);
  matches.push(match);
  console.log(`${url}: Fit ${match.compatibility.fitScore}, ${match.compatibility.confidence}, scored from ${match.scoreBasis}`);
}

const out = { brandName: BRAND.brandName, savedAt: new Date().toISOString(), matches };
writeFileSync(new URL('../public/demo-compare.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`saved ${matches.length} matches to public/demo-compare.json`);
