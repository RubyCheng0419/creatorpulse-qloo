import type { Match } from '@/lib/match';

// History is browser-only, so a shareable report is a link to the same inputs: opening it
// runs the analysis again on any device (a demo pair opens its saved result). Read back by
// linkedRequest in app/page.tsx.
export function shareLink(match: Match, origin: string): string {
  const q = new URLSearchParams();
  for (const url of match.creator.videoUrls) q.append('videos', url);
  q.set('brand', match.brand.name);
  if (match.brand.category) q.set('category', match.brand.category);
  if (match.brand.referenceBrands?.length) q.set('refs', match.brand.referenceBrands.join('|'));
  if (match.brand.description) q.set('desc', match.brand.description);
  return `${origin}/?${q}`;
}
