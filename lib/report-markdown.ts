import type { Match } from '@/lib/match';
import { VERDICT_LABELS, brandBasisNote } from '@/lib/report';
import type { ScoredEntity } from '@/lib/scoring';
import { summarizeTrace } from '@/lib/trace';

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
  const brand = match.brand.entity?.name || match.brand.name;
  const creator = match.creator.channelName || 'Creator';
  const lines: string[] = [
    `# ${brand} × ${creator}${match.creator.youtubeHandle ? ` (${match.creator.youtubeHandle})` : ''}`,
    '',
    'CreatorPulse cultural compatibility due diligence',
    '',
    `- **Fit Score:** ${c.fitScore ?? 'no score'}${c.fitScore !== null ? '/100' : ''}`,
    `- **Confidence:** ${typeof c.confidence === 'string' ? c.confidence : '—'}${c.confidenceBasis && 'entities' in c.confidenceBasis ? ` (based on ${c.confidenceBasis.entities} confirmed entities across ${c.confidenceBasis.dimensions} dimensions)` : ''}`,
    `- **Verdict:** ${VERDICT_LABELS[c.verdict]}`,
    `- **Date:** ${match.createdAt.slice(0, 10)} · Report ${match.id}`,
  ];
  const basisNote = brandBasisNote(match.brand);
  if (basisNote) lines.push(`- **Brand side:** ${basisNote} Confidence is one level lower than the evidence alone would give.`);
  if (match.cachedAt) lines.push(`- **Cached result** from ${match.cachedAt}: the live analysis could not complete.`);
  if (match.mentionsBrand) lines.push(`- The creator already features ${brand} in these videos; that mention is not scored.`);
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
      lines.push(
        ...tier('Shared taste (affinity ≥ 0.85)', d.intersection),
        ...tier('Weak link (0.70–0.85)', d.weakLink),
        ...tier('Clash (affinity < 0.70)', d.divergence)
      );
    }
    const r = match.report;
    lines.push(
      '## Summary',
      '',
      r.summary,
      '',
      '## Culture clash',
      '',
      r.cultureClash,
      '',
      '## Recommendations',
      '',
      ...r.recommendations.map((x) => `- ${x}`),
      '',
      '## Risks',
      '',
      ...r.risks.map((x) => `- ${x}`),
      ''
    );
  }

  const trace = match.trace ?? [];
  if (trace.length) {
    const sum = summarizeTrace(trace);
    lines.push(
      '## Agent Trace summary',
      '',
      `${sum.youtube} YouTube calls · ${sum.gemini} Gemini call${sum.gemini === 1 ? '' : 's'} · ${sum.qlooLive + sum.qlooCached} Qloo calls (${sum.qlooLive} live, ${sum.qlooCached} from cache) · ${sum.decisions} decisions${match.liveRun ? ' · live run (cache bypassed)' : ''}`,
      '',
      ...trace
        .filter((s) => s.tool === 'Rule' || s.tool.startsWith('Gemini'))
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
