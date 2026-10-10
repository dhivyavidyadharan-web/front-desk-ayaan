// The September phone transcripts (fixtures/transcripts/*.json) as mock voice events, with the
// extraction a correct Gemini run should produce for each. Numbers are anonymised in the source,
// so each call gets a fake E.164 number (T17a/T17b share one: same caller).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Extraction } from '@/core/extraction';
import type { MockEvent } from '@/channels/voice/providers/mock';
import { extraction } from './extractionBuilder';

interface TranscriptFixture {
  id: string;
  started_at: string;
  answered: boolean;
  header: string;
  turns: { speaker: 'agent' | 'caller'; text: string }[];
}

const dir = fileURLToPath(new URL('./transcripts/', import.meta.url));

export const phoneFor = (id: string) => `+9198000001${id.slice(1, 3)}`;

function durationSeconds(f: TranscriptFixture): number | null {
  if (f.id === 'T17a') return 72;
  if (f.id === 'T17b') return 270;
  const m = f.header.match(/(\d+) min (\d+) sec/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function loadSeptemberEvents(): MockEvent[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const f = JSON.parse(readFileSync(dir + file, 'utf8')) as TranscriptFixture;
      const startedAt = new Date(f.started_at);
      const secs = durationSeconds(f);
      return {
        type: 'call_ended' as const,
        providerCallId: `sep-${f.id}`,
        from: phoneFor(f.id),
        direction: 'inbound' as const,
        startedAt,
        answeredAt: f.answered ? startedAt : null,
        endedAt: secs !== null ? new Date(startedAt.getTime() + secs * 1000) : startedAt,
        durationSeconds: secs,
        turns: f.turns,
        recordingUrl: null,
      };
    });
}

const unclear = (reason: string) => ({ result: 'unclear' as const, reason });
const noTimeline = { stated: null, weeks_until_needed_complete: null, weeks_until_site_available: null };

/** What a correct extraction of each answered call looks like. Keyed by provider call id. */
export const SEPTEMBER_EXTRACTIONS: Record<string, Extraction> = {
  'sep-T01': extraction({ caller: { name: 'Priya', phone: phoneFor('T01') }, referral_source: 'Friend: Shruti Joshi (Aundh client)' }),
  'sep-T02': extraction({
    caller: { name: null, phone: phoneFor('T02') },
    referral_source: 'Instagram',
    project: { area_locality: 'Wakad', size_sqft: 950, scope_summary: '2BHK full redesign: modular kitchen, wardrobes, living, both bedrooms.' },
    timeline: { stated: 'Move in November; design from October', weeks_until_needed_complete: null },
    asked_about_price: true,
  }),
  'sep-T03': extraction({
    caller: { name: 'Suresh Patil', phone: phoneFor('T03') },
    referral_source: 'LinkedIn',
    project: { type: 'residential_partial', area_locality: 'Nashik', in_service_area: 'no', size_sqft: null, scope_summary: 'Home office and study.' },
    timeline: noTimeline,
    criteria: { service_area: { result: 'fail', reason: 'Nashik' } },
  }),
  'sep-T04': extraction({
    caller: { name: null, phone: phoneFor('T04') },
    project: { type: 'single_room', service_wanted: 'advice_only', area_locality: null, in_service_area: 'unclear', size_sqft: null, scope_summary: 'Ideas for living room colours and furniture arrangement.' },
    timeline: noTimeline,
    criteria: { real_project: { result: 'fail', reason: 'suggestions only, not planning execution' } },
  }),
  'sep-T05': extraction({
    caller: { name: 'Aarti Mehta', phone: phoneFor('T05') },
    referral_source: 'Vikram Agarwal (friend of Nikhil)',
    project: { area_locality: 'Koregaon Park', size_sqft: 2400, scope_summary: '4BHK complete redesign: flooring, kitchen, four bedrooms.' },
    timeline: { stated: 'Move back in by February', weeks_until_needed_complete: 21 },
  }),
  'sep-T06': extraction({
    caller: { name: null, phone: phoneFor('T06') },
    project: { type: 'commercial_office', type_detail: 'startup office', area_locality: 'Baner', size_sqft: 800, state: 'bare shell', scope_summary: 'Workstations for 20, cabin, meeting room, break area.' },
    timeline: { stated: 'Operational by December', weeks_until_needed_complete: 13 },
  }),
  'sep-T07': extraction({
    caller: { name: null, phone: phoneFor('T07') },
    project: { type: 'residential_partial', area_locality: null, in_service_area: 'yes', size_sqft: null, scope_summary: 'Living room and kitchen.' },
    timeline: { stated: 'Wanted before Diwali; then asked about starting after Diwali; will think', weeks_until_needed_complete: null },
    criteria: { timeline: unclear('original deadline impossible; new start undecided') },
  }),
  'sep-T09': extraction({
    intent: 'existing_client_issue',
    caller: { name: 'Sheetal Deshpande', phone: phoneFor('T09') },
    project: { area_locality: 'Viman Nagar', size_sqft: null, scope_summary: 'Existing 2BHK project, three months in.' },
    timeline: noTimeline,
    complaint: { project: '2BHK Viman Nagar', designer_named: 'Aryan', summary: 'Designer has not replied in five days; three messages and two calls.' },
  }),
  'sep-T10': extraction({
    caller: { name: null, phone: phoneFor('T10') },
    project: { type: 'residential_partial', area_locality: 'Kharadi', size_sqft: 550, scope_summary: 'Kitchen and one bedroom in a 1BHK.' },
    timeline: noTimeline,
    budget: { volunteered: true, stated: '1 to 1.5 lakh maximum', signal: 'clearly_below' },
    criteria: { budget: { result: 'fail', reason: 'volunteered amount far below scope' } },
  }),
  'sep-T11': extraction({
    caller: { name: null, phone: phoneFor('T11') },
    project: { type: 'residential_partial', area_locality: 'Baner', size_sqft: null, state: 'rented, 3-year lease, bare', scope_summary: 'Living room, bedroom, kitchen; no structural changes.' },
    timeline: noTimeline,
  }),
  'sep-T12': extraction({
    caller: { name: 'Anand Sharma', phone: phoneFor('T12') },
    project: { area_locality: 'Kalyani Nagar', size_sqft: 5500, state: 'new construction, empty', scope_summary: 'Villa, ground plus two floors, end-to-end design.' },
    timeline: { stated: 'Move in March', weeks_until_needed_complete: 25 },
  }),
  'sep-T13': extraction({
    caller: { name: null, phone: phoneFor('T13') },
    project: { area_locality: 'Aundh', size_sqft: 1100, scope_summary: 'Kitchen, wardrobes in both bedrooms, living room.' },
    timeline: noTimeline,
    asked_about_price: true,
  }),
  'sep-T14': extraction({
    caller: { name: null, phone: phoneFor('T14') },
    project: { area_locality: 'Hadapsar', size_sqft: null, state: 'new possession', scope_summary: '3BHK proper design for parents.' },
    timeline: { stated: null, weeks_until_needed_complete: null },
    decision_maker: { is_caller: false, decider_will_attend: true, note: 'Caller is son; parents own and decide; both will attend.' },
    criteria: { decision_maker: unclear('caller is son') },
  }),
  'sep-T15': extraction({
    caller: { name: 'Smita', phone: phoneFor('T15') },
    project: { area_locality: 'Undri', size_sqft: 875, scope_summary: 'Full home: kitchen, wardrobes, living room.' },
    timeline: { stated: 'Possession in about six weeks; start design now', weeks_until_needed_complete: null, weeks_until_site_available: 6 },
  }),
  'sep-T16': extraction({
    caller: { name: 'Girish Nair', phone: phoneFor('T16') },
    project: { service_wanted: 'unclear', area_locality: 'Viman Nagar', size_sqft: null, scope_summary: '3BHK; details lost from first call.' },
    timeline: noTimeline,
    criteria: { real_project: unclear('scope not given'), timeline: unclear('not discussed') },
  }),
  'sep-T17a': extraction({
    conversation_substantive: false,
    caller: { name: null, phone: phoneFor('T17') },
    project: { type: 'other', service_wanted: 'unclear', area_locality: null, in_service_area: 'unclear', size_sqft: null, scope_summary: 'Line dropped before any detail.' },
    timeline: noTimeline,
  }),
  'sep-T17b': extraction({
    caller: { name: 'Ritu Kapoor', phone: phoneFor('T17') },
    project: { area_locality: 'Pimple Saudagar', size_sqft: 1050, state: 'lived in two years, builder furniture', scope_summary: 'Kitchen, wardrobes, living room.' },
    timeline: { stated: 'Ideally done by March', weeks_until_needed_complete: 24 },
  }),
  'sep-T18': extraction({
    caller: { name: null, phone: phoneFor('T18') },
    project: { type: 'commercial_office', type_detail: 'coworking pod', area_locality: null, in_service_area: 'unclear', size_sqft: 180, scope_summary: 'Lighting, desk, storage for a 180 sq ft pod.' },
    timeline: noTimeline,
  }),
  'sep-T19': extraction({
    caller: { name: null, phone: phoneFor('T19') },
    project: { type: 'other', type_detail: 'restaurant', area_locality: 'Koregaon Park', size_sqft: null, scope_summary: 'New restaurant interiors.' },
    timeline: noTimeline,
  }),
  'sep-T20': extraction({
    caller: { name: 'Pooja', phone: phoneFor('T20') },
    project: { area_locality: 'Magarpatta', size_sqft: 900, scope_summary: 'Kitchen, both bedrooms, living room.' },
    timeline: { stated: 'January start for execution', weeks_until_needed_complete: null, weeks_until_site_available: 0 },
    decision_maker: { is_caller: true, decider_will_attend: true, note: 'Husband and wife both attending.' },
  }),
};

/** Expected outcome per call (brief §8 plus agreed extras). */
export const SEPTEMBER_EXPECTED: Record<string, string> = {
  'sep-T01': 'qualified', 'sep-T02': 'qualified', 'sep-T03': 'declined', 'sep-T04': 'declined',
  'sep-T05': 'qualified', 'sep-T06': 'qualified', 'sep-T07': 'unsure', 'sep-T08': 'missed',
  'sep-T09': 'escalate_complaint', 'sep-T10': 'declined', 'sep-T11': 'qualified', 'sep-T12': 'qualified',
  'sep-T13': 'qualified', 'sep-T14': 'qualified', 'sep-T15': 'qualified', 'sep-T16': 'unsure',
  'sep-T17a': 'missed', 'sep-T17b': 'qualified', 'sep-T18': 'declined', 'sep-T19': 'declined',
  'sep-T20': 'qualified',
};
