import Link from 'next/link';
import type { TourStep } from '@/components/Tour';

// The spotlight tours' text. Targets are data-tour attributes on each page.

export const CHECK_TOUR: TourStep[] = [
  {
    title: 'Welcome to CreatorPulse',
    body: 'See whether a creator’s world shares your brand audience’s taste, using Qloo’s cross-domain taste graph instead of follower counts. This tour takes 30 seconds.',
  },
  {
    target: 'nav',
    title: 'Two ways to start',
    body: (
      <>
        <strong>Check a creator</strong> when you already have one in mind. <strong>Find creators</strong> when you want Qloo to rank
        YouTubers for your brand. Projects and History keep what you’ve run, in this browser.
      </>
    ),
  },
  {
    target: 'check-brand',
    title: 'Check a creator in two steps',
    body: 'Enter your brand’s English name, then paste 1–5 YouTube videos or one channel URL. You get a Fit Score from 0 to 100 across five taste areas.',
  },
  {
    target: 'check-demo',
    title: 'Or start with a demo',
    body: 'Apple × MKBHD is a strong fit; the Huggies mismatch shows what conflicting taste looks like. Each opens in seconds.',
  },
  {
    target: 'how-it-works',
    title: 'Every point is explained',
    body: 'A result lists the Qloo entities behind each score and an Agent Trace of every call. This page explains the formula.',
  },
  {
    title: 'You’re set',
    body: 'Open the tour again any time with the Tour button at the bottom right.',
  },
];

export const DISCOVER_TOUR: TourStep[] = [
  {
    target: 'discover-brand',
    title: 'Enter your brand',
    body: 'Qloo ranks about 900 YouTubers by how strongly your brand’s audience relates to them, then each one gets a Fit Score.',
  },
  {
    target: 'discover-type',
    title: 'Narrow the creator type',
    body: 'Optional: Technology, Gaming, Beauty and more. Types come from Wikipedia categories, so coverage is uneven.',
  },
  {
    target: 'discover-more',
    title: 'Brand not in Qloo?',
    body: 'Describe it, paste its web page or name 1–3 reference brands with a similar audience. Those results are labelled as approximations.',
  },
  {
    target: 'discover-project',
    title: 'Keep a campaign together',
    body: (
      <>
        A project saves your brand inputs and every ranking found with them, in this browser. See them all under{' '}
        <Link href="/projects" className="text-teal-700 underline">
          Projects
        </Link>
        .
      </>
    ),
  },
  {
    target: 'discover-demo',
    title: 'See it in action',
    body: 'Run a demo: three very different brands get three different rankings. Replay this tour with the Tour button at the bottom right.',
  },
];
