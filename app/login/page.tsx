import { devSignIn } from '../actions';
import { DEV_LOGIN_ENABLED, getSession } from '@/auth/session';
import { getPool } from '@/db/client';
import { ROLE_LABELS } from '@/crm/labels';
import { redirect } from 'next/navigation';
import { Flash } from '../ui';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getSession()) redirect('/');
  const sp = await searchParams;

  if (!DEV_LOGIN_ENABLED) {
    return (
      <main style={{ maxWidth: 480 }}>
        <h1>Aangan front desk</h1>
        <p className="sub">Staff sign-in with Google is being set up. The dashboard opens here once it is ready.</p>
      </main>
    );
  }

  const staff = (
    await getPool().query<{ id: string; display_name: string | null; email: string; role: string }>(
      `select id, display_name, email, role from public.staff where active order by role, display_name`,
    )
  ).rows;

  return (
    <main style={{ maxWidth: 520 }}>
      <h1>Aangan front desk</h1>
      <p className="sub">Local preview: choose who to sign in as. This picker only exists on your machine; the live site will use Google sign-in.</p>
      <Flash sp={sp} />
      {staff.length === 0 ? (
        <p className="empty">No staff in this database yet.</p>
      ) : (
        <div className="card stack-gap">
          {staff.map((s) => (
            <form key={s.id} action={devSignIn} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <input type="hidden" name="staffId" value={s.id} />
              <span>
                <strong>{s.display_name ?? s.email}</strong> <span className="badge">{ROLE_LABELS[s.role]}</span>
              </span>
              <button type="submit">Sign in</button>
            </form>
          ))}
        </div>
      )}
    </main>
  );
}
