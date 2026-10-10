# Decisions and open items

The source brief is "Build brief: Aangan Studio inbound call agent". This file records what was decided after it.

## Product decisions (2026-10-09)

- **No "free consultation."** The agent never says the consultation is free. Once a lead qualifies, it offers: "Would you like to set up a consultation? That's the next step."
- **Consultations: online or at the studio.** For a qualified lead who wants one, the agent asks online vs studio and the caller's preferred time, checks designer availability, offers only free slots, books, and confirms the email. Online → cal.com confirmation with the video link; studio → confirmation with time and studio address (`STUDIO_ADDRESS`; never invented). The designer is never named on the call.
- **The dashboard is internal only** (founder/admin, designers, front desk). The only customer touchpoints are the call (`/talk` for WebRTC) and the booking confirmation.
- **Fully automated.** The bot runs when the front desk or Nikhil isn't available, and Nikhil does not sign off on rules. Uncertain rules are stored in `config` with `confirmed = false` and can be edited on the Settings page.
- **Telegram.** Every call's summary and transcript go to the studio team group, and qualified leads also go to the assigned designer. The Acknowledge button is kept for metrics only; nobody is asked to act at night, and there is no escalation timer.
- **Voice: Vaani over WebRTC.** Callers use the public `/talk` page (name, mobile, language, recording consent). The server starts each Vaani session with the versioned `prompts/voice_agent.md` and the greeting; the transcript arrives in Vaani's `call_postprocessing` webhook, secured with a secret URL token because Vaani doesn't sign webhooks. Sessions are rate-limited per number and overall.
- **Callbacks are dashboard reminders.** A missed or dropped call creates a "call back" task on the dashboard; it is cancelled automatically if the caller rings back. The bot does not call out.
- **Extraction: Gemini** (model in `GEMINI_MODEL`), JSON validated against the schema, one retry with the errors, then `needs_review`.
- **Complaints.** The bot collects name, project, designer and issue, and tells the caller the team will get back to them during studio hours. It makes no "15 minutes" promise. Details go to the team Telegram group and the dashboard.
- **Referral source.** Captured if the caller mentions it. The agent may ask once, lightly, and never pushes.
- **CRM.** After every call, the transcript and all lead details (scope, budget, location, size, timeline, expectations) go to the dashboard and to HubSpot.

## Infrastructure

- **Database: Neon Postgres**, not Supabase (the Supabase limit is reached). RLS is enforced by switching dashboard queries to the `app_dashboard` role with `app.user_id` set for each transaction. Webhooks and jobs run as the table owner.

## Rule interpretations (defaults, editable in config)

| Topic | Default |
|---|---|
| Timeline | Two fields: completion deadline and site availability. Completion in under 6 weeks = fail; completion in 6–10 weeks = pass, flagged. Site available more than 10 weeks out = pass, flagged as a future project. |
| Commercial minimum | 500 sq ft (from T18 only; unconfirmed). |
| Service area | Allow / deny / borderline lists. A borderline area gets one clarifying question, and if it is still unclear the lead goes to `unsure`. |
| Lone fail on criterion 5 | `unsure` |
| Intent "other" | `declined`, reason `not_an_enquiry` |
| "Missed" | No answer, provider failure, or the caller hung up before giving usable detail. Creates a bot callback. |
| In-call booking | Real booking, marked `provisional`. The post-call `decideOutcome` is final; a mismatch goes to `booking_review`. |
| Budget | Judged by the LLM signal; there is no server-side price floor. The agent never repeats the caller's number. |
| Named dates (Diwali etc.) | Resolved by code from `festival_dates` plus the call date. |
| Retention | 30 days, then transcripts, recordings and caller personal details are redacted. |
| Dashboard login | Staff only, matched on email in the `staff` table. Method still open. |

## Agent must not copy from the September transcripts

- "Consultation is free / no obligation" (T02, T13)
- Design or execution durations (T07, T15)
- Promising a specific person, such as "principal designer" (T12)
- "Hold for two minutes" transfers (T09)
- Repeating the caller's budget figure or giving relative price hints such as "3× the cost" (T10, T13)

## Open

- Vaani: confirm Marathi support and per-minute cost; register the webhook URL in Vaani (Settings → Webhooks).
- Real designer roster, cal.com event types, Telegram chat IDs.
- Vercel plan (decides how scheduled jobs run: the bot's callback retries and the daily 30-day cleanup).
- Dashboard sign-in method.
