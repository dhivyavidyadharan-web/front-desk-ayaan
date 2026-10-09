-- Row-level security (Neon / plain Postgres).
--
-- How it works:
--   * Webhooks and jobs connect as the table owner, which bypasses RLS.
--   * Dashboard queries run inside a transaction that does
--       set local role app_dashboard;
--       select set_config('app.user_id', '<staff.id>', true);
--     so every policy below applies, enforced by the database.
--
--   admin, front_desk : read everything; both work the queues; only admin edits config.
--   designer          : only enquiries they have a booking on (all calls in that enquiry),
--                       plus their own bookings and handoffs.

-- ---------------------------------------------------------------------------
-- Dashboard role
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_dashboard') then
    create role app_dashboard nologin;
  end if;
end $$;

-- Let the connecting (owner) role switch into app_dashboard with SET ROLE.
grant app_dashboard to current_user;

grant usage on schema public to app_dashboard;
grant select on all tables in schema public to app_dashboard;
grant update on public.tasks, public.alerts, public.config to app_dashboard;
grant update (acknowledged_at) on public.handoffs to app_dashboard;
grant usage on all types in schema public to app_dashboard;

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies don't recurse through staff RLS)
-- ---------------------------------------------------------------------------
create or replace function public.app_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function public.app_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s where s.id = public.app_user_id() and s.active
$$;

create or replace function public.app_designer_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.designer_id from public.staff s
  where s.id = public.app_user_id() and s.active and s.role = 'designer'
$$;

create or replace function public.is_office() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.app_role() in ('admin', 'front_desk'), false)
$$;

create or replace function public.designer_has_enquiry(p_enquiry_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings b
    where b.enquiry_id = p_enquiry_id
      and b.designer_id = public.app_designer_id()
  )
$$;

revoke all on function public.app_user_id(), public.app_role(), public.app_designer_id(),
  public.is_office(), public.designer_has_enquiry(uuid) from public;
grant execute on function public.app_user_id(), public.app_role(), public.app_designer_id(),
  public.is_office(), public.designer_has_enquiry(uuid) to app_dashboard;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.designers   enable row level security;
alter table public.staff       enable row level security;
alter table public.callers     enable row level security;
alter table public.enquiries   enable row level security;
alter table public.calls       enable row level security;
alter table public.extractions enable row level security;
alter table public.bookings    enable row level security;
alter table public.handoffs    enable row level security;
alter table public.tasks       enable row level security;
alter table public.actions     enable row level security;
alter table public.costs       enable row level security;
alter table public.alerts      enable row level security;
alter table public.config      enable row level security;

-- ---------------------------------------------------------------------------
-- Read policies
-- ---------------------------------------------------------------------------
create policy designers_read on public.designers for select to app_dashboard
  using (public.is_office() or id = public.app_designer_id());

create policy staff_read on public.staff for select to app_dashboard
  using (public.is_office() or id = public.app_user_id());

create policy callers_read on public.callers for select to app_dashboard
  using (
    public.is_office()
    or exists (
      select 1 from public.enquiries e
      where e.caller_id = callers.id and public.designer_has_enquiry(e.id)
    )
  );

create policy enquiries_read on public.enquiries for select to app_dashboard
  using (public.is_office() or public.designer_has_enquiry(id));

create policy calls_read on public.calls for select to app_dashboard
  using (public.is_office() or public.designer_has_enquiry(enquiry_id));

create policy extractions_read on public.extractions for select to app_dashboard
  using (
    public.is_office()
    or exists (
      select 1 from public.calls c
      where c.id = extractions.call_id and public.designer_has_enquiry(c.enquiry_id)
    )
  );

create policy bookings_read on public.bookings for select to app_dashboard
  using (public.is_office() or designer_id = public.app_designer_id());

create policy handoffs_read on public.handoffs for select to app_dashboard
  using (public.is_office() or designer_id = public.app_designer_id());

create policy tasks_read   on public.tasks   for select to app_dashboard using (public.is_office());
create policy actions_read on public.actions for select to app_dashboard using (public.is_office());
create policy costs_read   on public.costs   for select to app_dashboard using (public.is_office());
create policy alerts_read  on public.alerts  for select to app_dashboard using (public.is_office());
create policy config_read  on public.config  for select to app_dashboard using (public.is_office());

-- ---------------------------------------------------------------------------
-- Write policies (everything else is owner-only: webhooks and jobs)
-- ---------------------------------------------------------------------------
create policy tasks_update on public.tasks for update to app_dashboard
  using (public.is_office()) with check (public.is_office());

create policy alerts_update on public.alerts for update to app_dashboard
  using (public.is_office()) with check (public.is_office());

create policy config_update on public.config for update to app_dashboard
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- A designer can acknowledge their own handoff from the dashboard too.
create policy handoffs_ack on public.handoffs for update to app_dashboard
  using (public.is_office() or designer_id = public.app_designer_id())
  with check (public.is_office() or designer_id = public.app_designer_id());
