import { redirect } from 'next/navigation';
import { isOffice, requireSession } from '@/auth/session';
import { getPool, withDashboardUser } from '@/db/client';
import { configRows } from '@/crm/queries';
import { fmtDate } from '@/crm/labels';
import { getBotUsername, telegramConfigFromEnv } from '@/integrations/telegram';
import { designerLinkCode, teamLinkCode } from '@/integrations/telegramLink';
import { updateConfig } from '../../actions';
import { Flash } from '../../ui';
import { CopyButton } from './copy-button';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  if (!isOffice(session)) redirect('/');
  const sp = await searchParams;
  const all = await withDashboardUser(getPool(), session.id, configRows);
  const rows = all.filter((r) => !r.key.startsWith('telegram_'));
  const teamChat = all.find((r) => r.key === 'telegram_team_chat_id')?.value ?? null;
  const designers = (
    await withDashboardUser(getPool(), session.id, (tx) =>
      tx.query<{ id: string; name: string; telegram_chat_id: string | null }>(
        `select id, name, telegram_chat_id from public.designers where active order by name`,
      ),
    )
  ).rows;
  const tg = telegramConfigFromEnv();
  const bot = tg ? await getBotUsername(tg) : null;
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

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Telegram</h2>
        {!tg ? (
          <p className="sub">Add the bot token to turn on Telegram alerts (node scripts/set-secret.mjs TELEGRAM_BOT_TOKEN).</p>
        ) : !bot ? (
          <p className="sub">The bot token didn’t work. Check it with @BotFather and save it again.</p>
        ) : (
          <>
            <p className="sub" style={{ marginBottom: 12 }}>
              Bot: <a href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">@{bot}</a>. Send each designer their link; they tap it and press
              Start. From then on they get every consultation booked with them.
            </p>
            <table className="list" style={{ marginBottom: 12 }}>
              <tbody>
                <tr>
                  <td style={{ width: '30%' }}>
                    <strong>Team group</strong>{' '}
                    {teamChat ? <span className="badge ok">Connected</span> : <span className="badge warn">Not connected</span>}
                    <div className="sub" style={{ marginTop: 4 }}>Gets every call summary and booking.</div>
                  </td>
                  <td>
                    <p className="sub" style={{ marginBottom: 6 }}>Add @{bot} to the group, then send this message in it:</p>
                    <div className="form-row">
                      <code>/team {teamLinkCode(tg.webhookSecret)}</code>
                      <CopyButton text={`/team ${teamLinkCode(tg.webhookSecret)}`} />
                    </div>
                  </td>
                </tr>
                {designers.map((d) => {
                  const link = `https://t.me/${bot}?start=${designerLinkCode(d.id, tg.webhookSecret)}`;
                  return (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.name}</strong>{' '}
                        {d.telegram_chat_id ? <span className="badge ok">Connected</span> : <span className="badge warn">Not connected</span>}
                      </td>
                      <td>
                        <div className="form-row" style={{ marginBottom: 0 }}>
                          <code style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420, whiteSpace: 'nowrap' }}>{link}</code>
                          <CopyButton text={link} label={d.telegram_chat_id ? 'Copy link again' : 'Copy link'} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      <h2>Rules</h2>
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
