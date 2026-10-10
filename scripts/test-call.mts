// A scripted end-to-end test call into the LIVE dashboard: transcript → stored call → decision →
// lead on the board → cal.com booking → the Telegram message the designer gets.
// The extraction is hand-written here (in production Gemini produces it from the transcript).
// Usage: npm run test:call
import { MockVoiceProvider } from '../src/channels/voice/providers/mock';
import { createPool } from '../src/db/client';
import { parseCalWebhook } from '../src/integrations/calcom';
import { bookingMessage } from '../src/integrations/messages';
import { notifierFromEnv } from '../src/integrations/notifier';
import { FixtureExtractor } from '../src/llm/extractor';
import { recordCalEvent } from '../src/pipeline/bookings';
import { handleCallEnded } from '../src/pipeline/processCall';
import { extraction } from '../fixtures/extractionBuilder';

const db = createPool(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);
const PHONE = '+919800000999'; // made-up number
const id = `chat-test-${Date.now()}`;
const start = new Date();
const turns: { speaker: 'agent' | 'caller'; text: string }[] = [
  { speaker: 'agent', text: 'Good evening, Rahul! This is Ayaan from Aangan Studio. This call is recorded to help us serve you better. How can I help you today?' },
  { speaker: 'caller', text: 'Hi Ayaan. We just bought a 2BHK in Baner, possession is next month. We want to do the full interiors.' },
  { speaker: 'agent', text: 'Congratulations on the new home! A 2BHK in Baner, lovely. Roughly how big is it?' },
  { speaker: 'caller', text: 'Around 950 square feet. Kitchen, wardrobes, living room, both bedrooms.' },
  { speaker: 'agent', text: 'That sounds like a full home. Are you looking for full design with execution, or advice only?' },
  { speaker: 'caller', text: 'Full design and execution. We want to move in by February.' },
  { speaker: 'agent', text: 'Perfect. Are you the one deciding, or is someone else involved?' },
  { speaker: 'caller', text: 'Me and my wife. She will join the meeting. Waise, roughly kitna lagega?' },
  { speaker: 'agent', text: "Pricing depends on the site, the materials you choose, and the scope. Your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like." },
  { speaker: 'caller', text: 'Okay, fair. Designer ke saath discuss karenge.' },
  { speaker: 'agent', text: 'Of course. Last question: what are you hoping for from our team?' },
  { speaker: 'caller', text: 'Warm, minimal, lots of storage. And we want to see options, not just one design.' },
  { speaker: 'agent', text: "Got it. Would you like to set up a consultation? That's the next step. Online, or at our studio?" },
  { speaker: 'caller', text: 'Online. Saturday morning if possible.' },
  { speaker: 'agent', text: 'Saturday at 11am is free. Shall I book that? And your email is rahul.test@example.com, R-A-H-U-L dot T-E-S-T at example dot com?' },
  { speaker: 'caller', text: 'Yes, that works.' },
  { speaker: 'agent', text: "Booked. You'll get a confirmation email with the video link. Thank you for calling Aangan Studio, Rahul. Have a lovely evening!" },
];

try {
  const event = MockVoiceProvider.parseEvent({
    type: 'call_ended', providerCallId: id, from: PHONE,
    startedAt: start.toISOString(), answeredAt: start.toISOString(),
    endedAt: new Date(start.getTime() + 4 * 60_000).toISOString(), durationSeconds: 240, turns,
  });
  if (event.type !== 'call_ended') throw new Error('unexpected');

  const facts = extraction({
    caller: { name: 'Rahul (test call)', phone: PHONE, email: 'rahul.test@example.com' },
    referral_source: null,
    project: {
      type: 'residential_full', area_locality: 'Baner', size_sqft: 950, state: 'new possession next month',
      scope_summary: '2BHK full home: kitchen, wardrobes, living room, both bedrooms.',
    },
    timeline: { stated: 'Possession next month; move in by February', weeks_until_needed_complete: 17, weeks_until_site_available: 4 },
    decision_maker: { is_caller: true, decider_will_attend: true, note: 'Rahul and his wife decide; both will attend.' },
    expectations_verbatim: 'Warm, minimal, lots of storage. We want to see options, not just one design.',
    asked_about_price: true,
    language: 'mixed',
    handoff_note: 'Rahul, 2BHK (950 sq ft) in Baner, possession next month, wants to move in by February. Full home with execution. Warm, minimal, lots of storage; wants options. Wife will attend. Asked about price (deflected).',
  });

  // Booking first: the agent books during the call, so cal.com's webhook usually lands before the transcript.
  const sat = new Date(start);
  sat.setUTCDate(sat.getUTCDate() + ((6 - sat.getUTCDay() + 7) % 7 || 7));
  sat.setUTCHours(5, 30, 0, 0); // 11:00 IST
  await recordCalEvent(db, parseCalWebhook({
    triggerEvent: 'BOOKING_CREATED',
    payload: {
      uid: `${id}-booking`, startTime: sat.toISOString(), location: 'integrations:daily',
      attendees: [{ name: 'Rahul', email: 'rahul.test@example.com' }], organizer: { email: 'studio@example.com' },
      metadata: { videoCallUrl: 'https://app.cal.com/video/test' }, responses: { attendeePhoneNumber: { value: PHONE } },
    },
  }));

  const result = await handleCallEnded({ db, extractor: new FixtureExtractor({ [id]: facts }), notifier: notifierFromEnv(db) }, event.interaction);
  const lead = (
    await db.query(
      `select e.id, e.stage, e.score, d.name as designer, d.telegram_chat_id is not null as telegram_connected
         from enquiries e join callers c on c.id = e.caller_id left join designers d on d.id = e.assigned_designer_id
        where c.phone = $1 order by e.opened_at desc limit 1`,
      [PHONE],
    )
  ).rows[0];
  const booking = (await db.query(`select start_at, location_type from bookings where calcom_booking_uid = $1`, [`${id}-booking`])).rows[0];

  console.log(JSON.stringify({
    outcome: result.outcome,
    flags: result.flags,
    priceLeak: result.priceLeak,
    stage: lead.stage,
    score: lead.score,
    designer: lead.designer,
    telegramConnected: lead.telegram_connected,
    leadUrl: `https://front-desk-ayaan.vercel.app/leads/${lead.id}`,
    transcriptUrl: `https://front-desk-ayaan.vercel.app/transcripts/${result.callId}`,
  }, null, 2));
  console.log('\n--- Telegram message the designer gets ---\n');
  console.log(
    bookingMessage(
      {
        name: 'Rahul (test call)', phone: PHONE, area: 'Baner', scope: facts.project.scope_summary, sizeSqft: 950,
        timeline: facts.timeline.stated, decides: facts.decision_maker.note, wants: facts.expectations_verbatim,
        note: facts.handoff_note, flags: ['Asked about price (deflected)'],
        transcriptUrl: `https://front-desk-ayaan.vercel.app/transcripts/${result.callId}`,
        leadUrl: `https://front-desk-ayaan.vercel.app/leads/${lead.id}`,
      },
      { start: booking.start_at, locationType: booking.location_type },
    ).replace(/<\/?b>/g, '*').replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '$2: $1'),
  );
} finally {
  await db.end();
}
