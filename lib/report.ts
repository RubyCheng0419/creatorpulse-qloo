import type { Match } from '@/lib/match';
import { Compatibility, DIVERGENCE_MAX, INTERSECTION_MIN, ScoredEntity, Verdict, confidenceLevel } from '@/lib/scoring';
import { parseVideoId } from '@/lib/youtube-url';

// PRODUCT_SPEC v3.1 §6 step 4 / §7. Template-based: every sentence is assembled
// from scored Qloo entities, so each claim maps to the evidence chain in
// compatibility.dimensions. No LLM writes or edits this text.

export interface Report {
  summary: string;
  cultureClash: string;
  recommendations: string[];
  risks: string[];
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  high: 'Strong fit',
  medium: 'Moderate fit',
  low: 'Weak fit',
  'no-match': 'No fit',
  'insufficient-data': 'Insufficient data',
};

// What the brand side was built from, when it isn't the brand itself. Shown on the result
// page (and so in the PDF) and in the Markdown export.
export function brandBasisNote(brand: {
  basis?: string;
  signal?: { name: string }[];
  tags?: { id: string; name: string }[];
  imageTags?: { id: string; name: string }[];
}): string | null {
  const names = (brand.signal ?? []).map((e) => e.name).join(', ');
  const fromImage = new Set((brand.imageTags ?? []).map((t) => t.id));
  const textTags = (brand.tags ?? []).filter((t) => !fromImage.has(t.id));
  const notes = [
    textTags.length ? `Includes tag-based signal: ${textTags.map((t) => t.name).join(', ')}.` : '',
    fromImage.size ? `Includes tags inferred from your key visual: ${(brand.imageTags ?? []).map((t) => t.name).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (brand.basis === 'reference') return `Your brand isn’t in Qloo. Scored against your reference brands: ${names}.${notes ? ` ${notes}` : ''}`;
  if (brand.basis === 'description') return `Scored from your brand description: the Qloo entities it names (${names}).${notes ? ` ${notes}` : ''}`;
  if (brand.basis === 'style') {
    const style = textTags.map((t) => t.name).join(', ');
    const image = fromImage.size ? ` Includes tags inferred from your key visual: ${(brand.imageTags ?? []).map((t) => t.name).join(', ')}.` : '';
    return `Your brand isn’t in Qloo. Scored from your brand’s style, as Qloo taste tags: ${style}${names ? `, with ${names}` : ''}.${image}`;
  }
  return notes || null;
}

const fmt = (a: number) => a.toFixed(2);
const quote = (names: string[]) => names.map((n) => `“${n}”`).join(', ');
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const possessive = (name: string) => `${name}${/s$/i.test(name) ? '’' : '’s'}`;

// The Summary is a decision, not a restatement: Decision (Go / Conditional / Hold with one
// condition), Why (from the scored entities), one Next step tied to that evidence, and what
// the confidence level means for the decision. Template-only, and every number in it is
// already in the result (dimension scores, affinities, entity counts).
export interface DecisionSummary {
  verdict: 'Go' | 'Conditional' | 'Hold';
  condition: string;
  why: string;
  next: string;
  confidence: string;
  lowReason?: string; // why confidence is Low, when it is
}

// What the summary needs beyond the scores: how the brand side and the creator side were built.
export interface SummaryContext {
  brand: string;
  basis?: string; // 'brand' | 'reference' | 'description' | 'style'
  brandSignal: string[]; // reference brands, or the entities a description names
  styleTags: string[];
  imageTags: string[];
  scoreBasis?: 'videos' | 'audience';
  person?: string; // the creator's Qloo person, for an audience-taste score
  fromChannel: boolean; // the videos are a channel's latest uploads, not the user's picks
}

export function summaryContext(match: Match): SummaryContext {
  const urls = match.creator.videoUrls;
  return {
    brand: match.brand.entity?.name || match.brand.name,
    basis: match.brand.basis,
    brandSignal: (match.brand.signal ?? []).map((e) => e.name),
    styleTags: (match.brand.tags ?? []).filter((t) => !(match.brand.imageTags ?? []).some((i) => i.id === t.id)).map((t) => t.name),
    imageTags: (match.brand.imageTags ?? []).map((t) => t.name),
    scoreBasis: match.scoreBasis,
    person: match.creator.qlooPerson?.name,
    fromChannel: urls.length === 1 && !parseVideoId(urls[0]),
  };
}

// Why the brand side only approximates the brand's audience, in a phrase, or null.
function approximatedBy(ctx: SummaryContext): string | null {
  const parts: string[] = [];
  if (ctx.basis === 'reference') parts.push(`approximated by reference brands (${list(ctx.brandSignal)})`);
  if (ctx.basis === 'description') parts.push(`approximated from the entities its description names (${list(ctx.brandSignal)})`);
  if (ctx.basis === 'style') parts.push(`approximated from its style, as Qloo taste tags (${list(ctx.styleTags)})`);
  if (ctx.imageTags.length) parts.push(`partly read from a key visual (${list(ctx.imageTags)})`);
  return parts.length ? `the brand side is ${parts.join(' and ')}` : null;
}

// A clash this widespread is called a real clash; a stray one isn't what decides a weak score.
const REAL_CLASH_MIN = 3;
const REAL_CLASH_SHARE = 0.1;

export function decisionSummary(c: Compatibility, ctx: SummaryContext): DecisionSummary | null {
  if (c.fitScore === null || !c.confidence) return null;
  const scored = c.dimensions.filter((d) => d.score !== null).sort((a, b) => b.score! - a.score!);
  if (!scored.length) return null;
  const best = scored[0];
  const worst = scored[scored.length - 1];
  const entities = c.dimensions.flatMap((d) => [...d.intersection, ...d.weakLink, ...d.divergence].map((e) => ({ e, dim: d.label })));
  const byAffinity = [...entities].sort((a, b) => b.e.brandAffinity - a.e.brandAffinity);
  const loved = entities.filter((x) => x.e.brandAffinity >= INTERSECTION_MIN);
  const clashes = entities.filter((x) => x.e.brandAffinity < DIVERGENCE_MAX).sort((a, b) => a.e.brandAffinity - b.e.brandAffinity);
  const clashDims = [...new Set(clashes.map((x) => x.dim))].sort(
    (a, b) => clashes.filter((x) => x.dim === b).length - clashes.filter((x) => x.dim === a).length
  );
  const realClash = clashes.length >= REAL_CLASH_MIN || (clashes.length > 0 && clashes.length / entities.length >= REAL_CLASH_SHARE);
  const audience = possessive(ctx.brand) + ' audience';

  // Confidence: what the level rests on, and for Low, why it is Low.
  const approx = approximatedBy(ctx);
  const basis = c.confidenceBasis;
  const named = basis?.entities ?? entities.filter((x) => x.e.side === 'direct').length;
  const dimCount = basis?.dimensions ?? scored.length;
  const fromAudience = ctx.scoreBasis === 'audience';
  const thinEvidence = !fromAudience && basis ? confidenceLevel(basis) === 'Low' : false;
  const low = c.confidence === 'Low';
  let lowReason = '';
  let lowNext = '';
  if (low) {
    if (fromAudience) {
      lowReason = `the score comes from ${ctx.person ? possessive(ctx.person) : 'the creator’s'} audience taste in Qloo, not from what the videos name`;
      lowNext = `Add 2–3 of the creator’s videos whose titles or descriptions explicitly name brands, products or topics.`;
    } else if (thinEvidence || !approx) {
      lowReason = `only ${named} ${named === 1 ? 'entity' : 'entities'} named in the videos ${named === 1 ? 'was' : 'were'} scored`;
      lowNext = ctx.fromChannel
        ? `Paste 2–3 of the creator’s videos that explicitly name brands, products or topics: the channel’s latest uploads named too few.`
        : `Add 2–3 videos whose titles or descriptions explicitly name brands, products or topics.`;
    } else {
      lowReason = approx;
      lowNext =
        ctx.basis === 'reference'
          ? `Check that the reference brands share your audience${ctx.brandSignal.length < 3 ? ', and add one or two more that are in Qloo' : ''}.`
          : `Add 1–3 reference brands with a similar audience that are in Qloo: they stand in for your audience more closely than ${ctx.basis === 'style' ? 'style tags' : 'a description'}.`;
    }
  }
  const confidence = low
    ? `Low: indicative only, because ${lowReason}. Collect more evidence before acting on it.`
    : fromAudience
      ? `${c.confidence}: scored from ${ctx.person ? possessive(ctx.person) : 'the creator’s'} audience taste in Qloo, not from what the videos name.${approx ? ` One level lower than the evidence alone, because ${approx}.` : ''}`
      : `${c.confidence}: based on ${named} named ${named === 1 ? 'entity' : 'entities'} across ${dimCount === 5 ? 'all 5' : dimCount} dimensions${c.confidence === 'Medium' ? '; a re-run can move the score a few points' : ''}.${approx ? ` One level lower than the evidence alone, because ${approx}.` : ''}`;

  // Why: the strongest and weakest dimensions, the strongest shared tastes, and the cause.
  const top = byAffinity.slice(0, 3);
  const origins = new Set(top.map((x) => x.e.side));
  const topText = top.map((x) => `${x.e.name} ${fmt(x.e.brandAffinity)}${origins.size > 1 && x.e.side === 'direct' ? ' (in the videos)' : ''}`);
  const originNote =
    origins.size > 1 || fromAudience ? '' : origins.has('direct') ? ', all named in the videos' : ', all related by Qloo rather than named in the videos';
  const dimsText = worst !== best ? `strongest on ${best.label} (${best.score}) and weakest on ${worst.label} (${worst.score})` : `scored on ${best.label} (${best.score})`;
  const sharedText = loved.length
    ? `The strongest shared tastes are ${list(topText)}${originNote}.`
    : `No entity reaches ${INTERSECTION_MIN}; the highest is ${topText[0]}.`;
  const lowest = clashes[0];
  const cause = realClash
    ? `A real clash: ${clashes.length} ${clashes.length === 1 ? 'entity is' : 'entities are'} below ${DIVERGENCE_MAX.toFixed(2)}, mostly in ${clashDims[0]} (lowest: ${lowest.e.name} ${fmt(lowest.e.brandAffinity)}).`
    : clashes.length
      ? `${clashes.length === 1 ? 'One clash' : `${clashes.length} clashes`} (${lowest.e.name} ${fmt(lowest.e.brandAffinity)}), ${
          loved.length * 2 >= entities.length ? (clashes.length === 1 ? 'an isolated one' : 'isolated ones') : 'but most entities are lukewarm'
        }: ${loved.length} of ${entities.length} entities reach ${INTERSECTION_MIN}.`
      : c.fitScore < 60
        ? `No clash, but also no strong overlap: ${loved.length} of ${entities.length} entities reach ${INTERSECTION_MIN}.`
        : `No clash: every entity is at ${DIVERGENCE_MAX.toFixed(2)} or above.`;
  const why = `${audience} is ${dimsText}. ${sharedText} ${cause}`;

  // Decision and the one next step that follows from it.
  const avoidDim = realClash ? clashDims[0] : worst.label;
  const bestTop = byAffinity.find((x) => x.dim === best.label);
  let verdict: DecisionSummary['verdict'];
  let condition: string;
  let next: string;
  if (low) {
    verdict = 'Hold';
    condition = 'collect more evidence before deciding.';
    next = lowNext;
  } else if (c.fitScore >= 80) {
    verdict = 'Go';
    condition = clashes.length ? `keep ${clashDims[0]} out of the brief.` : `lead the brief with ${best.label}.`;
    next = `Brief the creator on ${list(top.slice(0, 2).map((x) => x.e.name))}, the strongest shared tastes${lowest ? `, and leave ${lowest.e.name} out` : ''}.`;
  } else if (c.fitScore >= 60) {
    verdict = 'Conditional';
    condition = `go ahead if the brief leaves ${avoidDim} out.`;
    next = `Build the pitch on ${best.label} first${bestTop ? `, starting with ${bestTop.e.name}` : ''}.`;
  } else if (realClash) {
    verdict = 'Hold';
    condition = `the audiences clash on ${clashDims[0]}.`;
    next = `Compare creators for ${ctx.brand} whose world sits in ${best.label} rather than ${clashDims[0]}.`;
  } else {
    verdict = 'Hold';
    condition = 'run one small test before signing.';
    next = `Compare 2–3 other creators for ${ctx.brand} first: a lukewarm score needs a reference point before a test integration.`;
  }
  return { verdict, condition, why, next, confidence, ...(low ? { lowReason } : {}) };
}

export function summaryText(d: DecisionSummary): string {
  return `Decision — ${d.verdict}: ${d.condition} Why: ${d.why} Next step: ${d.next} Confidence — ${d.confidence}`;
}

export function buildReport(
  brand: string,
  creator: string,
  c: Compatibility,
  items: ScoredEntity[],
  shared: ScoredEntity[],
  context: SummaryContext
): Report {
  const scored = c.dimensions.filter((d) => d.score !== null);
  const missing = c.dimensions.filter((d) => d.score === null);
  const labelOf = (e: ScoredEntity) => c.dimensions.find((d) => d.dimension === e.dimension)!.label;

  // The page rebuilds the summary from the scores (decisionSummary), so older results get it too;
  // this copy is for the API and the Agent Trace.
  const decision = decisionSummary(c, context);
  const summary = decision ? summaryText(decision) : `${brand} × ${creator}: no score.`;

  const clash = scored
    .filter((d) => d.divergence.length)
    .map(
      (d) =>
        `${d.label}: ${d.divergence
          .slice(0, 3)
          .map((e) => `${e.name} (affinity ${fmt(e.brandAffinity)})`)
          .join(', ')} relate${d.divergence.length === 1 ? 's' : ''} weakly to ${brand}'s audience (below ${DIVERGENCE_MAX}).`
    );
  if (!clash.length) clash.push(`No evidence of conflicting taste: every scored entity has affinity of at least ${DIVERGENCE_MAX}.`);
  if (missing.length) {
    clash.push(
      `${missing.map((d) => d.label).join(', ')}: no scorable Qloo data, excluded from the score. Missing data is not evidence of a clash.`
    );
  }

  const strongest = items.filter((e) => e.brandAffinity >= INTERSECTION_MIN).sort((a, b) => b.brandAffinity - a.brandAffinity);
  const recommendations: string[] = [];
  if (shared.length) {
    recommendations.push(
      `${quote(shared.map((e) => e.name))} appear both in the creator's taste graph and among ${brand}'s Qloo cultural proxies: the most direct angle for a collaboration.`
    );
  }
  for (const e of strongest.filter((e) => !shared.includes(e))) {
    if (recommendations.length >= 3) break;
    recommendations.push(`Build content around “${e.name}” (${labelOf(e)}, affinity ${fmt(e.brandAffinity)}); ${brand}'s audience relates to it strongly.`);
  }
  if (!recommendations.length) {
    recommendations.push(`No shared taste entity reaches affinity ${INTERSECTION_MIN}; taste fit should not be the basis for this collaboration.`);
  }

  const risks: string[] = items
    .filter((e) => e.brandAffinity < DIVERGENCE_MAX)
    .sort((a, b) => a.brandAffinity - b.brandAffinity)
    .slice(0, 2)
    .map((e) => `Avoid “${e.name}” as a collaboration theme (${labelOf(e)}, affinity ${fmt(e.brandAffinity)}).`);
  // The actual reason for Low (few named entities, or an approximated brand side), once.
  if (decision?.lowReason) risks.push(`Low confidence: ${decision.lowReason}; treat the result as indicative.`);
  const direct = items.filter((e) => e.side === 'direct').length;
  if (direct < 5 && context.scoreBasis !== 'audience' && !decision?.lowReason?.startsWith('only'))
    risks.push(`Only ${direct} entities named in the creator's videos were scored; the sample is small.`);
  if (!risks.length) risks.push('No evidence-backed risks found.');

  return { summary, cultureClash: clash.join('\n\n'), recommendations, risks: risks.slice(0, 3) };
}
