// Who is using the dashboard. Google sign-in plugs in here once its OAuth client exists.
// Until then, a staff picker works on this machine only (never in production).
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getPool } from '../db/client';

export interface StaffSession {
  id: string;
  email: string;
  role: 'admin' | 'front_desk' | 'designer';
  designerId: string | null;
  displayName: string;
}

export const DEV_LOGIN_ENABLED = process.env.NODE_ENV !== 'production';
export const DEV_COOKIE = 'dev_staff';

export async function getSession(): Promise<StaffSession | null> {
  if (!DEV_LOGIN_ENABLED) return null;
  const parsed = z.guid().safeParse((await cookies()).get(DEV_COOKIE)?.value);
  if (!parsed.success) return null;
  const { rows } = await getPool().query<{
    id: string;
    email: string;
    role: StaffSession['role'];
    designer_id: string | null;
    display_name: string | null;
  }>('select id, email, role, designer_id, display_name from public.staff where id = $1 and active', [parsed.data]);
  const r = rows[0];
  return r ? { id: r.id, email: r.email, role: r.role, designerId: r.designer_id, displayName: r.display_name ?? r.email } : null;
}

export async function requireSession(): Promise<StaffSession> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export const isOffice = (s: StaffSession) => s.role === 'admin' || s.role === 'front_desk';
