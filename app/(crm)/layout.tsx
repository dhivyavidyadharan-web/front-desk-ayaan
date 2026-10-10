import type { ReactNode } from 'react';
import { isOffice, requireSession } from '@/auth/session';
import { getPool, withDashboardUser } from '@/db/client';
import { openTaskCount } from '@/crm/queries';
import { Nav } from './nav';
import { ViewAs } from './view-as';

export const dynamic = 'force-dynamic';

export default async function CrmLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const db = getPool();
  const [tasks, staff] = await Promise.all([
    withDashboardUser(db, session.id, openTaskCount),
    db.query<{ id: string; name: string; role: 'admin' | 'front_desk' | 'designer' }>(
      `select id, coalesce(display_name, email) as name, role from public.staff where active order by role, display_name`,
    ),
  ]);
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
          <ViewAs current={session.id} staff={staff.rows} />
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
