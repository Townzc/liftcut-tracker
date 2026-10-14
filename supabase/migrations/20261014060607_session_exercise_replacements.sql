begin;
-- Append-only: compensation is a new receipt; no UPDATE/DELETE grant at runtime.
create table public.workout_exercise_changes (
  id uuid primary key, user_id uuid not null, session_id uuid not null,
  version integer not null check(version=1), request_hash text not null check(length(request_hash)=64),
  parent_id uuid unique, new_exercise_id uuid not null, receipt jsonb not null,
  created_at timestamptz not null default now(),
  unique(id,user_id,session_id), unique(session_id,new_exercise_id), check(parent_id is null or parent_id<>id),
  foreign key(session_id,user_id) references public.workout_sessions(id,user_id) on delete cascade,
  foreign key(parent_id,user_id,session_id) references public.workout_exercise_changes(id,user_id,session_id) on delete cascade
);
create index workout_exercise_changes_owner_session on public.workout_exercise_changes(user_id,session_id,created_at,id);
alter table public.workout_exercise_changes enable row level security;
alter table public.workout_exercise_changes force row level security;
revoke all on public.workout_exercise_changes from public,anon,authenticated;
grant select on public.workout_exercise_changes to authenticated;
grant select,insert on public.workout_exercise_changes to liftcut_workout;
create policy workout_exercise_changes_read on public.workout_exercise_changes for select to authenticated,liftcut_workout
  using((select auth.uid())=user_id);
create policy workout_exercise_changes_insert on public.workout_exercise_changes for insert to liftcut_workout
  with check((select auth.uid())=user_id);
commit;
