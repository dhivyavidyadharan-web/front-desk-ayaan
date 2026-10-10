import type { Extraction } from '@/core/extraction';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object | null ? DeepPartial<NonNullable<T[K]>> | T[K] : T[K] };

const pass = (reason = 'ok') => ({ result: 'pass' as const, reason });

/** A clean qualified lead (shaped on T01). Tests override only what differs. */
export const BASE_EXTRACTION: Extraction = {
  intent: 'new_enquiry',
  conversation_substantive: true,
  caller: { name: 'Priya', phone: '+919800000001', email: null },
  referral_source: null,
  project: {
    type: 'residential_full',
    type_detail: null,
    service_wanted: 'design_and_execution',
    area_locality: 'Kothrud',
    in_service_area: 'yes',
    size_sqft: 1400,
    state: 'builder finish, occupied',
    structural_changes_wanted: false,
    scope_summary: 'Full 3BHK redesign: kitchen, living room, both bedrooms.',
  },
  timeline: {
    stated: 'Done by March, no rush',
    weeks_until_needed_complete: 26,
    weeks_until_site_available: 0,
    named_deadline: null,
  },
  budget: { volunteered: false, stated: null, signal: 'not_mentioned' },
  decision_maker: { is_caller: true, decider_will_attend: null, note: null },
  criteria: {
    real_project: pass(),
    service_area: pass(),
    timeline: pass(),
    budget: pass('not mentioned'),
    decision_maker: pass(),
  },
  expectations_verbatim: null,
  asked_about_price: false,
  language: 'en',
  handoff_note: 'Full 3BHK redesign in Kothrud.',
  complaint: { project: null, designer_named: null, summary: null },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  return out as T;
}

export const extraction = (patch: DeepPartial<Extraction> = {}): Extraction => deepMerge(BASE_EXTRACTION, patch);
