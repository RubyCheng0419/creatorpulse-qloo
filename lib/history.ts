import { useSyncExternalStore } from 'react';
import type { Match } from '@/lib/match';
import { logScore } from '@/lib/score-log';

// Browser-only match history (PRODUCT_SPEC §8: localStorage is enough for now).
// Storage can be unavailable (private mode, blocked site data), so every access is guarded.

const KEY = 'creatorpulse:matches';
const MAX_ENTRIES = 30;
const CHANGE_EVENT = 'creatorpulse:history';

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): Match[] {
  try {
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function listMatches(): Match[] {
  return parse(readRaw());
}

// Newest first; re-running the same pair replaces its previous entry (same id). Its score
// also goes to the score log (lib/score-log), which keeps the pair's recent runs.
export function saveMatch(match: Match): void {
  logScore(match);
  try {
    const rest = listMatches().filter((m) => m.id !== match.id);
    window.localStorage.setItem(KEY, JSON.stringify([match, ...rest].slice(0, MAX_ENTRIES)));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // History is a convenience; the result is still shown.
  }
}

// useSyncExternalStore needs a stable snapshot, so re-parse only when the raw string changes.
let cachedRaw: string | null | undefined;
let cachedList: Match[] = [];

function snapshot(): Match[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parse(raw);
  }
  return cachedList;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange); // other tabs
  window.addEventListener(CHANGE_EVENT, onChange); // this tab
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

// null while rendering on the server, where there is no localStorage.
export function useMatches(): Match[] | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
