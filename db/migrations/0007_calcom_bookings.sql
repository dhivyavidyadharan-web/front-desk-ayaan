-- cal.com bookings made by the agent during the call. The booking webhook can arrive before the
-- call's transcript is processed, so a booking may wait unlinked until the call is matched.
alter table public.bookings alter column enquiry_id drop not null;
alter table public.bookings alter column designer_id drop not null;
alter table public.bookings
  add column attendee_name   text,
  add column attendee_phone  text,
  add column organizer_email text,
  add column location_type   text check (location_type in ('online', 'studio')),
  add column location        text,
  add column linked_at       timestamptz;
create index bookings_unlinked_idx on public.bookings (attendee_email, attendee_phone) where enquiry_id is null;

-- One Telegram message per (handoff kind, recipient) so retries never double-post.
alter table public.handoffs add column kind text not null default 'booking';
alter table public.handoffs alter column call_id drop not null;
create unique index handoffs_once_idx on public.handoffs (coalesce(booking_id, call_id), kind, telegram_chat_id);
