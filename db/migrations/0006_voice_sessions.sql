-- Browser (WebRTC) calls carry no caller ID, so we record who started each session before it
-- connects. The transcript webhook is matched back to the caller through this table.
create table public.voice_sessions (
  provider          text not null,
  provider_call_id  text not null,
  phone             text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  name              text,
  language          text,
  consent_at        timestamptz not null,   -- caller ticked "this call is recorded and transcribed"
  agent_prompt_version text,                -- which prompts/voice_agent.md the agent ran with
  created_at        timestamptz not null default now(),
  primary key (provider, provider_call_id)
);
create index voice_sessions_phone_idx on public.voice_sessions (phone, created_at desc);
create index voice_sessions_created_idx on public.voice_sessions (created_at desc);

-- Server-only: no dashboard policies.
alter table public.voice_sessions enable row level security;
