// cal.com bookings → leads. The agent books during the call, so the booking webhook often
// arrives before the call's transcript is processed. Unmatched bookings wait (enquiry_id null)
// and are linked when the call lands, matched on the caller's phone or email.
import { STAGE_LABELS, type LeadStage } from '../core/crm';
import { withTransaction, type Db } from '../db/client';
import type { CalEvent } from '../integrations/calcom';
import { fmtDateTime as fmtSlot } from '../crm/labels';

export interface CalEventResult {
  bookingId: string | null;
  linked: boolean;
  cancelled: boolean;
}

export async function recordCalEvent(db: Db, ev: CalEvent): Promise<CalEventResult> {
  if (ev.kind === 'ignored') return { bookingId: null, linked: false, cancelled: false };
  const b = ev.booking;

  if (ev.kind === 'cancelled') {
    const r = await db.query<{ id: string }>(
      `update public.bookings set status = 'cancelled' where calcom_booking_uid = $1 returning id`,
      [b.uid],
    );
    const id = r.rows[0]?.id ?? null;
    if (id) await onCancelled(db, id);
    return { bookingId: id, linked: false, cancelled: Boolean(id) };
  }

  const r = await db.query<{ id: string; enquiry_id: string | null }>(
    `insert into public.bookings (calcom_booking_uid, start_at, end_at, meeting_url, attendee_email, attendee_name,
       attendee_phone, organizer_email, location_type, location, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed')
     on conflict (calcom_booking_uid) do update set start_at = excluded.start_at, end_at = excluded.end_at,
       meeting_url = excluded.meeting_url, location_type = excluded.location_type, location = excluded.location,
       status = 'confirmed'
     returning id, enquiry_id`,
    [b.uid, b.startTime, b.endTime, b.meetingUrl, b.attendee.email, b.attendee.name, b.attendee.phone, b.organizerEmail, b.locationType, b.location],
  );
  const row = r.rows[0]!;
  const linked = row.enquiry_id ? false : await linkBooking(db, row.id);
  return { bookingId: row.id, linked, cancelled: false };
}

/** Links one waiting booking to its caller's latest lead. Returns true if it was linked now. */
export async function linkBooking(db: Db, bookingId: string): Promise<boolean> {
  return withTransaction(db, async (tx) => {
    const b = (
      await tx.query<{ attendee_phone: string | null; attendee_email: string | null; organizer_email: string | null; start_at: Date; location_type: string | null }>(
        `select attendee_phone, attendee_email, organizer_email, start_at, location_type from public.bookings
          where id = $1 and enquiry_id is null for update`,
        [bookingId],
      )
    ).rows[0];
    if (!b) return false;

    const enquiry = (
      await tx.query<{ id: string; stage: LeadStage | null; assigned_designer_id: string | null }>(
        `select e.id, e.stage, e.assigned_designer_id from public.enquiries e join public.callers c on c.id = e.caller_id
          where e.stage is not null
            and (($1::text is not null and c.phone = $1) or ($2::text is not null and lower(c.email) = lower($2)))
          order by e.last_activity_at desc limit 1 for update of e`,
        [b.attendee_phone, b.attendee_email],
      )
    ).rows[0];
    if (!enquiry) return false;

    const designer = b.organizer_email
      ? (await tx.query<{ id: string; name: string }>(`select id, name from public.designers where lower(email) = $1`, [b.organizer_email])).rows[0]
      : undefined;
    const designerId = designer?.id ?? enquiry.assigned_designer_id;

    await tx.query(`update public.bookings set enquiry_id = $2, designer_id = $3, linked_at = now() where id = $1`, [bookingId, enquiry.id, designerId]);
    const advance = enquiry.stage === 'new' || enquiry.stage === 'qualified' || enquiry.stage === 'lost';
    await tx.query(
      `update public.enquiries set
         stage = case when $2 then 'consultation_booked'::public.lead_stage else stage end,
         stage_changed_at = case when $2 then now() else stage_changed_at end,
         assigned_designer_id = coalesce($3, assigned_designer_id),
         last_activity_at = now()
       where id = $1`,
      [enquiry.id, advance, designer?.id ?? null],
    );
    const where = b.location_type === 'online' ? 'online' : b.location_type === 'studio' ? 'at the studio' : '';
    const designerName = designer?.name ?? (designerId ? (await tx.query<{ name: string }>('select name from public.designers where id = $1', [designerId])).rows[0]?.name : null);
    await tx.query(
      `insert into public.activities (enquiry_id, author_name, kind, body) values ($1, 'System', 'system', $2)`,
      [enquiry.id, `Consultation booked for ${fmtSlot(b.start_at)}${where ? ` (${where})` : ''}${designerName ? ` with ${designerName}` : ''}.`],
    );
    if (advance && enquiry.stage) {
      await tx.query(`insert into public.activities (enquiry_id, author_name, kind, body) values ($1, 'System', 'stage_change', $2)`, [
        enquiry.id,
        `Stage: ${STAGE_LABELS[enquiry.stage]} → ${STAGE_LABELS.consultation_booked}.`,
      ]);
    }
    return true;
  });
}

/** After a call is stored: link any booking the agent made during it. */
export async function linkPendingForCaller(db: Db, callerId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select b.id from public.bookings b, public.callers c
      where c.id = $1 and b.enquiry_id is null and b.status = 'confirmed'
        and (b.attendee_phone = c.phone or (b.attendee_email is not null and lower(b.attendee_email) = lower(c.email)))
        and b.created_at > now() - interval '3 days'`,
    [callerId],
  );
  const linked: string[] = [];
  for (const r of rows) if (await linkBooking(db, r.id)) linked.push(r.id);
  return linked;
}

async function onCancelled(db: Db, bookingId: string) {
  await withTransaction(db, async (tx) => {
    const b = (await tx.query<{ enquiry_id: string | null; start_at: Date }>(`select enquiry_id, start_at from public.bookings where id = $1`, [bookingId])).rows[0];
    if (!b?.enquiry_id) return;
    const others = await tx.query(
      `select 1 from public.bookings where enquiry_id = $1 and status = 'confirmed' and start_at > now()`,
      [b.enquiry_id],
    );
    await tx.query(`insert into public.activities (enquiry_id, author_name, kind, body) values ($1, 'System', 'system', $2)`, [
      b.enquiry_id,
      `Consultation for ${fmtSlot(b.start_at)} was cancelled.`,
    ]);
    if (others.rowCount === 0) {
      const moved = await tx.query(
        `update public.enquiries set stage = 'qualified', stage_changed_at = now(), last_activity_at = now()
          where id = $1 and stage = 'consultation_booked' returning id`,
        [b.enquiry_id],
      );
      if (moved.rowCount) {
        await tx.query(`insert into public.activities (enquiry_id, author_name, kind, body) values ($1, 'System', 'stage_change', $2)`, [
          b.enquiry_id,
          `Stage: ${STAGE_LABELS.consultation_booked} → ${STAGE_LABELS.qualified}.`,
        ]);
      }
    }
  });
}
