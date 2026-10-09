import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, configFromRows } from '@/core/config';
import { shouldJoinPreviousEnquiry } from '@/core/enquiry';
import { ExtractionSchema } from '@/core/extraction';
import { BASE_EXTRACTION } from './helpers/extraction';

describe('ExtractionSchema', () => {
  it('accepts a valid extraction', () => {
    expect(ExtractionSchema.safeParse(BASE_EXTRACTION).success).toBe(true);
  });

  it('rejects invented fields', () => {
    expect(ExtractionSchema.safeParse({ ...BASE_EXTRACTION, quoted_price: '5 lakh' }).success).toBe(false);
    expect(
      ExtractionSchema.safeParse({ ...BASE_EXTRACTION, project: { ...BASE_EXTRACTION.project, colour: 'blue' } }).success,
    ).toBe(false);
  });

  it('rejects a handoff note over 120 words', () => {
    const note = Array.from({ length: 121 }, () => 'word').join(' ');
    expect(ExtractionSchema.safeParse({ ...BASE_EXTRACTION, handoff_note: note }).success).toBe(false);
  });

  it('rejects values outside the enums', () => {
    expect(ExtractionSchema.safeParse({ ...BASE_EXTRACTION, intent: 'sales_pitch' }).success).toBe(false);
  });
});

describe('shouldJoinPreviousEnquiry (T17)', () => {
  const firstEnded = new Date('2026-09-22T14:15:12+05:30');

  it('callback 1 minute after a dropped call joins the same enquiry', () => {
    expect(shouldJoinPreviousEnquiry(firstEnded, new Date('2026-09-22T14:16:00+05:30'), 30)).toBe(true);
  });

  it('call after the window starts a new enquiry', () => {
    expect(shouldJoinPreviousEnquiry(firstEnded, new Date('2026-09-22T14:46:00+05:30'), 30)).toBe(false);
  });

  it('no previous call → new enquiry', () => {
    expect(shouldJoinPreviousEnquiry(null, new Date(), 30)).toBe(false);
  });
});

describe('configFromRows', () => {
  it('reads snake_case rows and falls back to defaults', () => {
    const c = configFromRows([{ key: 'min_commercial_sqft', value: 300 }]);
    expect(c.minCommercialSqft).toBe(300);
    expect(c.minLeadTimeWeeksFail).toBe(DEFAULT_CONFIG.minLeadTimeWeeksFail);
  });
});
