import { redirect } from 'next/navigation';
import { isOffice, requireSession } from '@/auth/session';
import { getPool, withDashboardUser } from '@/db/client';
import { configRows } from '@/crm/queries';
import { fmtDate } from '@/crm/labels';
import { updateConfig } from '../../actions';
import { Flash } from '../../ui';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  if (!isOffice(session)) redirect('/');
  const sp = await searchParams;
  const rows = await withDashboardUser(getPool(), session.id, configRows);
  const admin = session.role === 'admin';
  const unconfirmed = rows.filter((r) => !r.confirmed).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">
            The rules the agent and the routing code follow. {unconfirmed} {unconfirmed === 1 ? 'is' : 'are'} unconfirmed defaults: tick
            “Confirmed” once the studio agrees.{admin ? '' : ' Only admin can change these.'}
          </p>
        </div>
      </div>
      <Flash sp={sp} />

      <table className="list">
        <thead>
          <tr>
            <th style={{ width: '30%' }}>Setting</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const text = JSON.stringify(r.value, null, Array.isArray(r.value) && r.value.length > 4 ? 0 : undefined);
            return (
              <tr key={r.key} id={r.key}>
                <td>
                  <strong>{r.key.replaceAll('_', ' ')}</strong>{' '}
                  {r.confirmed ? <span className="badge ok">Confirmed</span> : <span className="badge warn">Unconfirmed</span>}
                  <div className="sub" style={{ marginTop: 4 }}>{r.description}</div>
                  <div className="sub" style={{ fontSize: 12 }}>Updated {fmtDate(r.updated_at)}</div>
                </td>
                <td>
                  {admin ? (
                    <form action={updateConfig}>
                      <input type="hidden" name="key" value={r.key} />
                      <textarea name="value" defaultValue={text} rows={text.length > 80 ? 3 : 1} aria-label={`${r.key} value`} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />
                      <div className="form-row" style={{ marginTop: 6 }}>
                        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input type="checkbox" name="confirmed" id={`c-${r.key}`} defaultChecked={r.confirmed} />
                          <label htmlFor={`c-${r.key}`} style={{ margin: 0, fontSize: 13 }}>Confirmed</label>
                        </span>
                        <button type="submit">Save</button>
                      </div>
                    </form>
                  ) : (
                    <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</code>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
