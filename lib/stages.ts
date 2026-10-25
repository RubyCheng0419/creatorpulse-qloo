// Progress stages reported by /api/match while it runs (PRODUCT_SPEC §3.1 Step 3).
// Shared by the server (emits them) and the browser (shows them).

export type MatchStage = 'youtube' | 'brand' | 'creator' | 'score' | 'report';

export const STAGES: { id: MatchStage; label: string }[] = [
  { id: 'youtube', label: 'Reading YouTube video metadata' },
  { id: 'brand', label: 'Looking up the brand and its cultural proxies in Qloo' },
  { id: 'creator', label: 'Resolving the creator’s taste entities in Qloo' },
  { id: 'score', label: 'Computing the Fit Score' },
  { id: 'report', label: 'Writing the report' },
];

export type OnStage = (stage: MatchStage) => void;
