begin;
-- New body/food measurements are nullable and separate from legacy inferred zeros.
-- Immutable create receipts + append-only compensation; no runtime UPDATE/DELETE.
create table public.personal_record_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid unique,
  request_hash text not null check(length(request_hash)=64),
  request jsonb not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  unique(id,user_id),
  check(parent_id is null or parent_id<>id),
  check(request->>'action' = case when parent_id is null then 'create' else 'undo' end),
  foreign key(parent_id,user_id) references public.personal_record_events(id,user_id) on delete cascade
);
create index personal_record_events_owner_time on public.personal_record_events(user_id,created_at desc,id);
alter table public.personal_record_events enable row level security;
alter table public.personal_record_events force row level security;
revoke all on public.personal_record_events from public,anon,authenticated;
grant select on public.personal_record_events to authenticated;
grant select,insert on public.personal_record_events to liftcut_workout;
create policy personal_record_events_read on public.personal_record_events for select to authenticated,liftcut_workout
  using((select auth.uid())=user_id);
create policy personal_record_events_insert on public.personal_record_events for insert to liftcut_workout
  with check((select auth.uid())=user_id);
commit;
