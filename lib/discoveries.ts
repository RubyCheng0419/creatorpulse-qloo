import { useSyncExternalStore } from 'react';
import type { Discovery } from '@/lib/discover';
import type { DiscoverRequest } from '@/lib/share-link';
import type { YouTubeChannel } from '@/lib/youtube-channel';

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

// The channel the user linked for one creator of a stored ranking (creator page), kept with it.
export function linkChannel(discoveryId: string, qlooId: string, channel: YouTubeChannel): void {
  try {
    const list = parse(readRaw()).map((d) =>
      d.id !== discoveryId ? d : { ...d, candidates: d.candidates.map((c) => (c.qlooId === qlooId ? { ...c, channel, channelLinked: true } : c)) }
    );
    window.localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage blocked: the link isn't kept.
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
