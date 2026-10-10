-- Timeline entries written in the same transaction share a timestamp; keep their true order.
alter table public.activities add column seq bigint generated always as identity;
create index activities_enquiry_seq_idx on public.activities (enquiry_id, created_at desc, seq desc);
