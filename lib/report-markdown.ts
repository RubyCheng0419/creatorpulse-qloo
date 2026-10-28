import type { Match } from '@/lib/match';
import { HOLD_RECOMMENDATION, VERDICT_LABELS, brandBasisNote, decisionSummary, summaryContext } from '@/lib/report';
import { type ScoredEntity, isByDefault, isCounted } from '@/lib/scoring';
import { matchUnverified } from '@/lib/unverified';
import { isLlm, summarizeTrace } from '@/lib/trace';

// The result page as a Markdown file, for judges and brand teams to take away.
// Everything comes from the match itself, including the report text written by
// lib/report.ts; nothing here adds new claims.

const DISCLAIMER =
  'Scores are based on Qloo’s taste graph and the creator’s public video metadata. No audience personal data is used. Dimensions without data are excluded from the score.';

function entityLine(e: ScoredEntity): string {
  const source = e.side === 'direct' ? `named in the videos (“${e.query}”)` : 'cross-domain expansion';
  return `- ${e.name} (${e.type.replace('urn:entity:', '')}), affinity ${e.brandAffinity.toFixed(2)}, ${source}, Qloo ID \`${e.id}\``;
}

function tier(title: string, items: ScoredEntity[] | undefined): string[] {
  return [`**${title}**`, ...(items?.length ? items.map(entityLine) : ['- none']), ''];
}

export function matchToMarkdown(match: Match): string {
  const c = match.compatibility;
  const unverified = matchUnverified(match);
  const brand = match.brand.entity?.name || match.brand.name;
  const creator = match.creator.channelName || 'Creator';
  const lines: string[] = [
    `# ${brand} × ${creator}${match.creator.youtubeHandle ? ` (${match.creator.youtubeHandle})` : ''}`,
    '',
    'CreatorPulse cultural compatibility due diligence',
    '',
    `- **Fit Score:** ${c.fitScore ?? 'no score'}${c.fitScore !== null ? '/100' : ''}`,
    `- **Confidence:** ${typeof c.confidence === 'string' ? c.confidence : '—'}${c.confidenceBasis && 'entities' in c.confidenceBasis ? ` (based on ${c.confidenceBasis.entities} confirmed entities across ${c.confidenceBasis.dimensions} dimensions)` : ''}`,
    unverified.length
      ? `- **Verdict:** Unverified, do not use for a decision (${unverified.map((r) => `${r.code} ${r.label}: ${r.detail}`).join(' ')})`
      : `- **Verdict:** ${VERDICT_LABELS[c.verdict]}`,
    `- **Date:** ${match.createdAt.slice(0, 10)} · Report ${match.id}`,
  ];
  const basisNote = brandBasisNote(match.brand);
  if (basisNote) lines.push(`- **Brand side:** ${basisNote} Confidence is one level lower than the evidence alone would give.`);
  if (match.scoreBasis === 'audience' && match.creator.qlooPerson)
    lines.push(`- **Score basis:** ${match.creator.qlooPerson.name}’s audience taste in Qloo; the videos named fewer than 3 Qloo entities.`);
  if (match.creator.qlooPerson && typeof match.creator.audienceOverlap === 'number')
    lines.push(`- **Audience overlap:** ${match.creator.audienceOverlap.toFixed(2)} (the brand audience’s affinity for ${match.creator.qlooPerson.name}; not scored)`);
  if (match.cachedAt)
    lines.push(
      match.cachedReason === 'fallback'
        ? `- **Cached result** from ${match.cachedAt}: the live run could not complete.`
        : `- **Cached demo result**: a real run of the full pipeline from ${match.cachedAt}, saved so the demo spends no API quota.`
    );
  if (match.mentionsBrand) lines.push(`- The creator already features ${brand} in these videos; that mention is not scored.`);
  const cov = match.priorCoverage;
  if (cov)
    lines.push(
      `- **Prior coverage (YouTube, CreatorPulse’s own tier, not part of the Fit Score):** ${cov.tier} · ${cov.mentioning.length} / ${cov.videosRead} videos mention ${brand}${cov.latest ? `, latest ${cov.latest.slice(0, 10)}` : ''}. Based on these ${cov.videosRead} videos only, not the creator’s full channel history.`,
      ...cov.mentioning.map((m) => `  - [${m.title}](${m.url}) — ${m.snippet.place}: “${m.snippet.text}”`)
    );
  lines.push('');

  if (match.status !== 'completed' || !match.report) {
    lines.push('## Insufficient data', '', match.errorMessage || 'No score was given.', '');
  } else {
    lines.push('## Taste dimensions', '');
    for (const d of c.dimensions) {
      lines.push(`### ${d.label}: ${d.score ?? 'no data'}`, '');
      if (d.score === null) {
        lines.push('No scorable Qloo data; excluded from the total.', '');
        continue;
      }
      if (!isCounted(d)) lines.push(`_Thin: ${d.itemCount} entit${d.itemCount === 1 ? 'y' : 'ies'}, shown but not counted in the Fit Score._`, '');
      if (isByDefault(d)) lines.push('_Classified by default: none of these entities has a Qloo genre for this dimension, so it decides nothing._', '');
      lines.push(
        ...tier('Shared taste (affinity ≥ 0.85)', d.intersection),
        ...tier('Lukewarm (affinity 0.70–0.85)', d.weakLink),
        ...tier('Clash (affinity < 0.70)', d.divergence)
      );
    }
    const r = match.report;
    const d = decisionSummary(match.compatibility, summaryContext(match));
    lines.push(
      '## Summary',
      '',
      ...(d
        ? [
            `- **Decision — ${d.verdict} (Fit ${d.fitScore}, ${d.level} confidence):** ${d.condition}`,
            `- **Why:** ${d.why}`,
            ...(d.familiarity ? [`- **Familiarity:** ${d.familiarity}`] : []),
            `- **Next step:** ${d.next}`,
            `- **Confidence — ${d.confidence.replace(/^(\w+): /, '$1:** ')}`,
          ]
        : [r.summary]),
      '',
      '## Culture clash',
      '',
      r.cultureClash,
      '',
      '## Recommendations',
      '',
      ...(d?.verdict === 'Hold' ? [HOLD_RECOMMENDATION] : r.recommendations).map((x) => `- ${x}`),
      '',
      '## Risks',
      '',
      ...r.risks.map((x) => `- ${x}`),
      ''
    );
    const cross = match.crossCheck;
    if (cross) {
      lines.push('## Cross-check: Qloo tag comparison (GET /v2/analysis/compare; not part of the Fit Score)', '');
      if ('skipped' in cross) lines.push(`Not run: ${cross.skipped}`, '');
      else
        lines.push(
          `- **Shared tags:** ${cross.shared.length ? cross.shared.map((t) => `${t.name} ${t.score.toFixed(2)}`).join(', ') : 'none'}`,
          `- **${cross.brandEntities.join(', ')}:** ${cross.brandTags.map((t) => t.name).join(', ') || 'none'}`,
          `- **Creator (${cross.creatorEntities.length} confirmed entities):** ${cross.creatorTags.map((t) => t.name).join(', ') || 'none'}`,
          ''
        );
    }
    if (match.expansion)
      lines.push(
        `_Related-by-Qloo entities: Qloo popularity ≥ ${match.expansion.popularityMin} (filter.popularity.min)${match.expansion.excludesBrand ? ', brand side excluded (filter.exclude.entities)' : ''}, contributors from feature.explainability. Scoring applies no popularity filter._`,
        ''
      );
  }

  const trace = match.trace ?? [];
  if (trace.length) {
    const sum = summarizeTrace(trace);
    lines.push(
      '## Agent Trace summary',
      '',
      `${sum.youtube} YouTube calls · ${sum.llm} LLM call${sum.llm === 1 ? '' : 's'} · ${sum.qlooLive + sum.qlooCached} Qloo calls (${sum.qlooLive} live, ${sum.qlooCached} from cache) · ${sum.decisions} decisions${match.liveRun ? ' · live run (cache bypassed)' : ''}`,
      '',
      ...trace
        .filter((s) => s.tool === 'Rule' || isLlm(s.tool))
        .map((s) => `- **${s.tool === 'Rule' ? 'Decision' : s.tool}:** ${s.output}${s.decision ? ` → ${s.decision}` : ''}`),
      ''
    );
  }

  lines.push(
    '## Sources',
    '',
    ...match.creator.videos.map((v) => `- [${v.title}](https://www.youtube.com/watch?v=${v.videoId})`),
    '',
    `_${DISCLAIMER}_`,
    ''
  );
  return lines.join('\n');
}

export function downloadMarkdown(match: Match): void {
  const brand = match.brand.entity?.name || match.brand.name;
  const name = `CreatorPulse_${brand}_${match.creator.channelName || 'creator'}_${match.createdAt.slice(0, 10)}.md`.replace(/[\\/:*?"<>|\s]+/g, '_');
  const url = URL.createObjectURL(new Blob([matchToMarkdown(match)], { type: 'text/markdown;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
