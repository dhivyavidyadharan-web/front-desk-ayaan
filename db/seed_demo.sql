-- FICTIONAL roster for the Mesa School of Business submission. Names are made up;
-- emails use the reserved .example domain so nothing can reach a real inbox.
-- "Aryan Patil" matches the designer named in the September complaint transcript (T09).
-- Safe to re-run.
insert into public.designers (id, name, email, active) values
  ('00000000-0000-0000-0000-0000000000d1', 'Aryan Patil',     'aryan@aangan.example',  true),
  ('00000000-0000-0000-0000-0000000000d2', 'Ananya Kulkarni', 'ananya@aangan.example', true),
  ('00000000-0000-0000-0000-0000000000d3', 'Rohan Joshi',     'rohan@aangan.example',  true),
  ('00000000-0000-0000-0000-0000000000d4', 'Meera Iyer',      'meera@aangan.example',  true),
  ('00000000-0000-0000-0000-0000000000d5', 'Kabir Shah',      'kabir@aangan.example',  true)
on conflict (id) do update set name = excluded.name, email = excluded.email, active = true;

insert into public.staff (id, email, role, designer_id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'nikhil@aangan.example',   'admin',      null, 'Nikhil Deshpande'),
  ('00000000-0000-0000-0000-0000000000a2', 'priyanka@aangan.example', 'front_desk', null, 'Priyanka Rao'),
  ('00000000-0000-0000-0000-0000000000a3', 'aryan@aangan.example',    'designer', '00000000-0000-0000-0000-0000000000d1', 'Aryan Patil'),
  ('00000000-0000-0000-0000-0000000000a4', 'ananya@aangan.example',   'designer', '00000000-0000-0000-0000-0000000000d2', 'Ananya Kulkarni'),
  ('00000000-0000-0000-0000-0000000000a5', 'rohan@aangan.example',    'designer', '00000000-0000-0000-0000-0000000000d3', 'Rohan Joshi'),
  ('00000000-0000-0000-0000-0000000000a6', 'meera@aangan.example',    'designer', '00000000-0000-0000-0000-0000000000d4', 'Meera Iyer'),
  ('00000000-0000-0000-0000-0000000000a7', 'kabir@aangan.example',    'designer', '00000000-0000-0000-0000-0000000000d5', 'Kabir Shah')
on conflict (id) do update set email = excluded.email, role = excluded.role, designer_id = excluded.designer_id,
  display_name = excluded.display_name, active = true;
