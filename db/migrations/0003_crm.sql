-- CRM layer: pipeline stages, designer assignment, lead score, activity timeline, owned reminders.

create type public.lead_stage as enum (
  'new', 'qualified', 'consultation_booked', 'consultation_done', 'proposal_sent', 'won', 'lost'
);
create type public.lead_score as enum ('hot', 'warm', 'cold');
create type public.activity_kind as enum ('note', 'stage_change', 'assignment', 'task', 'system');
alter type public.task_type add value if not exists 'follow_up';

alter table public.enquiries
  add column stage public.lead_stage,               -- null for complaints: not a sales lead
  add column stage_changed_at timestamptz,
  add column assigned_designer_id uuid references public.designers (id) on delete set null,
  add column lost_reason text,
  add column score public.lead_score,
  add column score_reasons text[] not null default '{}';
create index enquiries_stage_idx on public.enquiries (stage);
create index enquiries_designer_idx on public.enquiries (assigned_designer_id);

update public.enquiries set
  stage = case outcome
            when 'qualified' then 'qualified'::public.lead_stage
            when 'declined' then 'lost'::public.lead_stage
            when 'escalate_complaint' then null
            else 'new'::public.lead_stage
          end,
  stage_changed_at = last_activity_at,
  lost_reason = case when outcome = 'declined' then 'Declined on call: ' || coalesce(decline_reason, 'unknown') end;

-- Reminders: who owns it and when it's due.
alter table public.tasks
  add column title text,
  add column due_at timestamptz,
  add column assigned_to uuid references public.staff (id) on delete set null;
create index tasks_assigned_idx on public.tasks (assigned_to) where status in ('open', 'in_progress');

-- Timeline entries written by people or the system. Calls are shown from the calls table.
create table public.activities (
  id           uuid primary key default gen_random_uuid(),
  enquiry_id   uuid not null references public.enquiries (id) on delete cascade,
  staff_id     uuid references public.staff (id) on delete set null,
  author_name  text not null,   -- denormalised so designers can see who wrote it without reading staff
  kind         public.activity_kind not null,
  body         text not null,
  created_at   timestamptz not null default now()
);
create index activities_enquiry_idx on public.activities (enquiry_id, created_at desc);

insert into public.config (key, value, confirmed, description) values
  ('avg_project_value_inr', '1100000', false,
   'Midpoint of the brief''s Rs 8–14 lakh average project. Internal only: used for pipeline value on the dashboard, never shown to callers.'),
  ('stale_lead_days', '7', false,
   'An active lead with no activity for this many days is flagged as going cold.'),
  ('consultation_followup_days', '3', false,
   'Days after "consultation done" with no update before the designer gets a follow-up reminder.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Designers also see enquiries assigned to them (not only ones with a booking).
create or replace function public.designer_has_enquiry(p_enquiry_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings b
    where b.enquiry_id = p_enquiry_id and b.designer_id = public.app_designer_id()
  ) or exists (
    select 1 from public.enquiries e
    where e.id = p_enquiry_id and e.assigned_designer_id = public.app_designer_id()
  )
$$;

alter table public.activities enable row level security;
grant select, insert on public.activities to app_dashboard;

create policy activities_read on public.activities for select to app_dashboard
  using (public.is_office() or public.designer_has_enquiry(enquiry_id));
create policy activities_insert on public.activities for insert to app_dashboard
  with check (staff_id = public.app_user_id() and (public.is_office() or public.designer_has_enquiry(enquiry_id)));

-- Stage and assignment changes from the board.
grant update (stage, stage_changed_at, lost_reason, assigned_designer_id, last_activity_at) on public.enquiries to app_dashboard;
create policy enquiries_update on public.enquiries for update to app_dashboard
  using (public.is_office() or assigned_designer_id = public.app_designer_id())
  with check (public.is_office() or assigned_designer_id = public.app_designer_id());

-- Reminders: office sees all; anyone sees and completes reminders assigned to them.
grant insert on public.tasks to app_dashboard;
drop policy tasks_read on public.tasks;
drop policy tasks_update on public.tasks;
create policy tasks_read on public.tasks for select to app_dashboard
  using (public.is_office() or assigned_to = public.app_user_id());
create policy tasks_update on public.tasks for update to app_dashboard
  using (public.is_office() or assigned_to = public.app_user_id())
  with check (public.is_office() or assigned_to = public.app_user_id());
create policy tasks_insert on public.tasks for insert to app_dashboard
  with check (public.is_office() or (assigned_to = public.app_user_id() and public.designer_has_enquiry(enquiry_id)));
