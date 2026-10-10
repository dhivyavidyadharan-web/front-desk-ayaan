-- The team group's Telegram chat, set when someone sends "/team <code>" in the group.
insert into public.config (key, value, confirmed, description) values
  ('telegram_team_chat_id', 'null', true,
   'Telegram group that gets every call summary and booking. Set by sending the /team code from Settings in the group.')
on conflict (key) do nothing;
