'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Check a creator' },
  { href: '/discover', label: 'Find creators' },
  { href: '/projects', label: 'Projects' },
  { href: '/matches', label: 'History' },
];

// A saved match (/match/[id]) belongs to History, not to the page that ran it.
const isCurrent = (href: string, path: string | null) =>
  path !== null && (href === '/' ? path === '/' : path.startsWith(href) || (href === '/matches' && path.startsWith('/match/')));

// `path` is null while prerendering, where no page is marked as current.
export function NavLinks({ path }: { path: string | null }) {
  return (
    <nav aria-label="Main" data-tour="nav" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {/* On a phone the nav gets its own row and scrolls sideways instead of wrapping. */}
      <ul className="flex gap-5 whitespace-nowrap text-sm">
        {NAV.map((item) => {
          const current = isCurrent(item.href, path);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={`block border-b-2 py-2.5 transition-colors sm:py-4 ${
                  current ? 'border-teal-600 font-medium text-slate-900' : 'border-transparent text-slate-600 hover:text-teal-700'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function MainNav() {
  return <NavLinks path={usePathname()} />;
}
