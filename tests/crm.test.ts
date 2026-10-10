import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/core/config';
import { nextStageAfterCall, scoreLead } from '@/core/crm';
import { decideOutcome } from '@/core/decideOutcome';
import { extraction } from '../fixtures/extractionBuilder';

describe('nextStageAfterCall', () => {
  it('a new qualified call enters the pipeline as qualified', () => {
    expect(nextStageAfterCall(null, 'qualified')).toBe('qualified');
  });
  it('a declined call is lost', () => {
    expect(nextStageAfterCall(null, 'declined')).toBe('lost');
  });
  it('unsure and missed calls start as new', () => {
    expect(nextStageAfterCall(null, 'unsure')).toBe('new');
    expect(nextStageAfterCall(null, 'missed')).toBe('new');
  });
  it('a dropped call then a qualified callback moves new → qualified (T17)', () => {
    expect(nextStageAfterCall(nextStageAfterCall(null, 'missed'), 'qualified')).toBe('qualified');
  });
  it('never drags a lead backwards', () => {
    expect(nextStageAfterCall('won', 'qualified')).toBe('won');
    expect(nextStageAfterCall('proposal_sent', 'declined')).toBe('proposal_sent');
    expect(nextStageAfterCall('consultation_booked', 'missed')).toBe('consultation_booked');
  });
  it('a lost lead that calls back and qualifies re-enters', () => {
    expect(nextStageAfterCall('lost', 'qualified')).toBe('qualified');
  });
  it('complaints are not sales leads', () => {
    expect(nextStageAfterCall(null, 'escalate_complaint')).toBeNull();
    expect(nextStageAfterCall('won', 'escalate_complaint')).toBe('won');
  });
});

describe('scoreLead', () => {
  const at = new Date('2026-09-10T10:00:00+05:30');
  const score = (patch: Parameters<typeof extraction>[0]) => {
    const e = extraction(patch);
    return scoreLead(e, decideOutcome({ answered: true, startedAt: at }, e, DEFAULT_CONFIG));
  };

  it('referred full-home lead with a near timeline is hot', () => {
    expect(score({ referral_source: 'Friend' })?.score).toBe('hot');
  });

  it('single room, no timeline, no referral is cold', () => {
    const s = score({
      project: { type: 'single_room', size_sqft: 200 },
      timeline: { weeks_until_needed_complete: null, weeks_until_site_available: null },
      decision_maker: { is_caller: null, decider_will_attend: null },
    });
    expect(s?.score).toBe('cold');
  });

  it('explains the score', () => {
    expect(score({ referral_source: 'Friend' })?.reasons).toContain('Referred: Friend');
  });

  it('declined leads are not scored', () => {
    expect(score({ project: { area_locality: 'Nashik' } })).toBeNull();
  });
});
