begin;
-- Append-only receipts: undo is another row, never a deletion or replacement.
create table public.workout_commands (
  id uuid primary key, user_id uuid not null, session_id uuid not null,
  version integer not null check(version=1), request_hash text not null check(length(request_hash)=64),
  parent_id uuid unique, receipt jsonb not null, created_at timestamptz not null default now(),
  unique(id,user_id), check(parent_id is null or parent_id<>id),
  foreign key(session_id,user_id) references public.workout_sessions(id,user_id) on delete cascade,
  foreign key(parent_id,user_id) references public.workout_commands(id,user_id) on delete cascade
);
create index workout_commands_owner_time on public.workout_commands(user_id,created_at desc,id);
create index workout_commands_session on public.workout_commands(session_id,user_id);
alter table public.workout_commands enable row level security;
alter table public.workout_commands force row level security;
revoke all on public.workout_commands from public,anon,authenticated;
grant select on public.workout_commands to authenticated;
grant select,insert on public.workout_commands to liftcut_workout;
create policy workout_commands_read on public.workout_commands for select to authenticated,liftcut_workout
  using((select auth.uid())=user_id);
create policy workout_commands_insert on public.workout_commands for insert to liftcut_workout
  with check((select auth.uid())=user_id);
commit;
