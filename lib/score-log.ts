import { useMemo, useSyncExternalStore } from 'react';
import type { Match } from '@/lib/match';

// Browser-only log of each pair's scores (one pair = one match id: same videos, same brand
// side), so a result can show its recent range instead of passing one run off as a fixed
// score. History keeps only the latest run per pair; this keeps up to MAX_RUNS of them.

const KEY = 'creatorpulse:score-log';
const MAX_RUNS = 10;

export interface LoggedRun {
  at: string; // the match's createdAt: a stored demo result served twice is one run
  fit: number;
  dims: Record<string, number | null>; // label → score
}

function read(): Record<string, LoggedRun[]> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const log = raw ? JSON.parse(raw) : {};
    return log && typeof log === 'object' ? log : {};
  } catch {
    return {};
  }
}

export function logScore(match: Match): void {
  const fit = match.compatibility.fitScore;
  if (fit === null) return;
  try {
    const log = read();
    const runs = (log[match.id] || []).filter((r) => r.at !== match.createdAt);
    const dims = Object.fromEntries(match.compatibility.dimensions.map((d) => [d.label, d.score]));
    log[match.id] = [{ at: match.createdAt, fit, dims }, ...runs].slice(0, MAX_RUNS);
    window.localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    // A convenience: the result is still shown without its range.
  }
}

// The raw log, as a stable snapshot for useSyncExternalStore; null on the server. saveMatch
// logs the score, then signals its change event, so a fresh result re-reads this.
function rawLog(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener('creatorpulse:history', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('creatorpulse:history', onChange);
  };
}

// Newest first, including the run on screen when it was logged; null while rendering on the server.
export function useRuns(id: string): LoggedRun[] | null {
  const raw = useSyncExternalStore(subscribe, rawLog, () => undefined);
  return useMemo(() => {
    if (raw === undefined) return null;
    try {
      const log = raw ? JSON.parse(raw) : {};
      return Array.isArray(log?.[id]) ? log[id] : [];
    } catch {
      return [];
    }
  }, [raw, id]);
}
