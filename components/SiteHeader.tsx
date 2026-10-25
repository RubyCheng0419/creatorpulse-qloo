import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-slate-900">CreatorPulse</span>
          <span className="hidden text-xs text-slate-500 sm:inline">Brand × creator cultural due diligence</span>
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="text-slate-600 hover:text-teal-700">
            New match
          </Link>
          <Link href="/matches" className="text-slate-600 hover:text-teal-700">
            History
          </Link>
        </nav>
      </div>
    </header>
  );
}
