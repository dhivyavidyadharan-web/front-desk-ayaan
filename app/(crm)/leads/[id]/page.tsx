import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isOffice, requireSession } from '@/auth/session';
import { LEAD_STAGES, STAGE_LABELS } from '@/core/crm';
import { dashboardRunner } from '@/db/client';
import { designers, lead } from '@/crm/queries';
import { CRITERION_LABELS, OUTCOME_LABELS, TASK_TYPE_LABELS, fmtDateTime, label } from '@/crm/labels';
import { addNote, assignDesigner, completeTask, moveStageForm } from '../../../actions';
import { Flash, OutcomeBadge, ScoreBadge } from '../../../ui';
import { Brief } from '../../brief';

const RESULT_TONE: Record<string, string> = { pass: 'ok', fail: 'bad', unclear: 'warn' };
const CRITERIA_ORDER = ['real_project', 'service_area', 'timeline', 'budget', 'decision_maker'];

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const office = isOffice(session);

  const run = dashboardRunner(session.id);
  const [l, team] = await Promise.all([lead(run, id), office ? run(designers) : Promise.resolve([])]);
  if (!l) notFound();
  const data = { ...l, team };
  const { head, calls, activities, tasks, latest, bookings } = data;
  const lastCall = calls[0];
  const briefCall = calls.find((c) => c.extraction) ?? lastCall;
  const transcriptCall = calls.find((c) => c.transcript?.length && !c.redacted_at);
  const booking = bookings.find((b) => b.status !== 'cancelled');

  return (
    <>
      <div className="page-head">
        <div>
          <p className="sub">
            <Link href="/pipeline">← Pipeline</Link>
          </p>
          <h1>{head.name ?? head.phone}</h1>
          <p className="sub">
            {head.phone} · {head.stage ? STAGE_LABELS[head.stage as keyof typeof STAGE_LABELS] : 'Existing client complaint'}
            {head.designer_name ? ` · ${head.designer_name}` : ''}
          </p>
        </div>
        <ScoreBadge score={head.score} reasons={head.score_reasons} />
      </div>
      <Flash sp={sp} />

      {booking ? (
        <div className="card consult-banner">
          <div>
            <span className="sub">Consultation</span>
            <div className="consult-when">{fmtDateTime(booking.start_at)}</div>
            <div className="sub">
              {booking.location_type === 'online' ? 'Online (video)' : booking.location_type === 'studio' ? 'At the studio' : 'See booking'}
              {booking.designer ? ` · with ${booking.designer}` : ''}
            </div>
          </div>
          {booking.meeting_url ? (
            <a className="btn" href={booking.meeting_url} target="_blank" rel="noreferrer">
              Join video call
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="layout-lead">
        <div className="stack-gap">
          <section className="card">
            <h2>Project brief</h2>
            <Brief
              x={latest}
              flags={briefCall?.flags ?? []}
              openQuestion={briefCall?.open_question}
              declineReason={briefCall?.decline_reason}
              referral={head.referral_source}
            />
            {transcriptCall ? (
              <div style={{ marginTop: 16 }}>
                <Link className="btn primary-link" href={`/transcripts/${transcriptCall.id}`}>
                  View full transcript
                </Link>
              </div>
            ) : null}
            {calls.length > 1 ? (
              <p className="sub" style={{ marginTop: 12 }}>
                {calls.length} calls:{' '}
                {calls.map((c, i) => (
                  <span key={c.id}>
                    {i ? ' · ' : ''}
                    {c.transcript?.length && !c.redacted_at ? <Link href={`/transcripts/${c.id}`}>{fmtDateTime(c.started_at)}</Link> : fmtDateTime(c.started_at)}{' '}
                    ({label(OUTCOME_LABELS, c.outcome)})
                  </span>
                ))}
              </p>
            ) : null}
          </section>

          {office && lastCall?.criteria ? (
            <details className="card">
              <summary>
                <h2 style={{ display: 'inline' }}>Why the agent routed it this way</h2>
              </summary>
              <dl className="facts" style={{ marginTop: 12 }}>
                {CRITERIA_ORDER.filter((k) => lastCall.criteria?.[k]).map((k) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{label(CRITERION_LABELS, k)}</dt>
                    <dd>
                      <span className={`badge ${RESULT_TONE[lastCall.criteria![k]!] ?? ''}`}>{lastCall.criteria![k]}</span>{' '}
                      <span className="sub">{lastCall.extraction?.criteria[k as keyof NonNullable<typeof latest>['criteria']]?.reason}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              {head.score_reasons?.length ? <p className="sub" style={{ marginTop: 10 }}>Score: {head.score_reasons.join(' · ')}</p> : null}
            </details>
          ) : null}

          <details className="card" open={Boolean(sp.msg?.startsWith('Note'))}>
            <summary>
              <h2 style={{ display: 'inline' }}>Notes and activity ({activities.length})</h2>
            </summary>
            <form action={addNote} style={{ margin: '12px 0' }}>
              <input type="hidden" name="enquiryId" value={id} />
              <textarea name="body" rows={2} maxLength={2000} required aria-label="Add a note" placeholder="Add a note, e.g. Site visit done, sending layout Friday." />
              <div style={{ marginTop: 6 }}>
                <button type="submit" className="primary">Add note</button>
              </div>
            </form>
            <ul className="timeline">
              {activities.map((a) => (
                <li key={a.id}>
                  <div className="when">{fmtDateTime(a.created_at)}</div>
                  <strong>{a.kind === 'note' ? `Note by ${a.author_name}` : a.author_name}</strong>
                  {a.kind === 'note' ? <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{a.body}</p> : <> · {a.body}</>}
                </li>
              ))}
            </ul>
          </details>
        </div>

        <aside className="stack-gap">
          {head.stage ? (
            <section className="card">
              <h2>Stage</h2>
              <form action={moveStageForm}>
                <input type="hidden" name="enquiryId" value={id} />
                <select name="stage" defaultValue={head.stage} aria-label="Stage" style={{ width: '100%', marginBottom: 8 }}>
                  {LEAD_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </option>
                  ))}
                </select>
                <input name="lostReason" aria-label="If lost, why?" placeholder="If lost, why?" defaultValue={head.stage === 'lost' ? (head.lost_reason ?? '') : ''} style={{ width: '100%', marginBottom: 8 }} />
                <button type="submit">Update stage</button>
              </form>
            </section>
          ) : null}

          {office && head.stage ? (
            <section className="card">
              <h2>Designer</h2>
              <form action={assignDesigner} className="form-row">
                <input type="hidden" name="enquiryId" value={id} />
                <select name="designerId" defaultValue={head.assigned_designer_id ?? ''} aria-label="Designer" required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {data.team.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <button type="submit">Assign</button>
              </form>
            </section>
          ) : null}

          {tasks.length ? (
            <section className="card">
              <h2>To do</h2>
              <ul className="timeline">
                {tasks.map((t) => (
                  <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <span className="badge">{label(TASK_TYPE_LABELS, t.type)}</span> {t.title ?? ''}
                      {t.question ? <div className="sub">{t.question}</div> : null}
                      <div className="when">Due {fmtDateTime(t.due_at)}</div>
                    </div>
                    <form action={completeTask}>
                      <input type="hidden" name="taskId" value={t.id} />
                      <input type="hidden" name="returnTo" value={`/leads/${id}`} />
                      <button type="submit">Done</button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {lastCall ? (
            <p className="sub" style={{ textAlign: 'right' }}>
              Last call {fmtDateTime(lastCall.started_at)} <OutcomeBadge outcome={lastCall.outcome} label={label(OUTCOME_LABELS, lastCall.outcome)} />
            </p>
          ) : null}
        </aside>
      </div>
    </>
  );
}
