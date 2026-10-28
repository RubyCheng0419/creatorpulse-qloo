import type { CreatorCandidate, Discovery } from '@/lib/discover';
import type { Match } from '@/lib/match';
import type { TraceStep } from '@/lib/trace';

// "Unverified — do not use for a decision" (debate/decision.md): the score is shown, but no
// verdict, a Hold decision and no content recommendations, with the reason. Judged per result,
// not per brand, and derived from what a result already stores, so saved results get it too.
//   E  broken evidence: a Qloo query that feeds the score failed after its retry (429, timeout)
//   L  thin evidence: Low confidence
//   I  unclear identity: videos from more than one channel, no YouTube channel for a ranked
//      person, or a Qloo person picked by the creator tag among namesakes
//   B  substituted basis: a creator check scored from the creator's audience taste instead of
//      the videos

export type UnverifiedCode = 'E' | 'L' | 'I' | 'B';
export interface UnverifiedReason {
  code: UnverifiedCode;
  label: string;
  detail: string;
  next: string; // the one step that would clear it
}

export const UNVERIFIED_LABELS: Record<UnverifiedCode, string> = {
  E: 'broken evidence',
  L: 'thin evidence',
  I: 'unclear identity',
  B: 'substituted basis',
};

const reason = (code: UnverifiedCode, detail: string, next: string): UnverifiedReason => ({ code, label: UNVERIFIED_LABELS[code], detail, next });

const RERUN = 'Run it again (Run live in the Agent Trace): a Qloo query failed, so part of the evidence is missing.';
const MORE_EVIDENCE = 'Collect more evidence before deciding.';
const NAMED_VIDEOS = 'Add 2–3 of the creator’s videos whose titles or descriptions explicitly name brands, products or topics, so the score comes from the videos.';

// Qloo queries that failed after the retry, in the stages that feed the score. The brand's own
// cultural proxies (shared entities only) and the cross-check (never scored) don't count, nor a
// query Qloo rejected (400): that one is the same every time, not missing data.
const MATCH_STAGES = ['creator', 'expand', 'score'];
export function failedScoringQueries(trace: TraceStep[] = [], stages = MATCH_STAGES): number {
  return trace.filter((s) => s.tool.startsWith('Qloo') && !s.ok && stages.includes(s.stage) && /gave up|no response/.test(s.http ?? '')).length;
}

const queries = (n: number) => `${n} Qloo quer${n === 1 ? 'y' : 'ies'}`;

export function matchUnverified(m: Match): UnverifiedReason[] {
  if (m.status !== 'completed' || m.compatibility.fitScore === null) return [];
  const out: UnverifiedReason[] = [];
  const failed = failedScoringQueries(m.trace);
  if (failed) out.push(reason('E', `${queries(failed)} failed after a retry, so part of the evidence is missing.`, RERUN));
  if (m.compatibility.confidence === 'Low') out.push(reason('L', 'Low confidence: too little evidence to decide on.', MORE_EVIDENCE));
  const channels = new Set(m.creator.videos.map((v) => v.channelId).filter(Boolean)).size;
  if (channels > 1)
    out.push(reason('I', `The videos come from ${channels} different channels, so the score mixes creators.`, 'Paste 2–3 videos from one creator’s channel only, then run it again.'));
  const person = m.creator.qlooPerson;
  if (m.scoreBasis === 'audience' && person && (person.namesakes ?? 0) > 1)
    out.push(reason('I', `Qloo has ${person.namesakes} people named ${person.name}; only the creator tag picked this one.`, NAMED_VIDEOS));
  if (m.scoreBasis === 'audience') out.push(reason('B', 'Scored from the creator’s audience taste in Qloo, because the videos named too little.', NAMED_VIDEOS));
  return out;
}

export function candidateUnverified(c: CreatorCandidate, d: Pick<Discovery, 'trace'>): UnverifiedReason[] {
  if (c.status !== 'scored') return [];
  const out: UnverifiedReason[] = [];
  // A creator's own profile queries show in failedTypes; the batched scoring calls affect everyone.
  const failed = failedScoringQueries(d.trace, ['score']);
  const rerun = 'Find the creators again (Run live in the Agent Trace): a Qloo query failed, so part of the evidence is missing.';
  if (c.profile.failedTypes.length) out.push(reason('E', `Qloo didn’t answer for ${c.profile.failedTypes.join(', ')}, so part of the profile is missing.`, rerun));
  else if (failed) out.push(reason('E', `${queries(failed)} failed after a retry, so part of the evidence is missing.`, rerun));
  if (c.compatibility.confidence === 'Low') out.push(reason('L', 'Low confidence: too little evidence to decide on.', MORE_EVIDENCE));
  if (!c.channel)
    out.push(reason('I', `No YouTube channel matched ${c.name}, so it isn’t clear which channel this person is.`, 'Check the creator’s channel by hand before using this score.'));
  return out;
}

// "E, L" for a compact cell; the details go in a title or a list.
export const codesText = (rs: UnverifiedReason[]) => rs.map((r) => r.code).join(', ');
