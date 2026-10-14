begin;
-- Separate restricted login; credentials are provisioned outside migrations.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='liftcut_workout') then
    create role liftcut_workout nologin nosuperuser nobypassrls;
  end if;
end $$;
grant usage on schema public,auth to liftcut_workout;
grant execute on function auth.uid() to liftcut_workout;
grant select on public.training_plans,public.training_plan_weeks,public.training_plan_days,
  public.training_plan_exercises,public.workout_logs,public.workout_log_exercises to liftcut_workout;

create table public.workout_sessions (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null, timezone text not null, training_plan_id text not null,
  week_number integer not null, day_number integer not null,
  status text not null default 'active' check(status in ('active','ended','cancelled')),
  prescription jsonb not null, started_at timestamptz not null, ended_at timestamptz,
  revision integer not null default 1 check(revision>0), request_hash text not null,
  unique(id,user_id), check((status='active')=(ended_at is null)), check(ended_at>=started_at)
);
create unique index workout_sessions_one_active on public.workout_sessions(user_id) where status='active';
create index workout_sessions_history on public.workout_sessions(user_id,started_at desc);
create table public.set_logs (
  id uuid primary key, session_id uuid not null, user_id uuid not null,
  plan_exercise_id text not null, exercise_name text not null, set_index integer not null check(set_index between 1 and 100),
  weight_kg numeric check(weight_kg between 0 and 1000), reps integer check(reps between 0 and 100), rpe numeric check(rpe between 1 and 10),
  input_unit text not null check(input_unit in ('kg','lb')),
  weight_source text check(weight_source in ('user_entered','user_confirmed_prefill','user_said')),
  reps_source text check(reps_source in ('user_entered','user_confirmed_prefill','user_said')),
  status text not null check(status in ('done','skipped','voided')), revision integer not null check(revision>0),
  source_ref text not null, payload jsonb not null, request_hash text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(session_id,plan_exercise_id,set_index), unique(id,user_id),
  foreign key(session_id,user_id) references public.workout_sessions(id,user_id) on delete cascade,
  check(status<>'done' or reps is not null),
  check(status<>'skipped' or (weight_kg is null and reps is null and rpe is null)),
  check((weight_kg is null)=(weight_source is null)), check((reps is null)=(reps_source is null))
);
create index set_logs_owner on public.set_logs(user_id);
create table public.workout_session_events (
  sequence bigint generated always as identity primary key, user_id uuid not null, session_id uuid not null,
  set_log_id uuid, type text not null, data jsonb not null, created_at timestamptz not null default now(),
  foreign key(session_id,user_id) references public.workout_sessions(id,user_id) on delete cascade,
  foreign key(set_log_id,user_id) references public.set_logs(id,user_id) on delete cascade
);
create index workout_events_owner_session on public.workout_session_events(user_id,session_id,sequence);
create index workout_events_set on public.workout_session_events(set_log_id,user_id);

alter table public.workout_sessions enable row level security;
alter table public.workout_sessions force row level security;
alter table public.set_logs enable row level security;
alter table public.set_logs force row level security;
alter table public.workout_session_events enable row level security;
alter table public.workout_session_events force row level security;
-- Browser access is read-only; only the server transaction path can mutate.
revoke all on public.workout_sessions,public.set_logs,public.workout_session_events from public,anon,authenticated;
grant select on public.workout_sessions,public.set_logs,public.workout_session_events to authenticated;
grant select,insert,update on public.workout_sessions,public.set_logs to liftcut_workout;
grant select,insert on public.workout_session_events to liftcut_workout;
grant usage on sequence public.workout_session_events_sequence_seq to liftcut_workout;
create policy workout_sessions_read on public.workout_sessions for select to authenticated,liftcut_workout using((select auth.uid())=user_id);
create policy workout_sessions_insert on public.workout_sessions for insert to liftcut_workout with check((select auth.uid())=user_id);
create policy workout_sessions_update on public.workout_sessions for update to liftcut_workout using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy set_logs_read on public.set_logs for select to authenticated,liftcut_workout using((select auth.uid())=user_id);
create policy set_logs_insert on public.set_logs for insert to liftcut_workout with check((select auth.uid())=user_id);
create policy set_logs_update on public.set_logs for update to liftcut_workout using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy workout_events_read on public.workout_session_events for select to authenticated,liftcut_workout using((select auth.uid())=user_id);
create policy workout_events_insert on public.workout_session_events for insert to liftcut_workout with check((select auth.uid())=user_id);
commit;
