import { useSyncExternalStore } from 'react';
import type { Discovery } from '@/lib/discover';
import type { DiscoverRequest } from '@/lib/share-link';

// The last few rankings, browser-only like the match history (lib/history), so each ranked
// creator can open its own page (/discover/<ranking id>/<Qloo id>). The request is kept for
// the video deep dive and the share link. Storage can be unavailable, so every access is guarded.

export type StoredDiscovery = Discovery & { request: DiscoverRequest };

const KEY = 'creatorpulse:discoveries';
const MAX_ENTRIES = 5; // a ranking with its evidence is ~150 KB
const CHANGE_EVENT = 'creatorpulse:discoveries';

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): StoredDiscovery[] {
  try {
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Newest first; the same inputs found again replace their entry (same id).
export function saveDiscovery(d: Discovery, request: DiscoverRequest): void {
  try {
    const rest = parse(readRaw()).filter((x) => x.id !== d.id);
    window.localStorage.setItem(KEY, JSON.stringify([{ ...d, request }, ...rest].slice(0, MAX_ENTRIES)));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Too big for the quota or storage blocked: the ranking is still shown, its pages won't open.
  }
}

export function getDiscovery(id: string): StoredDiscovery | null {
  return parse(readRaw()).find((d) => d.id === id) ?? null;
}

// useSyncExternalStore needs a stable snapshot, so re-parse only when the raw string changes.
let cachedRaw: string | null | undefined;
let cachedList: StoredDiscovery[] = [];

function snapshot(): StoredDiscovery[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parse(raw);
  }
  return cachedList;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

// null while rendering on the server, where there is no localStorage.
export function useDiscoveries(): StoredDiscovery[] | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

export const creatorPageHref = (discoveryId: string, qlooId: string) => `/discover/${encodeURIComponent(discoveryId)}/${encodeURIComponent(qlooId)}`;
