-- Fake staff for local dashboard testing on the Neon TEST branch only.
-- Real staff (Google sign-in emails) are added on the main database.
insert into public.staff (id, email, role, designer_id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'nikhil@example.test', 'admin', null, 'Nikhil (admin)'),
  ('00000000-0000-0000-0000-0000000000a2', 'desk@example.test', 'front_desk', null, 'Front desk'),
  ('00000000-0000-0000-0000-0000000000a3', 'designer.a@example.test', 'designer', '00000000-0000-0000-0000-0000000000d1', 'Test Designer A'),
  ('00000000-0000-0000-0000-0000000000a4', 'designer.b@example.test', 'designer', '00000000-0000-0000-0000-0000000000d2', 'Test Designer B'),
  ('00000000-0000-0000-0000-0000000000a5', 'designer.c@example.test', 'designer', '00000000-0000-0000-0000-0000000000d3', 'Test Designer C')
on conflict (id) do nothing;
