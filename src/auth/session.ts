// Who the dashboard is showing. There is no login (a demo project): the dashboard opens as the
// founder (admin), and the "Viewing as" menu switches to front desk or a designer. The choice
// is kept in a cookie, and every query still runs through the database's RLS for that person.
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getPool } from '../db/client';

export interface StaffSession {
  id: string;
  email: string;
  role: 'admin' | 'front_desk' | 'designer';
  designerId: string | null;
  displayName: string;
}

export const VIEW_AS_COOKIE = 'view_as';

type Row = { id: string; email: string; role: StaffSession['role']; designer_id: string | null; display_name: string | null };
const toSession = (r: Row): StaffSession => ({
  id: r.id,
  email: r.email,
  role: r.role,
  designerId: r.designer_id,
  displayName: r.display_name ?? r.email,
});

export async function getSession(): Promise<StaffSession | null> {
  const db = getPool();
  const chosen = z.guid().safeParse((await cookies()).get(VIEW_AS_COOKIE)?.value);
  if (chosen.success) {
    const { rows } = await db.query<Row>(
      'select id, email, role, designer_id, display_name from public.staff where id = $1 and active',
      [chosen.data],
    );
    if (rows[0]) return toSession(rows[0]);
  }
  // Default: the founder's view.
  const { rows } = await db.query<Row>(
    `select id, email, role, designer_id, display_name from public.staff
      where active order by (role = 'admin') desc, created_at limit 1`,
  );
  return rows[0] ? toSession(rows[0]) : null;
}

export async function requireSession(): Promise<StaffSession> {
  const session = await getSession();
  if (!session) throw new Error('No staff in the database yet: run `npm run db:seed-demo`.');
  return session;
}

export const isOffice = (s: StaffSession) => s.role === 'admin' || s.role === 'front_desk';
