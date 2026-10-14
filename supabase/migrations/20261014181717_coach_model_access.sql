begin;
-- No health/chat payload in usage accounting. Per-owner limits work across instances.
create table public.coach_request_usage (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index coach_request_usage_owner_time on public.coach_request_usage(user_id,created_at desc);
alter table public.coach_request_usage enable row level security;
alter table public.coach_request_usage force row level security;
revoke all on public.coach_request_usage from public,anon,authenticated;
grant select,insert on public.coach_request_usage to liftcut_workout;
create policy coach_usage_read on public.coach_request_usage for select to liftcut_workout using((select auth.uid())=user_id);
create policy coach_usage_insert on public.coach_request_usage for insert to liftcut_workout with check((select auth.uid())=user_id);
-- Existing owner RLS continues to apply. The runtime only gains reads.
grant select on public.food_logs,public.body_metric_logs,public.user_settings to liftcut_workout;
commit;
