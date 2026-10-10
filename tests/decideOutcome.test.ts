// Expected outcomes from brief §8 plus the extra September calls agreed in docs/decisions.md.
// Each fixture is what a correct extraction of that call looks like.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/core/config';
import { decideOutcome } from '@/core/decideOutcome';
import { extraction } from '../fixtures/extractionBuilder';

const call = (iso: string) => ({ answered: true, startedAt: new Date(iso) });
const decide = (iso: string, e: ReturnType<typeof extraction> | null, config = DEFAULT_CONFIG) =>
  decideOutcome(call(iso), e, config);

describe('brief §8 cases', () => {
  it('T01: 3BHK Kothrud, owner, March → qualified', () => {
    const d = decide('2026-09-02T10:23:00+05:30', extraction());
    expect(d.outcome).toBe('qualified');
    expect(d.flags).toEqual([]);
  });

  it('T02: 2BHK Wakad, pushed twice for a price → qualified, asked_about_price', () => {
    const d = decide(
      '2026-09-03T14:41:00+05:30',
      extraction({
        project: { area_locality: 'Wakad', size_sqft: 950 },
        timeline: { stated: 'Move in November, design from October', weeks_until_needed_complete: null },
        asked_about_price: true,
      }),
    );
    expect(d.outcome).toBe('qualified');
    expect(d.flags).toContain('asked_about_price');
  });

  it('T13: 3BHK Aundh, pushed for a range → qualified, asked_about_price', () => {
    const d = decide(
      '2026-09-16T12:19:00+05:30',
      extraction({
        project: { area_locality: 'Aundh', size_sqft: 1100 },
        timeline: { stated: null, weeks_until_needed_complete: null, weeks_until_site_available: null },
        asked_about_price: true,
      }),
    );
    expect(d.outcome).toBe('qualified');
    expect(d.flags).toContain('asked_about_price');
  });

  it('T03: Nashik → declined (service area)', () => {
    const d = decide(
      '2026-09-03T16:15:00+05:30',
      extraction({
        project: { type: 'residential_partial', area_locality: 'Nashik', in_service_area: 'no', size_sqft: null },
        criteria: { service_area: { result: 'fail', reason: 'Nashik' } },
      }),
    );
    expect(d).toMatchObject({ outcome: 'declined', declineReason: 'service_area' });
  });

  it('T04: ideas only → declined (not a real project)', () => {
    const d = decide(
      '2026-09-04T11:07:00+05:30',
      extraction({
        project: { type: 'single_room', service_wanted: 'advice_only', area_locality: null, in_service_area: 'unclear' },
        criteria: { real_project: { result: 'fail', reason: 'suggestions only' } },
      }),
    );
    expect(d).toMatchObject({ outcome: 'declined', declineReason: 'real_project' });
  });

  it('T07: Diwali in 3 weeks, then "start after Diwali" → unsure, one timeline question', () => {
    // The human front desk never asked the location; the bot always does (question 1),
    // so this fixture assumes an in-area answer and isolates the timeline.
    const d = decide(
      '2026-09-08T09:44:00+05:30',
      extraction({
        project: { type: 'residential_partial', area_locality: null, in_service_area: 'yes' },
        timeline: { stated: 'Wanted before Diwali; then asked about starting after Diwali; will think', weeks_until_needed_complete: null },
        criteria: { timeline: { result: 'unclear', reason: 'original deadline impossible; new start undecided' } },
      }),
    );
    expect(d.outcome).toBe('unsure');
    expect(d.openQuestion).toMatch(/complete/);
  });

  it('T07 as first asked: complete in 3 weeks → declined (timeline)', () => {
    const d = decide('2026-09-08T09:44:00+05:30', extraction({ timeline: { weeks_until_needed_complete: 3 } }));
    expect(d).toMatchObject({ outcome: 'declined', declineReason: 'timeline' });
  });

  it('T08: missed call at 10:47pm → missed', () => {
    const d = decideOutcome({ answered: false, startedAt: new Date('2026-09-09T22:47:00+05:30') }, null, DEFAULT_CONFIG);
    expect(d.outcome).toBe('missed');
  });

  it('T09: existing client complaint → escalate_complaint, no rubric', () => {
    const d = decide(
      '2026-09-10T11:32:00+05:30',
      extraction({
        intent: 'existing_client_issue',
        complaint: { project: '2BHK Viman Nagar', designer_named: 'Aryan', summary: 'No reply from designer for five days' },
      }),
    );
    expect(d).toMatchObject({ outcome: 'escalate_complaint', criteria: null });
  });

  it('T10: Rs 1–1.5 lakh for kitchen + bedroom → declined (budget)', () => {
    const d = decide(
      '2026-09-11T14:04:00+05:30',
      extraction({
        project: { type: 'residential_partial', area_locality: 'Kharadi', size_sqft: 550 },
        budget: { volunteered: true, stated: '1 to 1.5 lakh maximum', signal: 'clearly_below' },
        criteria: { budget: { result: 'fail', reason: 'volunteered amount far below scope' } },
      }),
    );
    expect(d).toMatchObject({ outcome: 'declined', declineReason: 'budget' });
  });

  it('T11: rented flat, no structural change → qualified', () => {
    const d = decide(
      '2026-09-12T10:18:00+05:30',
      extraction({
        project: { type: 'residential_partial', area_locality: 'Baner', state: 'rented, bare', structural_changes_wanted: false },
      }),
    );
    expect(d.outcome).toBe('qualified');
  });

  it('T14: son calling for parents who will attend → qualified, decision-maker noted', () => {
    const d = decide(
      '2026-09-17T11:41:00+05:30',
      extraction({
        project: { area_locality: 'Hadapsar', size_sqft: null, state: 'new possession' },
        timeline: { stated: null, weeks_until_needed_complete: null },
        decision_maker: { is_caller: false, decider_will_attend: true, note: 'Parents own and decide; both will attend' },
        criteria: { decision_maker: { result: 'unclear', reason: 'caller is son' } },
      }),
    );
    expect(d.outcome).toBe('qualified');
    expect(d.flags).toContain('decision_maker_represented');
  });

  it('T15: possession in 6 weeks → qualified with timeline flag', () => {
    const d = decide(
      '2026-09-18T15:12:00+05:30',
      extraction({
        project: { area_locality: 'Undri', size_sqft: 875 },
        timeline: { stated: 'Possession in about six weeks', weeks_until_needed_complete: null, weeks_until_site_available: 6 },
      }),
    );
    expect(d.outcome).toBe('qualified');
    expect(d.flags).toContain('execution_start_6_to_10_weeks');
  });

  it('T18: 180 sq ft coworking pod → declined, flagged as unconfirmed rule', () => {
    const d = decide(
      '2026-09-23T11:55:00+05:30',
      extraction({
        project: { type: 'commercial_office', type_detail: 'coworking pod', area_locality: null, in_service_area: 'unclear', size_sqft: 180 },
      }),
    );
    expect(d).toMatchObject({ outcome: 'declined', declineReason: 'real_project' });
    expect(d.flags).toContain('unconfirmed_rule:min_commercial_sqft');
  });

  it('T19: restaurant → declined (out of scope)', () => {
    const d = decide(
      '2026-09-24T16:02:00+05:30',
      extraction({ project: { type: 'other', type_detail: 'restaurant', area_locality: 'Koregaon Park', size_sqft: null } }),
    );
    expect(d).toMatchObject({ outcome: 'declined', declineReason: 'real_project' });
    expect(d.flags).toContain('out_of_scope_type');
  });
});

describe('T17: dropped call then callback', () => {
  it('first 1-minute call with no detail → missed (bot calls back)', () => {
    const d = decide('2026-09-22T14:14:00+05:30', extraction({ conversation_substantive: false }));
    expect(d.outcome).toBe('missed');
  });

  it('second call → qualified', () => {
    const d = decide(
      '2026-09-22T14:16:00+05:30',
      extraction({ project: { area_locality: 'Pimple Saudagar', size_sqft: 1050 } }),
    );
    expect(d.outcome).toBe('qualified');
  });
});

describe('other September calls', () => {
  it.each([
    ['T05: 4BHK Koregaon Park, February', { project: { area_locality: 'Koregaon Park', size_sqft: 2400 }, timeline: { weeks_until_needed_complete: 21 } }],
    ['T06: 800 sq ft office Baner, December', { project: { type: 'commercial_office', type_detail: 'startup office', area_locality: 'Baner', size_sqft: 800 }, timeline: { weeks_until_needed_complete: 13 } }],
    ['T12: 5,500 sq ft villa Kalyani Nagar, March', { project: { area_locality: 'Kalyani Nagar', size_sqft: 5500 } }],
    ['T20: 2BHK Magarpatta, January start', { project: { area_locality: 'Magarpatta', size_sqft: 900 }, timeline: { weeks_until_needed_complete: null, weeks_until_site_available: 0 } }],
  ] as const)('%s → qualified', (_, patch) => {
    expect(decide('2026-09-05T10:52:00+05:30', extraction(patch as never)).outcome).toBe('qualified');
  });

  it('T16: details lost on first call, only "3BHK Viman Nagar" → unsure', () => {
    const d = decide(
      '2026-09-19T10:38:00+05:30',
      extraction({
        project: { service_wanted: 'unclear', area_locality: 'Viman Nagar', size_sqft: null },
        timeline: { stated: null, weeks_until_needed_complete: null, weeks_until_site_available: null },
        criteria: {
          real_project: { result: 'unclear', reason: 'scope not given' },
          timeline: { result: 'unclear', reason: 'not discussed' },
        },
      }),
    );
    expect(d.outcome).toBe('unsure');
    expect(d.openQuestion).toMatch(/design with execution/);
  });
});

describe('rules', () => {
  it('borderline area → unsure with one question', () => {
    const d = decide('2026-09-10T10:00:00+05:30', extraction({ project: { area_locality: 'Wagholi' } }));
    expect(d.outcome).toBe('unsure');
    expect(d.flags).toContain('borderline_area');
  });

  it('"Hinjewadi Phase 3" is borderline even though "Hinjewadi" is allowed', () => {
    const d = decide('2026-09-10T10:00:00+05:30', extraction({ project: { area_locality: 'Hinjewadi Phase 3' } }));
    expect(d.flags).toContain('borderline_area');
  });

  it('locality not on any list → uses the extraction’s reading', () => {
    const d = decide('2026-09-10T10:00:00+05:30', extraction({ project: { area_locality: 'Sunderban, Aundh', in_service_area: 'yes' } }));
    expect(d.outcome).toBe('qualified');
  });

  it('completion in 8 weeks → qualified, tight deadline flagged', () => {
    const d = decide('2026-09-10T10:00:00+05:30', extraction({ timeline: { weeks_until_needed_complete: 8 } }));
    expect(d.outcome).toBe('qualified');
    expect(d.flags).toContain('tight_deadline');
  });

  it('site available in 20 weeks → qualified, future project flagged (even if the LLM said fail)', () => {
    const d = decide(
      '2026-09-10T10:00:00+05:30',
      extraction({
        timeline: { weeks_until_needed_complete: null, weeks_until_site_available: 20 },
        criteria: { timeline: { result: 'fail', reason: 'site not available within 10 weeks' } },
      }),
    );
    expect(d.outcome).toBe('qualified');
    expect(d.flags).toContain('future_project');
  });

  it('named deadline "Diwali" is resolved by code from the call date', () => {
    const early = decide('2026-09-08T09:44:00+05:30', extraction({ timeline: { weeks_until_needed_complete: null, named_deadline: 'Diwali' } }));
    expect(early.outcome).toBe('qualified');
    expect(early.flags).toContain('tight_deadline');
    const late = decide('2026-10-20T10:00:00+05:30', extraction({ timeline: { weeks_until_needed_complete: null, named_deadline: 'Diwali' } }));
    expect(late).toMatchObject({ outcome: 'declined', declineReason: 'timeline' });
  });

  it('asking about price never disqualifies', () => {
    expect(decide('2026-09-10T10:00:00+05:30', extraction({ asked_about_price: true })).outcome).toBe('qualified');
  });

  it('budget never fails unless the caller volunteered it', () => {
    const d = decide(
      '2026-09-10T10:00:00+05:30',
      extraction({ budget: { volunteered: false, signal: 'not_mentioned' }, criteria: { budget: { result: 'fail', reason: 'guess' } } }),
    );
    expect(d.outcome).toBe('qualified');
  });

  it('unclear budget or decision-maker → qualified with a note', () => {
    const d = decide(
      '2026-09-10T10:00:00+05:30',
      extraction({
        decision_maker: { is_caller: null },
        criteria: { budget: { result: 'unclear', reason: '' }, decision_maker: { result: 'unclear', reason: '' } },
      }),
    );
    expect(d.outcome).toBe('qualified');
    expect(d.flags).toEqual(expect.arrayContaining(['budget_unclear', 'decision_maker_unclear']));
  });

  it('lone fail on decision-maker → unsure', () => {
    const d = decide(
      '2026-09-10T10:00:00+05:30',
      extraction({
        decision_maker: { is_caller: false, decider_will_attend: false, note: 'initial research for in-laws' },
        criteria: { decision_maker: { result: 'fail', reason: 'no route to decider' } },
      }),
    );
    expect(d.outcome).toBe('unsure');
    expect(d.openQuestion).toMatch(/decides/);
  });

  it('two fails → declined, first failing criterion is the reason', () => {
    const d = decide(
      '2026-09-10T10:00:00+05:30',
      extraction({ project: { area_locality: 'Mumbai' }, timeline: { weeks_until_needed_complete: 2 } }),
    );
    expect(d).toMatchObject({ outcome: 'declined', declineReason: 'service_area' });
    expect(d.criteria?.timeline).toBe('fail');
  });

  it('office over 3,000 sq ft → declined', () => {
    const d = decide('2026-09-10T10:00:00+05:30', extraction({ project: { type: 'commercial_office', size_sqft: 4000 } }));
    expect(d).toMatchObject({ outcome: 'declined', declineReason: 'real_project' });
  });

  it('intent "other" → declined as not an enquiry', () => {
    const d = decide('2026-09-10T10:00:00+05:30', extraction({ intent: 'other' }));
    expect(d).toMatchObject({ outcome: 'declined', declineReason: 'not_an_enquiry' });
  });

  it('structural changes wanted → flagged for the designer, not declined', () => {
    const d = decide('2026-09-10T10:00:00+05:30', extraction({ project: { structural_changes_wanted: true } }));
    expect(d.outcome).toBe('qualified');
    expect(d.flags).toContain('structural_expectations');
  });

  it('rules come from config: lowering the commercial minimum qualifies T18', () => {
    const d = decide(
      '2026-09-23T11:55:00+05:30',
      extraction({ project: { type: 'commercial_office', type_detail: 'coworking pod', size_sqft: 180 } }),
      { ...DEFAULT_CONFIG, minCommercialSqft: 100 },
    );
    expect(d.outcome).toBe('qualified');
  });
});
