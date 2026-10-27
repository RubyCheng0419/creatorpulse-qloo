import { Suspense } from 'react';
import Link from 'next/link';
import { MainNav, NavLinks } from '@/components/MainNav';

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-0">
        <Link href="/" className="flex items-baseline gap-2 sm:py-3">
          <span className="text-lg font-bold tracking-tight text-slate-900">CreatorPulse</span>
          <span className="hidden text-xs text-slate-500 md:inline">Brand × creator cultural due diligence</span>
        </Link>
        {/* The current page comes from the URL, which a prerendered page only has in the browser. */}
        <Suspense fallback={<NavLinks path={null} />}>
          <MainNav />
        </Suspense>
      </div>
    </header>
  );
}
