'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Nav({ links }: { links: { href: string; label: string; count?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {links.map((l) => {
        const active = l.href === '/' ? path === '/' : path.startsWith(l.href) || (l.href === '/pipeline' && path.startsWith('/leads')) || (l.href === '/transcripts' && path.startsWith('/transcripts'));
        return (
          <Link key={l.href} href={l.href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
            {l.label}
            {l.count ? <span className="badge warn" style={{ marginLeft: 6 }}>{l.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
