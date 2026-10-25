// Saves live /api/match results for the demo pairs to data/demo-snapshot*.json.
// Run with the dev server up:
//   node scripts/save-demo-snapshot.mjs [base-url] [fit|mismatch|all]
// Refuses to save anything but a completed, live, Gemini-backed result.

import { writeFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:3000';
const which = process.argv[3] || 'all';

// Keep in sync with lib/demo-pair.ts.
const videoUrls = [
  'https://www.youtube.com/watch?v=_4ELeWAgMwo',
  'https://www.youtube.com/watch?v=ESABTN4VtrA',
  'https://www.youtube.com/watch?v=scwlR0QHGOk',
  'https://www.youtube.com/watch?v=QVv3mQzlrN0',
  'https://www.youtube.com/watch?v=_0G4OG39XjI',
];
const PAIRS = {
  fit: { file: 'demo-snapshot.json', input: { brandName: 'Apple', category: 'Technology', videoUrls } },
  mismatch: { file: 'demo-snapshot-mismatch.json', input: { brandName: 'Huggies', videoUrls } },
};

for (const [key, { file, input }] of Object.entries(PAIRS)) {
  if (which !== 'all' && which !== key) continue;
  const r = await fetch(`${base}/api/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const match = await r.json();

  if (!r.ok) throw Error(`${key}: HTTP ${r.status}: ${match.error}`);
  if (match.cachedAt) throw Error(`${key}: got the stored snapshot back, not a live run. Is a live API down?`);
  if (match.status !== 'completed') throw Error(`${key}: not completed: ${match.errorMessage}`);
  if (match.creator.keywordSource !== 'gemini') throw Error(`${key}: Gemini was not used; refusing to save a degraded result.`);

  writeFileSync(new URL(`../data/${file}`, import.meta.url), JSON.stringify(match, null, 2) + '\n');
  const clashes = match.compatibility.dimensions.reduce((n, d) => n + d.divergence.length, 0);
  console.log(`${key}: saved ${match.id}: Fit ${match.compatibility.fitScore}, confidence ${match.compatibility.confidence}, ${clashes} clashes, ${match.createdAt}`);
}
