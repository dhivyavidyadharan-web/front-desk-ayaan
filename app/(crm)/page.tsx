import { isOffice, requireSession } from '@/auth/session';
import { getPool, withDashboardUser } from '@/db/client';
import { dashboardSettings, overview, type Period } from '@/crm/queries';
import { DECLINE_LABELS, fmtInr, label, OUTCOME_LABELS } from '@/crm/labels';
import { Metric } from '../ui';

const PERIODS: { p: Period; label: string }[] = [
  { p: '7', label: '7 days' },
  { p: '30', label: '30 days' },
  { p: '90', label: '90 days' },
  { p: 'all', label: 'All time' },
];
const OUTCOME_COLORS: Record<string, string> = {
  qualified: '#9dbb86', // sage
  declined: '#8c7764', // stone
  unsure: '#e2ad57', // ochre
  escalate_complaint: '#d9785b', // terracotta
  missed: '#5e4a3c', // taupe
};
const TYPE_LABELS: Record<string, string> = {
  residential_full: 'Full home',
  residential_partial: 'Several rooms',
  single_room: 'Single room',
  commercial_office: 'Office',
  other: 'Other',
};

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const period: Period = (['7', '30', '90', 'all'] as const).find((p) => p === sp.period) ?? '90';
  const [data, settings] = await Promise.all([
    withDashboardUser(getPool(), session.id, (tx) => overview(tx, period)),
    dashboardSettings(),
  ]);
  const office = isOffice(session);
  const totalOutcomes = Object.values(data.outcomes).reduce((a, b) => a + b, 0);
  const qualified = data.outcomes.qualified ?? 0;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{office ? 'Overview' : 'My leads'}</h1>
          <p className="sub">{office ? 'Every call the agent took, and what happened next.' : 'Leads assigned to you.'}</p>
        </div>
        <nav className="segmented" aria-label="Period">
          {PERIODS.map((x) => (
            <a key={x.p} href={`/?period=${x.p}`} className={x.p === period ? 'active' : undefined}>
              {x.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="grid">
        <Metric k="Calls received" v={data.calls.calls} s={`${pct(data.calls.after_hours, data.calls.calls)} outside 10am–7pm`} href="/calls" />
        <Metric k="Answered by the agent" v={pct(data.calls.answered, data.calls.calls)} s="target 100%" href="/calls?outcome=missed" />
        <Metric k="Qualified leads" v={qualified} s={`${pct(qualified, totalOutcomes)} of enquiries`} href="/pipeline" />
        <Metric k="Open tasks" v={data.tasks.open} s={data.tasks.overdue ? `${data.tasks.overdue} overdue` : 'none overdue'} href="/tasks" tone={data.tasks.overdue ? 'alert' : undefined} />
        <Metric
          k="Call end → designer alert"
          v={data.handoff.toSentMin === null ? '—' : `${data.handoff.toSentMin.toFixed(1)} min`}
          s={data.handoff.n ? (data.handoff.toAckMin === null ? 'none acknowledged yet' : `acknowledged in ${data.handoff.toAckMin.toFixed(0)} min`) : 'starts once Telegram is connected'}
        />
        {office ? (
          <>
            <Metric
              k="Cost per qualified lead"
              v={qualified ? fmtInr(data.cost.total / qualified) : '—'}
              s={`${fmtInr(data.cost.total)} for ${data.cost.calls} calls`}
            />
            <Metric
              k="Price-leak alerts"
              v={data.calls.price_leaks}
              s="must stay 0"
              href="/calls?leaks=1"
              tone={data.calls.price_leaks ? 'alert' : 'good'}
            />
          </>
        ) : null}
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Outcomes</h2>
          {totalOutcomes === 0 ? (
            <p className="empty">No calls in this period.</p>
          ) : (
            <>
              <div className="stack" aria-hidden="true">
                {Object.entries(data.outcomes).map(([o, n]) => (
                  <div key={o} style={{ flex: n, background: OUTCOME_COLORS[o] }} />
                ))}
              </div>
              {Object.entries(data.outcomes)
                .sort((a, b) => b[1] - a[1])
                .map(([o, n]) => (
                  <div key={o} className="bar-row" style={{ gridTemplateColumns: '1fr 40px' }}>
                    <a href={`/calls?outcome=${o}&period=${period}`}>
                      <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: OUTCOME_COLORS[o], marginRight: 8 }} />
                      {label(OUTCOME_LABELS, o)}
                    </a>
                    <span style={{ textAlign: 'right' }}>{n}</span>
                  </div>
                ))}
            </>
          )}
        </section>

        <section className="card">
          <h2>Lead funnel</h2>
          {[
            ['Enquiries', data.funnel.enquiries],
            ['Qualified', data.funnel.qualified],
            ['Consultation booked', data.funnel.booked],
            ['Won', data.funnel.won],
          ].map(([name, n], i, all) => (
            <div key={name} className="funnel-step" style={{ marginLeft: i * 14, marginRight: i * 14 }}>
              <span>{name}</span>
              <span>
                <strong>{n}</strong> {i > 0 ? <span className="sub">({pct(Number(n), Number(all[0]![1]))})</span> : null}
              </span>
            </div>
          ))}
          {office ? (
            <p className="sub" style={{ marginTop: 10 }}>
              {data.activeLeads} active leads · est. pipeline {fmtInr(data.activeLeads * settings.avgProjectValueInr)} (internal)
            </p>
          ) : null}
        </section>

        <section className="card">
          <h2>Why leads were declined</h2>
          {data.declineReasons.length === 0 ? (
            <p className="empty">None declined in this period.</p>
          ) : (
            data.declineReasons.map((r) => (
              <div key={r.reason} className="bar-row">
                <span>{label(DECLINE_LABELS, r.reason)}</span>
                <div className="bar-track">
                  <div className="bar" style={{ width: `${(r.n / data.declineReasons[0]!.n) * 100}%` }} />
                </div>
                <span>{r.n}</span>
              </div>
            ))
          )}
          <p className="sub" style={{ marginTop: 10 }}>
            {data.calls.asked_price} caller{data.calls.asked_price === 1 ? '' : 's'} asked about price; the agent deflected every time.
          </p>
        </section>

        <section className="card">
          <h2>Where leads come from</h2>
          <InsightList title="Areas" rows={data.topAreas} />
          <InsightList title="Referred by / found us via" rows={data.topReferrals} />
          <InsightList title="Project types" rows={data.topTypes.map((r) => ({ ...r, value: TYPE_LABELS[r.value] ?? r.value }))} />
        </section>
      </div>
    </>
  );
}

function InsightList({ title, rows }: { title: string; rows: { value: string; n: number }[] }) {
  const max = rows[0]?.n ?? 1;
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="sub" style={{ fontSize: 12, marginBottom: 4 }}>{title}</div>
      {rows.length === 0 ? (
        <p className="empty">Not enough data yet.</p>
      ) : (
        rows.map((r) => (
          <div key={r.value} className="bar-row">
            <span title={r.value} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.value}</span>
            <div className="bar-track">
              <div className="bar" style={{ width: `${(r.n / max) * 100}%` }} />
            </div>
            <span>{r.n}</span>
          </div>
        ))
      )}
    </div>
  );
}
