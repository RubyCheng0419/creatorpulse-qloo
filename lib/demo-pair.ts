// The one-click demo pair (PRODUCT_SPEC §3.3). Shared by the browser (prefills the
// form) and the server (serves the stored snapshot if a live run fails).
// Chosen 2026-10-25; see docs/DEMO_PAIR.md for why and how it was verified.

import { parseVideoId } from '@/lib/youtube-url';

export const DEMO_PAIR = {
  brandName: 'Apple',
  category: 'Technology',
  creatorLabel: 'MKBHD',
  videoUrls: [
    'https://www.youtube.com/watch?v=_4ELeWAgMwo',
    'https://www.youtube.com/watch?v=ESABTN4VtrA',
    'https://www.youtube.com/watch?v=scwlR0QHGOk',
    'https://www.youtube.com/watch?v=QVv3mQzlrN0',
    'https://www.youtube.com/watch?v=_0G4OG39XjI',
  ],
};

const DEMO_VIDEO_IDS = DEMO_PAIR.videoUrls.map((u) => parseVideoId(u)).sort().join(',');

export function isDemoInput(videoUrls: unknown, brandName: unknown): boolean {
  if (!Array.isArray(videoUrls)) return false;
  const ids = videoUrls.map((u) => parseVideoId(String(u)) || '').sort().join(',');
  return ids === DEMO_VIDEO_IDS && String(brandName || '').trim().toLocaleLowerCase() === DEMO_PAIR.brandName.toLocaleLowerCase();
}
