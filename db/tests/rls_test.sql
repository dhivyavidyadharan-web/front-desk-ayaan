-- RLS tests. Plain SQL, no extensions. Run against a throwaway Neon branch:
--   psql "$DATABASE_URL_TEST" -v ON_ERROR_STOP=1 -f db/tests/rls_test.sql
-- Any failed check raises an exception; everything rolls back.
begin;

create function pg_temp.check_eq(actual anyelement, expected anyelement, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok: %', label;
end $$;

create function pg_temp.expect_denied(stmt text, label text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (statement was allowed)', label;
exception when insufficient_privilege then
  raise notice 'ok: %', label;
end $$;

create function pg_temp.login(p_staff uuid) returns void language sql as $$
  select set_config('app.user_id', coalesce(p_staff::text, ''), true);
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (as owner, bypassing RLS)
-- ---------------------------------------------------------------------------
insert into public.designers (id, name) values
  ('20000000-0000-0000-0000-00000000000a', 'Designer A'),
  ('20000000-0000-0000-0000-00000000000b', 'Designer B');

insert into public.staff (id, email, role, designer_id) values
  ('10000000-0000-0000-0000-000000000001', 'rls-admin@example.test', 'admin', null),
  ('10000000-0000-0000-0000-000000000002', 'rls-desk@example.test', 'front_desk', null),
  ('10000000-0000-0000-0000-000000000003', 'rls-designer-a@example.test', 'designer', '20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-000000000004', 'rls-designer-b@example.test', 'designer', '20000000-0000-0000-0000-00000000000b');

insert into public.callers (id, phone, name) values
  ('30000000-0000-0000-0000-000000000001', '+919800000001', 'Caller One'),
  ('30000000-0000-0000-0000-000000000002', '+919800000002', 'Caller Two');

insert into public.enquiries (id, caller_id) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002');

-- Enquiry 1 has two calls (dropped + callback); enquiry 2 has one.
insert into public.calls (id, enquiry_id, caller_id, provider, provider_call_id, started_at) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'mock', 'c1', now()),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'mock', 'c2', now()),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'mock', 'c3', now());

-- Designer A has the booking on enquiry 1 only.
insert into public.bookings (enquiry_id, call_id, designer_id, start_at) values
  ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', now() + interval '2 days');

insert into public.costs (call_id, voice_minutes) values ('50000000-0000-0000-0000-000000000001', 1);
insert into public.config (key, value, description) values ('test_key', '1', 'test');

-- ---------------------------------------------------------------------------
-- Designer A
-- ---------------------------------------------------------------------------
select pg_temp.login('10000000-0000-0000-0000-000000000003');
set local role app_dashboard;
select pg_temp.check_eq((select count(*)::int from public.calls where provider_call_id in ('c1','c2','c3')), 2, 'designer sees both calls of their enquiry');
select pg_temp.check_eq((select count(*)::int from public.calls where enquiry_id = '40000000-0000-0000-0000-000000000002'), 0, 'designer cannot see another enquiry');
select pg_temp.check_eq((select count(*)::int from public.callers), 1, 'designer sees only their caller');
select pg_temp.check_eq((select count(*)::int from public.costs), 0, 'designer sees no costs');
select pg_temp.check_eq((select count(*)::int from public.config), 0, 'designer sees no config');
select pg_temp.check_eq((select count(*)::int from public.designers), 1, 'designer sees only own designer row');
update public.config set value = '99';
reset role;
select pg_temp.check_eq((select value from public.config where key = 'test_key'), '1'::jsonb, 'designer cannot update config');

-- ---------------------------------------------------------------------------
-- Designer B (no bookings)
-- ---------------------------------------------------------------------------
select pg_temp.login('10000000-0000-0000-0000-000000000004');
set local role app_dashboard;
select pg_temp.check_eq((select count(*)::int from public.calls), 0, 'designer without bookings sees no calls');
reset role;

-- ---------------------------------------------------------------------------
-- No user set (e.g. a bug forgets to set app.user_id)
-- ---------------------------------------------------------------------------
select pg_temp.login(null);
set local role app_dashboard;
select pg_temp.check_eq((select count(*)::int from public.calls), 0, 'no user sees no calls');
reset role;

-- ---------------------------------------------------------------------------
-- Front desk
-- ---------------------------------------------------------------------------
select pg_temp.login('10000000-0000-0000-0000-000000000002');
set local role app_dashboard;
select pg_temp.check_eq((select count(*)::int from public.calls where provider_call_id in ('c1','c2','c3')), 3, 'front desk sees all calls');
select pg_temp.check_eq((select count(*)::int from public.costs where call_id = '50000000-0000-0000-0000-000000000001'), 1, 'front desk sees costs');
update public.config set value = '42' where key = 'test_key';
reset role;
select pg_temp.check_eq((select value from public.config where key = 'test_key'), '1'::jsonb, 'front desk cannot update config');

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
select pg_temp.login('10000000-0000-0000-0000-000000000001');
set local role app_dashboard;
select pg_temp.check_eq((select count(*)::int from public.calls where provider_call_id in ('c1','c2','c3')), 3, 'admin sees all calls');
update public.config set value = '7' where key = 'test_key';
reset role;
select pg_temp.check_eq((select value from public.config where key = 'test_key'), '7'::jsonb, 'admin can update config');

-- ---------------------------------------------------------------------------
-- CRM tables (0003): notes, stage changes, reminders
-- ---------------------------------------------------------------------------
update public.enquiries set assigned_designer_id = '20000000-0000-0000-0000-00000000000a', stage = 'qualified'
  where id = '40000000-0000-0000-0000-000000000001';
update public.enquiries set stage = 'new' where id = '40000000-0000-0000-0000-000000000002';
insert into public.tasks (id, type, enquiry_id, title, assigned_to) values
  ('60000000-0000-0000-0000-000000000001', 'follow_up', '40000000-0000-0000-0000-000000000001', 'desk task', '10000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000002', 'follow_up', '40000000-0000-0000-0000-000000000001', 'designer task', '10000000-0000-0000-0000-000000000003');

select pg_temp.login('10000000-0000-0000-0000-000000000003');
set local role app_dashboard;
insert into public.activities (enquiry_id, staff_id, author_name, kind, body)
  values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'Designer A', 'note', 'Visited site');
select pg_temp.check_eq((select count(*)::int from public.activities where body = 'Visited site'), 1, 'designer can add a note to their lead');
select pg_temp.expect_denied(
  $q$insert into public.activities (enquiry_id, staff_id, author_name, kind, body)
     values ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'Designer A', 'note', 'x')$q$,
  'designer cannot add a note to someone else''s lead');
select pg_temp.expect_denied(
  $q$insert into public.activities (enquiry_id, staff_id, author_name, kind, body)
     values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Front desk', 'note', 'x')$q$,
  'designer cannot write a note as someone else');
update public.enquiries set stage = 'consultation_done' where id = '40000000-0000-0000-0000-000000000001';
update public.enquiries set stage = 'won' where id = '40000000-0000-0000-0000-000000000002';
select pg_temp.check_eq((select count(*)::int from public.tasks), 1, 'designer sees only reminders assigned to them');
select pg_temp.expect_denied($q$update public.calls set flags = '{x}'$q$, 'designer cannot edit calls');
reset role;
select pg_temp.check_eq((select stage::text from public.enquiries where id = '40000000-0000-0000-0000-000000000001'), 'consultation_done', 'designer can move their own lead');
select pg_temp.check_eq((select stage::text from public.enquiries where id = '40000000-0000-0000-0000-000000000002'), 'new', 'designer cannot move someone else''s lead');

select pg_temp.login('10000000-0000-0000-0000-000000000002');
set local role app_dashboard;
select pg_temp.check_eq((select count(*)::int from public.tasks where id in ('60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002')), 2, 'front desk sees all reminders');
update public.enquiries set stage = 'proposal_sent' where id = '40000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.check_eq((select stage::text from public.enquiries where id = '40000000-0000-0000-0000-000000000002'), 'proposal_sent', 'front desk can move any lead');

rollback;
