// Human wording for codes stored in the database.

export const OUTCOME_LABELS: Record<string, string> = {
  qualified: 'Qualified',
  declined: 'Declined',
  unsure: 'Unsure',
  escalate_complaint: 'Complaint',
  missed: 'Missed',
};

export const DECLINE_LABELS: Record<string, string> = {
  real_project: 'Not a real project',
  service_area: 'Outside service area',
  timeline: 'Timeline too short',
  budget: 'Budget too low',
  not_an_enquiry: 'Not an enquiry',
};

export const CRITERION_LABELS: Record<string, string> = {
  real_project: 'Real project',
  service_area: 'Service area',
  timeline: 'Timeline',
  budget: 'Budget',
  decision_maker: 'Decision-maker',
};

export const FLAG_LABELS: Record<string, string> = {
  asked_about_price: 'Asked about price (deflected)',
  tight_deadline: 'Tight deadline',
  execution_start_6_to_10_weeks: 'Execution starts in 6–10 weeks',
  future_project: 'Site not available for a while',
  borderline_area: 'Borderline area',
  out_of_scope_type: 'Out-of-scope project type',
  'unconfirmed_rule:min_commercial_sqft': 'Declined by unconfirmed 500 sq ft rule',
  decision_maker_represented: 'Decider not on the call but will attend',
  budget_unclear: 'Budget unclear',
  decision_maker_unclear: 'Decision-maker unclear',
  structural_expectations: 'Expects structural changes (we don’t do these)',
};

export const TASK_TYPE_LABELS: Record<string, string> = {
  callback: 'Call back',
  unsure: 'Follow up',
  complaint: 'Complaint',
  booking_review: 'Booking review',
  follow_up: 'Reminder',
};

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  front_desk: 'Front desk',
  designer: 'Designer',
};

export const label = (map: Record<string, string>, code: string | null | undefined) =>
  code ? (map[code] ?? code.replaceAll('_', ' ')) : '—';

const IST = 'Asia/Kolkata';
export const fmtDateTime = (d: Date | string | null) =>
  d
    ? new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(d))
    : '—';
export const fmtDate = (d: Date | string | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d)) : '—';
export const fmtInr = (n: number) =>
  n >= 1_00_00_000
    ? `₹${(n / 1_00_00_000).toFixed(1)} Cr`
    : n >= 1_00_000
      ? `₹${(n / 1_00_000).toFixed(1)} L`
      : `₹${Math.round(n).toLocaleString('en-IN')}`;
export const fmtDuration = (secs: number | null) =>
  secs === null ? '—' : `${Math.floor(secs / 60)}m ${String(Math.round(secs % 60)).padStart(2, '0')}s`;
