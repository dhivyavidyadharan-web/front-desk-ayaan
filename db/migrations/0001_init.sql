-- Aangan Studio call agent: core schema (Neon Postgres).
-- Webhooks/jobs connect as the table owner (bypasses RLS). Dashboard queries run as
-- app_dashboard with app.user_id set per transaction (see 0002_rls.sql).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.staff_role     as enum ('admin', 'front_desk', 'designer');
create type public.call_direction as enum ('inbound', 'outbound');
create type public.call_status    as enum ('in_progress', 'ended', 'processing', 'processed', 'needs_review', 'failed');
create type public.call_outcome   as enum ('qualified', 'declined', 'unsure', 'escalate_complaint', 'missed');
create type public.enquiry_status as enum ('open', 'closed');
create type public.booking_status as enum ('provisional', 'confirmed', 'needs_review', 'cancelled');
create type public.handoff_recipient as enum ('designer', 'team');
create type public.task_type      as enum ('unsure', 'callback', 'complaint', 'booking_review');
create type public.task_status    as enum ('open', 'in_progress', 'done', 'cancelled');
create type public.alert_type     as enum ('price_leak', 'extraction_failed', 'complaint', 'integration_failed');
create type public.action_kind    as enum ('hubspot_contact', 'hubspot_deal', 'telegram_designer', 'telegram_team', 'calcom_booking', 'outbound_callback');
create type public.action_status  as enum ('pending', 'succeeded', 'failed');

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.designers (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  email                 text,
  telegram_chat_id      text,
  calcom_username       text,
  calcom_event_type_id  integer,
  active                boolean not null default true,
  -- Round-robin: the active designer with the oldest value gets the next lead.
  last_assigned_at      timestamptz,
  created_at            timestamptz not null default now()
);

-- Dashboard users. Callers never get accounts. Sign-in is matched on email.
create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  role          public.staff_role not null,
  designer_id   uuid references public.designers (id) on delete set null,
  display_name  text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint designer_role_needs_designer check (role <> 'designer' or designer_id is not null)
);

create table public.callers (
  id                  uuid primary key default gen_random_uuid(),
  phone               text not null unique check (phone ~ '^\+[1-9][0-9]{6,14}$'), -- E.164
  name                text,
  -- false when the stored name came from someone else on a shared number
  name_confirmed      boolean not null default false,
  email               text,
  referral_source     text,
  hubspot_contact_id  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger callers_touch before update on public.callers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Enquiries and calls
-- ---------------------------------------------------------------------------
-- One enquiry can span several calls (dropped call + callback within the dedupe window, T17).
create table public.enquiries (
  id                uuid primary key default gen_random_uuid(),
  caller_id         uuid not null references public.callers (id) on delete cascade,
  channel           text not null default 'voice',
  status            public.enquiry_status not null default 'open',
  outcome           public.call_outcome,
  decline_reason    text,
  opened_at         timestamptz not null default now(),
  last_activity_at  timestamptz not null default now()
);
create index enquiries_caller_activity_idx on public.enquiries (caller_id, last_activity_at desc);

create table public.calls (
  id                uuid primary key default gen_random_uuid(),
  enquiry_id        uuid references public.enquiries (id) on delete set null,
  caller_id         uuid references public.callers (id) on delete set null,
  channel           text not null default 'voice',
  provider          text not null,          -- 'mock' | 'vani'
  provider_call_id  text not null,
  direction         public.call_direction not null default 'inbound',
  from_number       text,
  started_at        timestamptz not null,
  answered_at       timestamptz,
  ended_at          timestamptz,
  duration_seconds  integer,
  outside_hours     boolean,
  status            public.call_status not null default 'in_progress',
  outcome           public.call_outcome,
  decline_reason    text,                   -- e.g. 'service_area', 'real_project'
  flags             text[] not null default '{}',  -- e.g. 'timeline_6_10_weeks', 'unconfirmed_rule:min_commercial_sqft'
  open_question     text,                   -- the one clarifying question for 'unsure'
  transcript        jsonb,                  -- [{ "speaker": "agent"|"caller", "text": "...", "at": "..." }]
  recording_url     text,
  language          text,                   -- en | hi | mr | mixed
  price_leak_flag   boolean not null default false,
  prompt_version    text,
  redacted_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (provider, provider_call_id)
);
create index calls_started_idx on public.calls (started_at desc);
create index calls_enquiry_idx on public.calls (enquiry_id);
create index calls_outcome_idx on public.calls (outcome);

-- Every LLM attempt is kept, including invalid ones.
create table public.extractions (
  id              uuid primary key default gen_random_uuid(),
  call_id         uuid not null references public.calls (id) on delete cascade,
  attempt         smallint not null,
  model           text not null,
  prompt_version  text not null,
  raw_output      text,
  parsed          jsonb,
  valid           boolean not null,
  error           text,
  input_tokens    integer,
  output_tokens   integer,
  created_at      timestamptz not null default now(),
  unique (call_id, attempt)
);

-- ---------------------------------------------------------------------------
-- Bookings and handoffs
-- ---------------------------------------------------------------------------
create table public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  enquiry_id          uuid not null references public.enquiries (id) on delete cascade,
  call_id             uuid references public.calls (id) on delete set null,
  designer_id         uuid not null references public.designers (id),
  calcom_booking_uid  text unique,
  start_at            timestamptz not null,
  end_at              timestamptz,
  meeting_url         text,                 -- consultations are online
  attendee_email      text,
  status              public.booking_status not null default 'provisional',
  created_at          timestamptz not null default now()
);
create index bookings_designer_idx on public.bookings (designer_id);
create index bookings_enquiry_idx on public.bookings (enquiry_id);

-- Telegram messages: every call goes to the team group; qualified leads also go to the designer.
create table public.handoffs (
  id                   uuid primary key default gen_random_uuid(),
  call_id              uuid not null references public.calls (id) on delete cascade,
  booking_id           uuid references public.bookings (id) on delete set null,
  recipient            public.handoff_recipient not null,
  designer_id          uuid references public.designers (id),
  telegram_chat_id     text not null,
  telegram_message_id  text,
  sent_at              timestamptz,
  acknowledged_at      timestamptz,        -- tracked for metrics only; no escalation
  created_at           timestamptz not null default now(),
  constraint designer_handoff_has_designer check (recipient <> 'designer' or designer_id is not null)
);
create index handoffs_designer_idx on public.handoffs (designer_id);

-- ---------------------------------------------------------------------------
-- Queues, side-effects, costs, alerts
-- ---------------------------------------------------------------------------
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  type             public.task_type not null,
  status           public.task_status not null default 'open',
  call_id          uuid references public.calls (id) on delete cascade,
  enquiry_id       uuid references public.enquiries (id) on delete cascade,
  question         text,                  -- open question for 'unsure'
  attempts         integer not null default 0,   -- outbound callback attempts by the bot
  next_attempt_at  timestamptz,
  notes            text,
  resolved_by      uuid references public.staff (id),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index tasks_open_idx on public.tasks (type, status) where status in ('open', 'in_progress');
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- One row per external side-effect per call, so retries are idempotent.
create table public.actions (
  id           uuid primary key default gen_random_uuid(),
  call_id      uuid not null references public.calls (id) on delete cascade,
  kind         public.action_kind not null,
  status       public.action_status not null default 'pending',
  attempts     integer not null default 0,
  external_id  text,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (call_id, kind)
);
create trigger actions_touch before update on public.actions
  for each row execute function public.touch_updated_at();

create table public.costs (
  call_id            uuid primary key references public.calls (id) on delete cascade,
  voice_minutes      numeric(8, 2) not null default 0,
  voice_cost_inr     numeric(10, 2) not null default 0,
  llm_input_tokens   integer not null default 0,
  llm_output_tokens  integer not null default 0,
  llm_cost_inr       numeric(10, 4) not null default 0,
  total_cost_inr     numeric(10, 2) generated always as (voice_cost_inr + llm_cost_inr) stored,
  created_at         timestamptz not null default now()
);

create table public.alerts (
  id           uuid primary key default gen_random_uuid(),
  type         public.alert_type not null,
  call_id      uuid references public.calls (id) on delete cascade,
  details      jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.staff (id)
);
create index alerts_open_idx on public.alerts (type) where resolved_at is null;

-- Business rules editable from the Settings page. `confirmed = false` shows an "unconfirmed" badge.
create table public.config (
  key          text primary key,
  value        jsonb not null,
  confirmed    boolean not null default false,
  description  text not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.staff (id)
);
create trigger config_touch before update on public.config
  for each row execute function public.touch_updated_at();
