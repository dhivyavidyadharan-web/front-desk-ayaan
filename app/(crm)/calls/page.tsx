import { requireSession } from '@/auth/session';
import { getPool, withDashboardUser } from '@/db/client';
import { callsList, type Period } from '@/crm/queries';
import { DECLINE_LABELS, OUTCOME_LABELS, fmtDateTime, fmtDuration, label } from '@/crm/labels';
import { OutcomeBadge } from '../../ui';

const OUTCOMES = ['qualified', 'declined', 'unsure', 'escalate_complaint', 'missed'];
const PAGE = 50;

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string; q?: string; period?: string; leaks?: string; limit?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const outcome = OUTCOMES.includes(sp.outcome ?? '') ? sp.outcome! : null;
  const q = sp.q?.trim().slice(0, 80) || null;
  const period: Period = (['7', '30', '90', 'all'] as const).find((p) => p === sp.period) ?? 'all';
  const leaksOnly = sp.leaks === '1';
  const limit = Math.min(Math.max(Number(sp.limit) || PAGE, PAGE), 500);

  const { rows, hasMore } = await withDashboardUser(getPool(), session.id, (tx) =>
    callsList(tx, { outcome, q, period, leaksOnly, limit }),
  );
  const more = new URLSearchParams({ ...(outcome && { outcome }), ...(q && { q }), period, ...(leaksOnly && { leaks: '1' }), limit: String(limit + PAGE) });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calls</h1>
          <p className="sub">Every call the agent handled. Open a call to see its lead, rubric and transcript.</p>
        </div>
      </div>
      <form className="filters" method="get">
        <div>
          <label htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={q ?? ''} placeholder="Name, phone or area" />
        </div>
        <div>
          <label htmlFor="outcome">Outcome</label>
          <select id="outcome" name="outcome" defaultValue={outcome ?? ''}>
            <option value="">All</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {label(OUTCOME_LABELS, o)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="period">Period</label>
          <select id="period" name="period" defaultValue={period}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>
        <div>
          <label htmlFor="leaks">&nbsp;</label>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0' }}>
            <input type="checkbox" id="leaks" name="leaks" value="1" defaultChecked={leaksOnly} /> Price leaks only
          </span>
        </div>
        <button type="submit">Apply</button>
        {outcome || q || leaksOnly || period !== 'all' ? (
          <a className="btn" href="/calls">
            Clear
          </a>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="empty">No calls match.</p>
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>When</th>
              <th>Caller</th>
              <th>Project</th>
              <th>Length</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  {fmtDateTime(c.started_at)}
                  {c.outside_hours ? <div><span className="badge">after hours</span></div> : null}
                </td>
                <td>
                  {c.enquiry_id ? <a href={`/leads/${c.enquiry_id}`}>{c.name ?? c.phone}</a> : (c.name ?? c.phone)}
                  {c.name ? <div className="sub">{c.phone}</div> : null}
                </td>
                <td>
                  {c.area ?? '—'}
                  {c.scope ? <div className="sub">{c.scope}</div> : null}
                </td>
                <td>{fmtDuration(c.duration_seconds)}</td>
                <td>
                  <OutcomeBadge outcome={c.outcome} label={c.status === 'needs_review' ? 'Needs review' : label(OUTCOME_LABELS, c.outcome)} />
                  {c.decline_reason ? <div className="sub">{label(DECLINE_LABELS, c.decline_reason)}</div> : null}
                  {c.price_leak_flag ? <div><span className="badge bad">Price leak</span></div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore ? (
        <p style={{ marginTop: 12 }}>
          <a className="btn" href={`/calls?${more}`}>
            Show more
          </a>
        </p>
      ) : null}
    </>
  );
}
