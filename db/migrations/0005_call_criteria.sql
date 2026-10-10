-- Final per-criterion results from decideOutcome (after code checks), for the call detail view.
alter table public.calls add column criteria jsonb;
