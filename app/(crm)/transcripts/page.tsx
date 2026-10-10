import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { getPool, withDashboardUser } from '@/db/client';
import { callsList, type Period } from '@/crm/queries';
import { OUTCOME_LABELS, fmtDateTime, label } from '@/crm/labels';
import { OutcomeBadge } from '../../ui';

const OUTCOMES = ['qualified', 'declined', 'unsure', 'escalate_complaint', 'missed'];
const PAGE = 50;

export default async function TranscriptsPage({
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
  const filtered = Boolean(outcome || q || leaksOnly || period !== 'all');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Transcripts</h1>
          <p className="sub">Every call: what the client wants first, the full conversation one click away.</p>
        </div>
        <form className="filters" method="get" style={{ marginBottom: 0 }}>
          <input name="q" defaultValue={q ?? ''} placeholder="Search name, phone or area" aria-label="Search" />
          <select name="outcome" defaultValue={outcome ?? ''} aria-label="Outcome">
            <option value="">All calls</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {label(OUTCOME_LABELS, o)}
              </option>
            ))}
          </select>
          <button type="submit">Search</button>
          {filtered ? (
            <Link className="btn" href="/transcripts">
              Clear
            </Link>
          ) : null}
        </form>
      </div>
      {leaksOnly || period !== 'all' ? (
        <p className="sub" style={{ marginBottom: 12 }}>
          Showing {leaksOnly ? 'calls flagged for a price leak' : ''}
          {leaksOnly && period !== 'all' ? ', ' : ''}
          {period !== 'all' ? `the last ${period} days` : ''}.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="empty">No calls match.</p>
      ) : (
        <div className="transcript-list">
          {rows.map((c) => (
            <article key={c.id} className="card transcript-row">
              <div className="row-main">
                <div className="row-who">
                  {c.enquiry_id ? <Link href={`/leads/${c.enquiry_id}`}>{c.name ?? c.phone}</Link> : (c.name ?? c.phone)}
                  <span className="sub"> · {fmtDateTime(c.started_at)}</span>{' '}
                  <OutcomeBadge outcome={c.outcome} label={c.status === 'needs_review' ? 'Needs review' : label(OUTCOME_LABELS, c.outcome)} />
                  {c.price_leak_flag ? <span className="badge bad" style={{ marginLeft: 6 }}>Price leak</span> : null}
                </div>
                <div className="row-brief">
                  {[c.area, c.size_sqft ? `${Number(c.size_sqft).toLocaleString('en-IN')} sq ft` : null, c.timeline].filter(Boolean).join(' · ') ||
                    (c.outcome === 'missed' ? 'Missed or dropped call' : 'No details captured')}
                </div>
                {c.scope ? <div className="sub">{c.scope}</div> : null}
              </div>
              {c.turns > 0 ? (
                <Link className="btn" href={`/transcripts/${c.id}`}>
                  View full transcript
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      )}
      {hasMore ? (
        <p style={{ marginTop: 12 }}>
          <Link className="btn" href={`/transcripts?${more}`}>
            Show more
          </Link>
        </p>
      ) : null}
    </>
  );
}
