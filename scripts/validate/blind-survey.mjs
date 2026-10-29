// Validation 3: blind human judgment.
//   make:  node blind-survey.mjs make <validate-sponsors.json> <survey.csv>
//          One block per brand, the creators in a shuffled order, no scores: each rater fills
//          "rank" (1 = best fit for this brand) and saves the file under their own name.
//   score: node blind-survey.mjs score <validate-sponsors.json> <filled.csv>...
//          Spearman correlation between each rater's ranks and CreatorPulse's Fit, per brand,
//          and between raters (how much people agree with each other: the ceiling to compare to).
import { readFileSync, writeFileSync } from 'node:fs';
const [mode, scoresFile, ...files] = process.argv.slice(2);
const results = JSON.parse(readFileSync(scoresFile, 'utf8'));
const NAMES = { '@mkbhd': 'Marques Brownlee (MKBHD)', '@LinusTechTips': 'Linus Tech Tips', '@Joeman': 'Joeman', '@MrBeast': 'MrBeast', '@dcrainmaker': 'DC Rainmaker', '@JoshuaWeissman': 'Joshua Weissman', '@aliabdaal': 'Ali Abdaal', '@NikkieTutorials': 'NikkieTutorials' };
const csvCell = (s) => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);

if (mode === 'make') {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lines = ['brand,creator,channel,rank (1 = best fit for this brand)'];
  for (const brand of Object.keys(results)) {
    const creators = Object.keys(results[brand]).filter((h) => results[brand][h].fit != null);
    for (let i = creators.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [creators[i], creators[j]] = [creators[j], creators[i]]; }
    for (const h of creators) lines.push([brand, NAMES[h] || h, `https://www.youtube.com/${h}`, ''].map(csvCell).join(','));
  }
  writeFileSync(files[0], '﻿' + lines.join('\r\n') + '\r\n');
  console.log(`Wrote ${lines.length - 1} rows to ${files[0]}`);
  process.exit(0);
}

const parse = (f) => readFileSync(f, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map((l) => {
  const cells = [...l.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1].replace(/^"|"$/g, '').replace(/""/g, '"'));
  return { brand: cells[0], channel: cells[2].replace('https://www.youtube.com/', ''), rank: Number(cells[3]) };
}).filter((r) => r.rank > 0);
const rankOf = (vals, higherIsBetter) => { const s = [...vals].sort((a, b) => (higherIsBetter ? b - a : a - b)); return vals.map((v) => { const first = s.indexOf(v), last = s.lastIndexOf(v); return (first + last) / 2 + 1; }); };
function spearman(a, b) {
  const n = a.length; if (n < 3) return NaN;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}
const raters = files.map((f) => ({ f, rows: parse(f) }));
const mean = (xs) => xs.filter((x) => !Number.isNaN(x)).reduce((a, b, _, arr) => a + b / arr.length, 0);
console.log('| brand | ' + raters.map((r) => r.f.split(/[\\/]/).pop()).join(' | ') + ' | raters agree with each other |');
for (const brand of Object.keys(results)) {
  const per = raters.map(({ rows }) => {
    const rs = rows.filter((r) => r.brand === brand && results[brand][r.channel]?.fit != null);
    return spearman(rankOf(rs.map((r) => results[brand][r.channel].fit), true), rankOf(rs.map((r) => r.rank), false));
  });
  const between = [];
  for (let i = 0; i < raters.length; i++) for (let j = i + 1; j < raters.length; j++) {
    const a = raters[i].rows.filter((r) => r.brand === brand), b = raters[j].rows.filter((r) => r.brand === brand);
    const common = a.filter((x) => b.some((y) => y.channel === x.channel));
    between.push(spearman(rankOf(common.map((x) => x.rank), false), rankOf(common.map((x) => b.find((y) => y.channel === x.channel).rank), false)));
  }
  console.log(`| ${brand} | ${per.map((x) => (Number.isNaN(x) ? '—' : x.toFixed(2))).join(' | ')} | ${between.length ? mean(between).toFixed(2) : '—'} |`);
}
console.log('\nSpearman: 1 = same order as CreatorPulse, 0 = unrelated, -1 = opposite. Compare with how much the raters agree with each other.');
