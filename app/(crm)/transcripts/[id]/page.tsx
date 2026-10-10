import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getPool, withDashboardUser } from '@/db/client';
import { callDetail } from '@/crm/queries';
import { OUTCOME_LABELS, fmtDateTime, fmtDuration, label } from '@/crm/labels';
import { OutcomeBadge } from '../../../ui';
import { Brief } from '../../brief';

export default async function TranscriptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await withDashboardUser(getPool(), session.id, (tx) => callDetail(tx, id));
  if (!c) notFound();
  const callerName = c.name ?? c.extraction?.caller.name ?? 'Caller';

  return (
    <>
      <div className="page-head">
        <div>
          <p className="sub">
            {c.enquiry_id ? <Link href={`/leads/${c.enquiry_id}`}>← Back to {callerName}</Link> : <Link href="/transcripts">← Transcripts</Link>}
          </p>
          <h1>Call with {callerName}</h1>
          <p className="sub">
            {c.phone} · {fmtDateTime(c.started_at)} · {fmtDuration(c.duration_seconds)}
            {c.outside_hours ? ' · after hours' : ''}{' '}
            <OutcomeBadge outcome={c.outcome} label={c.status === 'needs_review' ? 'Needs review' : label(OUTCOME_LABELS, c.outcome)} />
          </p>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Project brief</h2>
        <Brief x={c.extraction} flags={c.flags} openQuestion={c.open_question} declineReason={c.decline_reason} referral={c.referral_source} />
      </section>

      <section className="card" id="transcript">
        <h2>Full transcript</h2>
        {c.redacted_at ? (
          <p className="empty">This transcript was deleted after the 30-day retention period. The brief above is kept.</p>
        ) : !c.transcript?.length ? (
          <p className="empty">No conversation on this call.</p>
        ) : (
          <ol className="chat">
            {c.transcript.map((t, i) => (
              <li key={i} className={t.speaker}>
                <span className="who">
                  {t.speaker === 'agent' ? 'Agent' : callerName}
                  {t.at ? <span className="at"> {t.at}</span> : null}
                </span>
                <p>{t.text}</p>
              </li>
            ))}
          </ol>
        )}
        {c.recording_url ? (
          <p style={{ marginTop: 12 }}>
            <a className="btn" href={c.recording_url} target="_blank" rel="noreferrer">
              Listen to the recording
            </a>
          </p>
        ) : null}
      </section>
    </>
  );
}
