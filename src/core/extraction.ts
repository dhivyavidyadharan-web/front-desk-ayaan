// The strict JSON that Gemini returns for each call (brief §7, extended with decisions in
// docs/decisions.md). Facts only: routing is decided by code in decideOutcome.ts.
// `.strict()` everywhere so the model cannot add fields. Missing facts are null / "unclear".
import { z } from 'zod';

const nullableString = z.string().nullable();
const triState = z.enum(['pass', 'fail', 'unclear']);
const criterion = z.object({ result: triState, reason: z.string() }).strict();

export const ExtractionSchema = z
  .object({
    intent: z.enum(['new_enquiry', 'existing_client_issue', 'wrong_fit', 'other']),
    /** false when the caller hung up before giving any usable project detail. */
    conversation_substantive: z.boolean(),
    caller: z
      .object({
        name: nullableString,
        phone: z.string(),
        email: nullableString,
      })
      .strict(),
    referral_source: nullableString,
    project: z
      .object({
        type: z.enum(['residential_full', 'residential_partial', 'single_room', 'commercial_office', 'other']),
        /** Free-text kind of space when type is "other" or commercial, e.g. "restaurant", "coworking pod". */
        type_detail: nullableString,
        service_wanted: z.enum(['design_and_execution', 'advice_only', 'sourcing_only', 'vastu_only', 'unclear']),
        area_locality: nullableString,
        in_service_area: z.enum(['yes', 'no', 'unclear']),
        size_sqft: z.number().positive().nullable(),
        state: nullableString,
        structural_changes_wanted: z.boolean().nullable(),
        scope_summary: z.string(),
      })
      .strict(),
    timeline: z
      .object({
        stated: nullableString,
        /** Weeks from the call until the caller needs the project complete, if they gave a date or duration. */
        weeks_until_needed_complete: z.number().nullable(),
        /** Weeks from the call until the site is available for execution (e.g. possession). 0 = available now. */
        weeks_until_site_available: z.number().nullable(),
        /** A festival or event named as the deadline ("Diwali") when no date was given. Resolved by code. */
        named_deadline: nullableString,
      })
      .strict(),
    budget: z
      .object({
        volunteered: z.boolean(),
        stated: nullableString,
        signal: z.enum(['not_mentioned', 'plausible', 'clearly_below']),
      })
      .strict(),
    decision_maker: z
      .object({
        is_caller: z.boolean().nullable(),
        /** The real decider will attend the consultation (T14). */
        decider_will_attend: z.boolean().nullable(),
        note: nullableString,
      })
      .strict(),
    criteria: z
      .object({
        real_project: criterion,
        service_area: criterion,
        timeline: criterion,
        budget: criterion,
        decision_maker: criterion,
      })
      .strict(),
    expectations_verbatim: nullableString,
    asked_about_price: z.boolean(),
    language: z.enum(['en', 'hi', 'mr', 'mixed']),
    handoff_note: z
      .string()
      .refine((s) => s.trim().split(/\s+/).filter(Boolean).length <= 120, 'handoff_note must be at most 120 words'),
    complaint: z
      .object({
        project: nullableString,
        designer_named: nullableString,
        summary: nullableString,
      })
      .strict(),
    /** A consultation the caller agreed to on the call. Booked by our code on the designer's calendar. */
    consultation: z
      .object({
        agreed: z.boolean(),
        mode: z.enum(['online', 'studio']).nullable(),
        preferred_time: nullableString,
        /** The agreed slot as ISO 8601 with the +05:30 offset, resolved from the call date. */
        start_at: z.iso.datetime({ offset: true }).nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Extraction = z.infer<typeof ExtractionSchema>;
export type CriterionKey = keyof Extraction['criteria'];
export type CriterionResult = z.infer<typeof triState>;
