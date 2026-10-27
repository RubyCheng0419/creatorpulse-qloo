// The one-click demo pairs (PRODUCT_SPEC §3.3). Shared by the browser (prefills the
// form) and the server (serves a stored snapshot if a live run fails).
// See docs/DEMO_PAIR.md for why these pairs and how they were verified.

import { parseVideoId } from '@/lib/youtube-url';

const MKBHD_VIDEOS = [
  'https://www.youtube.com/watch?v=_4ELeWAgMwo',
  'https://www.youtube.com/watch?v=ESABTN4VtrA',
  'https://www.youtube.com/watch?v=scwlR0QHGOk',
  'https://www.youtube.com/watch?v=QVv3mQzlrN0',
  'https://www.youtube.com/watch?v=_0G4OG39XjI',
];

export interface DemoPair {
  key: 'fit' | 'mismatch';
  brandName: string;
  category: string;
  creatorLabel: string;
  videoUrls: string[];
  // Fit Scores of the live runs recorded in docs/DEMO_PAIR.md, shown as the pair's range.
  recorded: { min: number; max: number; period: string };
}

// Same creator, two brands: shows the score follows the brand, not the creator's fame.
export const DEMO_PAIRS: DemoPair[] = [
  { key: 'fit', brandName: 'Apple', category: 'Technology', creatorLabel: 'MKBHD', videoUrls: MKBHD_VIDEOS, recorded: { min: 69, max: 75, period: 'Oct 25–27, 2026' } },
  { key: 'mismatch', brandName: 'Huggies', category: '', creatorLabel: 'MKBHD', videoUrls: MKBHD_VIDEOS, recorded: { min: 36, max: 37, period: 'Oct 25–27, 2026' } },
];

export const DEMO_PAIR = DEMO_PAIRS[0];

const idsOf = (urls: unknown[]) => urls.map((u) => parseVideoId(String(u)) || '').sort().join(',');

export function findDemoPair(videoUrls: unknown, brandName: unknown): DemoPair | undefined {
  if (!Array.isArray(videoUrls)) return undefined;
  const brand = String(brandName || '').trim().toLocaleLowerCase();
  return DEMO_PAIRS.find((p) => idsOf(p.videoUrls) === idsOf(videoUrls) && p.brandName.toLocaleLowerCase() === brand);
}

export function isDemoInput(videoUrls: unknown, brandName: unknown): boolean {
  return Boolean(findDemoPair(videoUrls, brandName));
}
