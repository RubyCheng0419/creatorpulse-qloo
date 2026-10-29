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

// Progress reported by /api/discover: each step once it has finished, and while "profiles" runs,
// how many creators' audience taste has been read so far (finished: false).
export type DiscoverStage = 'brand' | 'candidates' | 'profiles' | 'score' | 'channels';

export const DISCOVER_STAGES: { id: DiscoverStage; label: string }[] = [
  { id: 'brand', label: 'Looking up the brand in Qloo' },
  { id: 'candidates', label: 'Finding the YouTubers its audience relates to' },
  { id: 'profiles', label: 'Reading each creator’s audience taste' },
  { id: 'score', label: 'Scoring and ranking every creator' },
  { id: 'channels', label: 'Finding their YouTube channels' },
];

export type DiscoverProgress = { stage: DiscoverStage; finished: boolean; done?: number; of?: number };
export type OnDiscoverProgress = (p: DiscoverProgress) => void;
