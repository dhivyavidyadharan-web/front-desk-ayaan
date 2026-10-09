// Deterministic routing (brief §4.2, §8). The LLM extracts facts and per-criterion opinions;
// this function re-checks every criterion it can from the facts, using config, and decides.
// Where facts are missing it falls back to the LLM's opinion for that criterion.
import type { RubricConfig } from './config';
import type { CriterionKey, CriterionResult, Extraction } from './extraction';
import { matchServiceArea } from './locality';
import { weeksUntilNamedDeadline } from './timeline';

export type Outcome = 'qualified' | 'declined' | 'unsure' | 'escalate_complaint' | 'missed';

export interface CallFacts {
  /** false when nobody/no agent picked up, or the provider failed. */
  answered: boolean;
  startedAt: Date;
}

export interface Decision {
  outcome: Outcome;
  /** First failing criterion, or 'not_an_enquiry'. Null unless declined. */
  declineReason: CriterionKey | 'not_an_enquiry' | null;
  /** Final per-criterion results after code checks. Null when the rubric wasn't run. */
  criteria: Record<CriterionKey, CriterionResult> | null;
  flags: string[];
  /** The one clarifying question for the front desk. Null unless unsure. */
  openQuestion: string | null;
}

const CRITERIA_ORDER: CriterionKey[] = ['real_project', 'service_area', 'timeline', 'budget', 'decision_maker'];
const ASK_IF_UNCLEAR: CriterionKey[] = ['real_project', 'service_area', 'timeline'];

const OPEN_QUESTIONS: Record<CriterionKey, string> = {
  real_project: 'Is the caller looking for full design with execution, or advice only?',
  service_area: 'Is the property within Pune city or PCMC?',
  timeline: 'When does the caller need the project completed, and when is the site available?',
  budget: 'Does the caller have a budget in mind for this scope?',
  decision_maker: 'Will the person who decides attend the consultation?',
};

interface Check {
  result: CriterionResult;
  flags: string[];
}

export function decideOutcome(call: CallFacts, extraction: Extraction | null, config: RubricConfig): Decision {
  if (!call.answered || !extraction || !extraction.conversation_substantive) {
    return { outcome: 'missed', declineReason: null, criteria: null, flags: [], openQuestion: null };
  }

  const priceFlags = extraction.asked_about_price ? ['asked_about_price'] : [];

  if (extraction.intent === 'existing_client_issue') {
    return { outcome: 'escalate_complaint', declineReason: null, criteria: null, flags: priceFlags, openQuestion: null };
  }
  if (extraction.intent === 'other') {
    return { outcome: 'declined', declineReason: 'not_an_enquiry', criteria: null, flags: priceFlags, openQuestion: null };
  }

  const checks: Record<CriterionKey, Check> = {
    real_project: checkRealProject(extraction, config),
    service_area: checkServiceArea(extraction, config),
    timeline: checkTimeline(extraction, call.startedAt, config),
    budget: checkBudget(extraction),
    decision_maker: checkDecisionMaker(extraction),
  };
  const criteria = Object.fromEntries(CRITERIA_ORDER.map((k) => [k, checks[k].result])) as Record<
    CriterionKey,
    CriterionResult
  >;
  const flags = new Set<string>([...priceFlags, ...CRITERIA_ORDER.flatMap((k) => checks[k].flags)]);
  if (extraction.project.structural_changes_wanted) flags.add('structural_expectations');

  const decide = (outcome: Outcome, extra: Partial<Decision> = {}): Decision => ({
    outcome,
    declineReason: null,
    criteria,
    flags: [...flags],
    openQuestion: null,
    ...extra,
  });

  // One clear fail on criteria 1–4 → decline.
  const firstFail = CRITERIA_ORDER.find((k) => k !== 'decision_maker' && criteria[k] === 'fail');
  if (firstFail) return decide('declined', { declineReason: firstFail });

  // Unclear on 1–3 → one clarifying question, front-desk queue.
  const firstUnclear = ASK_IF_UNCLEAR.find((k) => criteria[k] === 'unclear');
  if (firstUnclear) return decide('unsure', { openQuestion: OPEN_QUESTIONS[firstUnclear] });

  // A lone fail on decision-maker → unsure rather than drop the lead.
  if (criteria.decision_maker === 'fail') return decide('unsure', { openQuestion: OPEN_QUESTIONS.decision_maker });

  // The LLM thought it was a wrong fit but no criterion failed → a human should look.
  if (extraction.intent === 'wrong_fit') {
    return decide('unsure', { openQuestion: 'Extraction marked this a wrong fit but no rule failed. Is it a fit?' });
  }

  // Unclear on 4 or 5 → qualified, noted for the designer.
  if (criteria.budget === 'unclear') flags.add('budget_unclear');
  if (criteria.decision_maker === 'unclear') flags.add('decision_maker_unclear');
  return decide('qualified', { flags: [...flags] });
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

function checkRealProject(e: Extraction, config: RubricConfig): Check {
  const detail = (e.project.type_detail ?? '').toLowerCase();
  if (config.outOfScopeProjectTypes.some((t) => detail.includes(t.toLowerCase()))) {
    return { result: 'fail', flags: ['out_of_scope_type'] };
  }
  if (['advice_only', 'sourcing_only', 'vastu_only'].includes(e.project.service_wanted)) {
    return { result: 'fail', flags: [] };
  }
  const size = e.project.size_sqft;
  if (e.project.type === 'commercial_office' && size !== null) {
    if (size < config.minCommercialSqft) {
      return { result: 'fail', flags: ['unconfirmed_rule:min_commercial_sqft'] };
    }
    if (size > config.maxCommercialSqft) return { result: 'fail', flags: [] };
  }
  if (e.project.service_wanted === 'design_and_execution') return { result: 'pass', flags: [] };
  return { result: e.criteria.real_project.result, flags: [] };
}

function checkServiceArea(e: Extraction, config: RubricConfig): Check {
  switch (matchServiceArea(e.project.area_locality, config)) {
    case 'allow':
      return { result: 'pass', flags: [] };
    case 'deny':
      return { result: 'fail', flags: [] };
    case 'borderline':
      return { result: 'unclear', flags: ['borderline_area'] };
    case 'unknown': {
      const map = { yes: 'pass', no: 'fail', unclear: 'unclear' } as const;
      return { result: map[e.project.in_service_area], flags: [] };
    }
  }
}

function checkTimeline(e: Extraction, callAt: Date, config: RubricConfig): Check {
  const t = e.timeline;
  const weeksComplete = t.weeks_until_needed_complete ?? weeksUntilNamedDeadline(t.named_deadline, callAt, config);
  const flags: string[] = [];
  // A known completion deadline decides the criterion. Without one, the LLM's reading stands
  // (e.g. T07: site available now, but the caller hasn't settled on a start).
  let result: CriterionResult = e.criteria.timeline.result;

  if (weeksComplete !== null) {
    if (weeksComplete < config.minLeadTimeWeeksFail) return { result: 'fail', flags: [] };
    if (weeksComplete <= config.leadTimeWeeksFlag) flags.push('tight_deadline');
    result = 'pass';
  }

  const site = t.weeks_until_site_available;
  if (site !== null) {
    if (site > config.futureProjectFlagWeeks) {
      // qualified.md read literally would fail this; decided: keep the lead, flag it.
      flags.push('future_project');
      if (result === 'fail') result = 'pass';
    } else if (site >= config.minLeadTimeWeeksFail) {
      flags.push('execution_start_6_to_10_weeks');
    }
  }

  return { result, flags };
}

function checkBudget(e: Extraction): Check {
  if (e.budget.volunteered && e.budget.signal === 'clearly_below') return { result: 'fail', flags: [] };
  if (e.criteria.budget.result === 'unclear') return { result: 'unclear', flags: [] };
  // Not mentioned or plausible → pass. Never fail on budget unless the caller volunteered a number.
  return { result: 'pass', flags: [] };
}

function checkDecisionMaker(e: Extraction): Check {
  const dm = e.decision_maker;
  if (dm.is_caller === true) return { result: 'pass', flags: [] };
  if (dm.decider_will_attend === true) return { result: 'pass', flags: ['decision_maker_represented'] };
  return { result: e.criteria.decision_maker.result, flags: [] };
}
