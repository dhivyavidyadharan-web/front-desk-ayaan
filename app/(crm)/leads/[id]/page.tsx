import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isOffice, requireSession } from '@/auth/session';
import { LEAD_STAGES, STAGE_LABELS } from '@/core/crm';
import { getPool, withDashboardUser } from '@/db/client';
import { designers, lead, staffMembers } from '@/crm/queries';
import {
  CRITERION_LABELS,
  DECLINE_LABELS,
  FLAG_LABELS,
  OUTCOME_LABELS,
  TASK_TYPE_LABELS,
  fmtDateTime,
  fmtDuration,
  label,
} from '@/crm/labels';
import { addNote, addReminder, assignDesigner, completeTask, moveStageForm } from '../../../actions';
import { Flash, OutcomeBadge, ScoreBadge } from '../../../ui';

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

  const data = await withDashboardUser(getPool(), session.id, async (tx) => {
    const l = await lead(tx, id);
    if (!l) return null;
    return { ...l, team: office ? await designers(tx) : [], staff: await staffMembers(tx) };
  });
  if (!data) notFound();
  const { head, calls, activities, tasks, latest, bookings } = data;
  const flags = [...new Set(calls.flatMap((c) => c.flags))];
  const lastCall = calls[0];

  // Timeline: calls and activities, newest first.
  type Entry = { at: Date; key: string; node: ReactNode };
  const entries: Entry[] = [
    ...calls.map((c) => ({
      at: new Date(c.started_at),
      key: `call-${c.id}`,
      node: (
        <>
          <div>
            <strong>Call</strong> · {fmtDuration(c.duration_seconds)}{' '}
            <OutcomeBadge outcome={c.outcome} label={c.status === 'needs_review' ? 'Needs review' : label(OUTCOME_LABELS, c.outcome)} />{' '}
            {c.outside_hours ? <span className="badge">after hours</span> : null}{' '}
            {c.price_leak_flag ? <span className="badge bad">Price leak</span> : null}
          </div>
          {c.redacted_at ? (
            <p className="sub">Transcript deleted after the retention period.</p>
          ) : c.transcript && c.transcript.length ? (
            <details>
              <summary className="btn">View full transcript ({c.transcript.length} turns)</summary>
              <div className="transcript">
                {c.transcript.map((t, i) => (
                  <p key={i}>
                    <span className={t.speaker}>{t.speaker === 'agent' ? 'Agent' : 'Caller'}:</span> {t.text}
                  </p>
                ))}
              </div>
            </details>
          ) : (
            <p className="sub">No conversation (missed call).</p>
          )}
          {c.recording_url ? (
            <a href={c.recording_url} target="_blank" rel="noreferrer">
              Recording
            </a>
          ) : null}
        </>
      ),
    })),
    ...activities.map((a) => ({
      at: new Date(a.created_at),
      key: `act-${a.id}`,
      node: (
        <div>
          <strong>{a.kind === 'note' ? `Note by ${a.author_name}` : a.author_name}</strong>
          {a.kind === 'note' ? <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{a.body}</p> : <> · {a.body}</>}
        </div>
      ),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const nowLocal = new Date(Date.now() + 5.5 * 3600_000 + 86_400_000).toISOString().slice(0, 16); // tomorrow, studio time

  return (
    <>
      <div className="page-head">
        <div>
          <p className="sub">
            <a href="/pipeline">Pipeline</a> /
          </p>
          <h1>{head.name ?? head.phone}</h1>
          <p className="sub">
            {head.phone}
            {head.email ? ` · ${head.email}` : ''} · {head.stage ? STAGE_LABELS[head.stage as keyof typeof STAGE_LABELS] : 'Complaint (not a sales lead)'}
            {head.designer_name ? ` · ${head.designer_name}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <ScoreBadge score={head.score} reasons={head.score_reasons} />
          {lastCall ? <OutcomeBadge outcome={lastCall.outcome} label={`Last call: ${label(OUTCOME_LABELS, lastCall.outcome)}`} /> : null}
        </div>
      </div>
      <Flash sp={sp} />

      <div className="layout-lead">
        <div className="stack-gap">
          <section className="card">
            <h2>Summary</h2>
            {latest ? (
              <>
                <p>{latest.handoff_note}</p>
                <dl className="facts">
                  <dt>Area</dt>
                  <dd>{latest.project.area_locality ?? '—'}</dd>
                  <dt>Scope</dt>
                  <dd>{latest.project.scope_summary}</dd>
                  <dt>Size</dt>
                  <dd>{latest.project.size_sqft ? `${latest.project.size_sqft.toLocaleString('en-IN')} sq ft` : '—'}</dd>
                  <dt>Current state</dt>
                  <dd>{latest.project.state ?? '—'}</dd>
                  <dt>Timeline</dt>
                  <dd>{latest.timeline.stated ?? '—'}</dd>
                  <dt>Budget</dt>
                  <dd>{latest.budget.stated ?? (latest.budget.volunteered ? 'Mentioned' : 'Not discussed')}</dd>
                  <dt>Decision-maker</dt>
                  <dd>{latest.decision_maker.note ?? (latest.decision_maker.is_caller ? 'Caller' : '—')}</dd>
                  <dt>Wants from us</dt>
                  <dd>{latest.expectations_verbatim ? `“${latest.expectations_verbatim}”` : '—'}</dd>
                  <dt>Found us via</dt>
                  <dd>{head.referral_source ?? '—'}</dd>
                  {latest.complaint.summary ? (
                    <>
                      <dt>Complaint</dt>
                      <dd>
                        {latest.complaint.summary}
                        {latest.complaint.designer_named ? ` (designer: ${latest.complaint.designer_named})` : ''}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </>
            ) : (
              <p className="empty">No details captured yet (missed call or needs review).</p>
            )}
          </section>

          {lastCall?.criteria ? (
            <section className="card">
              <h2>Rubric (latest call)</h2>
              <dl className="facts">
                {CRITERIA_ORDER.filter((k) => lastCall.criteria?.[k]).map((k) => [k, lastCall.criteria![k]!] as const).map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{label(CRITERION_LABELS, k)}</dt>
                    <dd>
                      <span className={`badge ${RESULT_TONE[v] ?? ''}`}>{v}</span>{' '}
                      <span className="sub">{latest?.criteria[k as keyof typeof latest.criteria]?.reason}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              {lastCall.decline_reason ? <p style={{ marginTop: 10 }}>Declined: {label(DECLINE_LABELS, lastCall.decline_reason)}</p> : null}
              {lastCall.open_question ? <p style={{ marginTop: 10 }}>Open question: {lastCall.open_question}</p> : null}
              {flags.length ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {flags.map((f) => (
                    <span key={f} className="badge warn">{label(FLAG_LABELS, f)}</span>
                  ))}
                </div>
              ) : null}
              {head.score_reasons?.length ? <p className="sub" style={{ marginTop: 10 }}>Score: {head.score_reasons.join(' · ')}</p> : null}
            </section>
          ) : null}

          <section className="card">
            <h2>Timeline</h2>
            <form action={addNote} style={{ marginBottom: 12 }}>
              <input type="hidden" name="enquiryId" value={id} />
              <label htmlFor="note">Add a note</label>
              <textarea id="note" name="body" rows={2} maxLength={2000} required placeholder="What happened? e.g. Site visit done, sending proposal Friday." />
              <div style={{ marginTop: 6 }}>
                <button type="submit" className="primary">Add note</button>
              </div>
            </form>
            <ul className="timeline">
              {entries.map((e) => (
                <li key={e.key}>
                  <div className="when">{fmtDateTime(e.at)}</div>
                  {e.node}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="stack-gap">
          {bookings.length ? (
            <section className="card">
              <h2>Consultation</h2>
              <ul className="timeline">
                {bookings.map((b) => (
                  <li key={b.id}>
                    <strong>{fmtDateTime(b.start_at)}</strong>{' '}
                    <span className={`badge ${b.status === 'cancelled' ? 'bad' : 'ok'}`}>{b.status === 'cancelled' ? 'Cancelled' : 'Booked'}</span>
                    <div className="sub">
                      {b.location_type === 'online' ? 'Online (video)' : b.location_type === 'studio' ? 'At the studio' : 'Location in booking'}
                      {b.designer ? ` · ${b.designer}` : ''}
                    </div>
                    {b.meeting_url && b.status !== 'cancelled' ? (
                      <a href={b.meeting_url} target="_blank" rel="noreferrer">
                        Video link
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {head.stage ? (
            <section className="card">
              <h2>Stage</h2>
              <form action={moveStageForm}>
                <input type="hidden" name="enquiryId" value={id} />
                <div className="form-row">
                  <select name="stage" defaultValue={head.stage} aria-label="Stage">
                    {LEAD_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <label htmlFor="lostReason">If lost, why?</label>
                <div className="form-row">
                  <input id="lostReason" name="lostReason" defaultValue={head.stage === 'lost' ? (head.lost_reason ?? '') : ''} placeholder="e.g. Went with another studio" style={{ flex: 1 }} />
                  <button type="submit">Update stage</button>
                </div>
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

          <section className="card">
            <h2>Open tasks</h2>
            {tasks.length === 0 ? (
              <p className="empty">Nothing open.</p>
            ) : (
              <ul className="timeline">
                {tasks.map((t) => (
                  <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <span className="badge">{label(TASK_TYPE_LABELS, t.type)}</span> {t.title ?? ''}
                      {t.question ? <div className="sub">{t.question}</div> : null}
                      <div className="when">
                        Due {fmtDateTime(t.due_at)}
                        {t.assignee ? ` · ${t.assignee}` : ' · front desk'}
                      </div>
                    </div>
                    <form action={completeTask}>
                      <input type="hidden" name="taskId" value={t.id} />
                      <input type="hidden" name="returnTo" value={`/leads/${id}`} />
                      <button type="submit">Done</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addReminder} style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <input type="hidden" name="enquiryId" value={id} />
              <label htmlFor="title">New reminder</label>
              <input id="title" name="title" required placeholder="e.g. Send proposal" style={{ width: '100%', marginBottom: 8 }} />
              <div className="form-row">
                <input type="datetime-local" name="due" required defaultValue={nowLocal} aria-label="Due" />
                <select name="assignee" defaultValue={session.id} aria-label="For">
                  {data.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name ?? s.email}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit">Add reminder</button>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}
