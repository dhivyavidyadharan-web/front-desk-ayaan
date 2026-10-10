// The project brief a designer reads before anything else: the agent's note, the facts in
// plain words, and anything to watch for. Shared by the lead page and the transcript page.
import type { Extraction } from '@/core/extraction';
import { DECLINE_LABELS, FLAG_LABELS, label } from '@/crm/labels';

const TYPE: Record<string, string> = {
  residential_full: 'Full home',
  residential_partial: 'Part of a home',
  single_room: 'Single room',
  commercial_office: 'Office / commercial',
  other: 'Other',
};

function budget(x: Extraction): string {
  if (x.budget.stated) return x.budget.stated;
  return x.budget.volunteered ? 'Mentioned' : 'Not discussed (designer to discuss)';
}

function decides(x: Extraction): string {
  if (x.decision_maker.note) return x.decision_maker.note;
  if (x.decision_maker.is_caller) return 'The caller';
  return 'Not discussed';
}

export function Brief({
  x,
  flags = [],
  openQuestion,
  declineReason,
  referral,
}: {
  x: Extraction | null;
  flags?: string[];
  openQuestion?: string | null;
  declineReason?: string | null;
  referral?: string | null;
}) {
  if (!x) return <p className="empty">No details captured (missed call, or the call is waiting for review).</p>;
  const things = [
    ...flags.map((f) => label(FLAG_LABELS, f)),
    ...(openQuestion ? [`Still to ask: ${openQuestion}`] : []),
    ...(declineReason ? [`Not a fit: ${label(DECLINE_LABELS, declineReason)}`] : []),
  ];
  const facts: [string, string | null][] = [
    ['Area', x.project.area_locality],
    ['Project', [TYPE[x.project.type] ?? x.project.type, x.project.type_detail].filter(Boolean).join(' · ')],
    ['Scope', x.project.scope_summary],
    ['Size', x.project.size_sqft ? `${x.project.size_sqft.toLocaleString('en-IN')} sq ft` : null],
    ['Current state', x.project.state],
    ['Timeline', x.timeline.stated],
    ['Budget', budget(x)],
    ['Who decides', decides(x)],
    ['What they want', x.expectations_verbatim ? `“${x.expectations_verbatim}”` : null],
    ['Found us via', referral ?? x.referral_source],
  ];
  return (
    <div className="brief">
      {x.handoff_note ? <p className="brief-note">{x.handoff_note}</p> : null}
      <dl className="facts">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {x.complaint.summary ? (
        <p className="brief-alert">
          Complaint: {x.complaint.summary}
          {x.complaint.designer_named ? ` (designer: ${x.complaint.designer_named})` : ''}
        </p>
      ) : null}
      {things.length ? (
        <div className="brief-things">
          <span className="sub">Things to know</span>
          <ul>
            {things.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
