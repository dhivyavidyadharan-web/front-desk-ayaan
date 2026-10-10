import type { ReactNode } from 'react';
import { isOffice, requireSession } from '@/auth/session';
import { getPool, withDashboardUser } from '@/db/client';
import { openTaskCount } from '@/crm/queries';
import { ROLE_LABELS } from '@/crm/labels';
import { signOut } from '../actions';
import { Nav } from './nav';

export const dynamic = 'force-dynamic';

export default async function CrmLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const tasks = await withDashboardUser(getPool(), session.id, openTaskCount);
  const links = [
    { href: '/', label: 'Overview' },
    { href: '/pipeline', label: 'Pipeline' },
    { href: '/calls', label: 'Calls' },
    { href: '/tasks', label: 'Tasks', count: tasks },
    ...(isOffice(session) ? [{ href: '/settings', label: 'Settings' }] : []),
  ];
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">Aangan front desk</a>
        <Nav links={links} />
        <div className="who">
          <span>
            {session.displayName} · {ROLE_LABELS[session.role]}
          </span>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
