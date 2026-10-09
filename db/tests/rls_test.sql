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
  ('10000000-0000-0000-0000-000000000001', 'admin@example.test', 'admin', null),
  ('10000000-0000-0000-0000-000000000002', 'desk@example.test', 'front_desk', null),
  ('10000000-0000-0000-0000-000000000003', 'designer.a@example.test', 'designer', '20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-000000000004', 'designer.b@example.test', 'designer', '20000000-0000-0000-0000-00000000000b');

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
select pg_temp.check_eq((select count(*)::int from public.calls), 2, 'designer sees both calls of their enquiry');
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
select pg_temp.check_eq((select count(*)::int from public.calls), 3, 'front desk sees all calls');
select pg_temp.check_eq((select count(*)::int from public.costs), 1, 'front desk sees costs');
update public.config set value = '42' where key = 'test_key';
reset role;
select pg_temp.check_eq((select value from public.config where key = 'test_key'), '1'::jsonb, 'front desk cannot update config');

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
select pg_temp.login('10000000-0000-0000-0000-000000000001');
set local role app_dashboard;
select pg_temp.check_eq((select count(*)::int from public.calls), 3, 'admin sees all calls');
update public.config set value = '7' where key = 'test_key';
reset role;
select pg_temp.check_eq((select value from public.config where key = 'test_key'), '7'::jsonb, 'admin can update config');

rollback;
