// CRM rules: pipeline stages and lead scoring. Pure functions, unit-tested.
import type { Decision, Outcome } from './decideOutcome';
import type { Extraction } from './extraction';

export const LEAD_STAGES = [
  'new',
  'qualified',
  'consultation_booked',
  'consultation_done',
  'proposal_sent',
  'won',
  'lost',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New enquiry',
  qualified: 'Qualified',
  consultation_booked: 'Consultation booked',
  consultation_done: 'Consultation done',
  proposal_sent: 'Proposal sent',
  won: 'Won',
  lost: 'Lost',
};

/** Stages where someone should be actively working the lead. */
export const ACTIVE_STAGES: LeadStage[] = ['qualified', 'consultation_booked', 'consultation_done', 'proposal_sent'];

/**
 * Where a lead sits after a call. A call never drags a lead backwards: a won client who calls
 * again stays won. A declined lead that calls back and qualifies re-enters the pipeline.
 */
export function nextStageAfterCall(current: LeadStage | null, outcome: Outcome): LeadStage | null {
  switch (outcome) {
    case 'escalate_complaint':
      return current;
    case 'qualified':
      return current === null || current === 'new' || current === 'lost' ? 'qualified' : current;
    case 'declined':
      return current === null || current === 'new' ? 'lost' : current;
    case 'unsure':
    case 'missed':
      return current ?? 'new';
  }
}

export type LeadScore = 'hot' | 'warm' | 'cold';

/**
 * Orders leads for follow-up. The rubric decides who qualifies; the score only ranks them.
 * Returns null for outcomes that aren't workable leads.
 */
export function scoreLead(e: Extraction | null, decision: Decision): { score: LeadScore; reasons: string[] } | null {
  if (!e || (decision.outcome !== 'qualified' && decision.outcome !== 'unsure')) return null;
  let points = 0;
  const reasons: string[] = [];
  const add = (n: number, reason: string) => {
    points += n;
    reasons.push(reason);
  };

  const weeks = e.timeline.weeks_until_needed_complete;
  if (weeks !== null && weeks >= 6 && weeks <= 26) add(2, 'Wants it done within 6 months');
  const site = e.timeline.weeks_until_site_available;
  if (site !== null && site <= 4) add(1, 'Site available now or soon');
  if (decision.flags.includes('future_project')) add(-1, 'Site not available for a while');

  if (e.project.type === 'residential_full') add(2, 'Full-home project');
  else if (e.project.type === 'commercial_office') add(2, 'Office fit-out');
  else if (e.project.type === 'residential_partial') add(1, 'Several rooms');
  if (e.project.size_sqft !== null && e.project.size_sqft >= 1500) add(1, 'Large space');

  if (e.referral_source) add(2, `Referred: ${e.referral_source}`);
  if (e.decision_maker.is_caller === true || e.decision_maker.decider_will_attend === true) {
    add(1, 'Decision-maker involved');
  }
  if (e.budget.signal === 'plausible') add(1, 'Budget plausible for scope');

  const score: LeadScore = points >= 6 ? 'hot' : points >= 3 ? 'warm' : 'cold';
  return { score, reasons };
}
