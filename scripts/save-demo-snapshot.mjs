// Saves a live /api/match result for the demo pair to data/demo-snapshot.json.
// Run with the dev server up:  node scripts/save-demo-snapshot.mjs [http://localhost:3000]
// Refuses to save anything but a completed, live, Gemini-backed result.

import { writeFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:3000';
// Keep in sync with lib/demo-pair.ts.
const input = {
  brandName: 'Apple',
  category: 'Technology',
  videoUrls: [
    'https://www.youtube.com/watch?v=_4ELeWAgMwo',
    'https://www.youtube.com/watch?v=ESABTN4VtrA',
    'https://www.youtube.com/watch?v=scwlR0QHGOk',
    'https://www.youtube.com/watch?v=QVv3mQzlrN0',
    'https://www.youtube.com/watch?v=_0G4OG39XjI',
  ],
};

const r = await fetch(`${base}/api/match`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(input),
});
const match = await r.json();

if (!r.ok) throw Error(`HTTP ${r.status}: ${match.error}`);
if (match.cachedAt) throw Error('Got the stored snapshot back, not a live run. Is a live API down?');
if (match.status !== 'completed') throw Error(`Not completed: ${match.errorMessage}`);
if (match.creator.keywordSource !== 'gemini') throw Error('Gemini was not used; refusing to save a degraded result.');

writeFileSync(new URL('../data/demo-snapshot.json', import.meta.url), JSON.stringify(match, null, 2) + '\n');
console.log(`Saved ${match.id}: Fit ${match.compatibility.fitScore}, confidence ${match.compatibility.confidence}, ${match.createdAt}`);
