-- LiftCut Tracker V1.6 Supabase schema
-- Run in Supabase SQL editor

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  preferred_language text not null default 'zh-CN' check (preferred_language in ('zh-CN','en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gender text not null default 'unknown' check (gender in ('male', 'female', 'other', 'unknown')),
  age int not null default 0 check (age >= 0 and age <= 120),
  fitness_goal text not null default 'fat_loss' check (fitness_goal in ('fat_loss', 'muscle_gain', 'maintenance', 'recomposition')),
  training_experience text not null default 'beginner' check (training_experience in ('beginner', 'intermediate', 'advanced')),
  training_location text not null default 'mixed' check (training_location in ('gym', 'home', 'mixed')),
  available_equipment text[] not null default '{}',
  session_duration_minutes int not null default 0 check (session_duration_minutes >= 0 and session_duration_minutes <= 300),
  diet_preference text not null default 'none' check (diet_preference in ('none', 'high_protein', 'vegetarian', 'low_carb', 'balanced')),
  food_restrictions text not null default '',
  injury_notes text not null default '',
  lifestyle_notes text not null default '',
  height numeric not null default 0,
  current_weight numeric not null default 0,
  target_weight numeric not null default 0,
  weekly_training_days int not null default 0,
  calorie_target int not null default 0,
  protein_target int not null default 0,
  target_weekly_loss_min numeric not null default 0,
  target_weekly_loss_max numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.training_plans (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  notes text not null default '',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backward-compatible migration for older projects (safe to run multiple times)
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
update public.profiles
set display_name = split_part(email, '@', 1)
where display_name is null or btrim(display_name) = '';
update public.profiles
set updated_at = now()
where updated_at is null;

alter table public.user_settings add column if not exists gender text not null default 'unknown' check (gender in ('male', 'female', 'other', 'unknown'));
alter table public.user_settings add column if not exists age int not null default 0 check (age >= 0 and age <= 120);
alter table public.user_settings add column if not exists fitness_goal text not null default 'fat_loss' check (fitness_goal in ('fat_loss', 'muscle_gain', 'maintenance', 'recomposition'));
alter table public.user_settings add column if not exists training_experience text not null default 'beginner' check (training_experience in ('beginner', 'intermediate', 'advanced'));
alter table public.user_settings add column if not exists training_location text not null default 'mixed' check (training_location in ('gym', 'home', 'mixed'));
alter table public.user_settings add column if not exists available_equipment text[] not null default '{}';
alter table public.user_settings add column if not exists session_duration_minutes int not null default 0 check (session_duration_minutes >= 0 and session_duration_minutes <= 300);
alter table public.user_settings add column if not exists diet_preference text not null default 'none' check (diet_preference in ('none', 'high_protein', 'vegetarian', 'low_carb', 'balanced'));
alter table public.user_settings add column if not exists food_restrictions text not null default '';
alter table public.user_settings add column if not exists injury_notes text not null default '';
alter table public.user_settings add column if not exists lifestyle_notes text not null default '';
update public.user_settings
set gender = 'unknown'
where gender is null;
update public.user_settings
set age = 0
where age is null;
update public.user_settings set fitness_goal = 'fat_loss' where fitness_goal is null;
update public.user_settings set training_experience = 'beginner' where training_experience is null;
update public.user_settings set training_location = 'mixed' where training_location is null;
update public.user_settings set available_equipment = '{}' where available_equipment is null;
update public.user_settings set session_duration_minutes = 0 where session_duration_minutes is null;
update public.user_settings set diet_preference = 'none' where diet_preference is null;
update public.user_settings set food_restrictions = '' where food_restrictions is null;
update public.user_settings set injury_notes = '' where injury_notes is null;
update public.user_settings set lifestyle_notes = '' where lifestyle_notes is null;

alter table public.training_plans add column if not exists notes text not null default '';

create table if not exists public.training_plan_weeks (
  id text primary key,
  training_plan_id text not null references public.training_plans(id) on delete cascade,
  week_number int not null
);

create table if not exists public.training_plan_days (
  id text primary key,
  week_id text not null references public.training_plan_weeks(id) on delete cascade,
  day_number int not null,
  title text not null,
  notes text not null default ''
);

create table if not exists public.training_plan_exercises (
  id text primary key,
  day_id text not null references public.training_plan_days(id) on delete cascade,
  name text not null,
  sets int not null,
  rep_range text not null,
  target_rpe numeric not null,
  notes text not null default '',
  alternative_exercises text[] not null default '{}'
);

create table if not exists public.workout_logs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  training_plan_id text not null,
  week_number int not null,
  day_number int not null,
  duration_minutes int not null,
  completed boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.workout_log_exercises (
  id text primary key,
  workout_log_id text not null references public.workout_logs(id) on delete cascade,
  exercise_plan_id text not null,
  name text not null,
  actual_weight numeric,
  actual_reps int,
  actual_rpe numeric,
  completed boolean not null default false
);

-- Compatibility for existing installations; see 20261013234503_unknown_workout_actuals.sql.
alter table public.workout_log_exercises
  alter column actual_weight drop not null,
  alter column actual_reps drop not null,
  alter column actual_rpe drop not null;
update public.workout_log_exercises set actual_rpe = null where actual_rpe = 0;

create table if not exists public.food_logs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  food_name text not null,
  calories int not null,
  protein numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.body_metric_logs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  weight numeric not null,
  waist numeric not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create table if not exists public.ai_training_plan_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_type text not null check (goal_type in ('fat_loss', 'muscle_gain', 'maintenance', 'recomposition')),
  input_profile_json jsonb not null default '{}'::jsonb,
  input_constraints_json jsonb not null default '{}'::jsonb,
  model_name text not null,
  prompt_version text not null,
  raw_response_json jsonb,
  parsed_plan_json jsonb,
  status text not null default 'draft' check (status in ('success', 'failed', 'draft')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_nutrition_plan_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_type text not null check (goal_type in ('fat_loss', 'muscle_gain', 'maintenance', 'recomposition')),
  input_profile_json jsonb not null default '{}'::jsonb,
  input_constraints_json jsonb not null default '{}'::jsonb,
  model_name text not null,
  prompt_version text not null,
  raw_response_json jsonb,
  parsed_plan_json jsonb,
  status text not null default 'draft' check (status in ('success', 'failed', 'draft')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nutrition_plans (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  goal_type text not null check (goal_type in ('fat_loss', 'muscle_gain', 'maintenance', 'recomposition')),
  daily_calorie_target int not null default 0,
  protein_target numeric not null default 0,
  carb_target numeric not null default 0,
  fat_target numeric not null default 0,
  notes text not null default '',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nutrition_plan_days (
  id text primary key,
  nutrition_plan_id text not null references public.nutrition_plans(id) on delete cascade,
  day_number int not null,
  notes text not null default ''
);

create table if not exists public.nutrition_plan_meals (
  id text primary key,
  day_id text not null references public.nutrition_plan_days(id) on delete cascade,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  title text not null,
  foods_json jsonb not null default '[]'::jsonb
);

create index if not exists idx_training_plans_user on public.training_plans(user_id);
create index if not exists idx_workout_logs_user_date on public.workout_logs(user_id, date desc);
create index if not exists idx_food_logs_user_date on public.food_logs(user_id, date desc);
create index if not exists idx_body_logs_user_date on public.body_metric_logs(user_id, date desc);
create index if not exists idx_ai_training_generations_user_date on public.ai_training_plan_generations(user_id, created_at desc);
create index if not exists idx_ai_nutrition_generations_user_date on public.ai_nutrition_plan_generations(user_id, created_at desc);
create index if not exists idx_nutrition_plans_user on public.nutrition_plans(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.training_plans enable row level security;
alter table public.training_plan_weeks enable row level security;
alter table public.training_plan_days enable row level security;
alter table public.training_plan_exercises enable row level security;
alter table public.workout_logs enable row level security;
alter table public.workout_log_exercises enable row level security;
alter table public.food_logs enable row level security;
alter table public.body_metric_logs enable row level security;
alter table public.ai_training_plan_generations enable row level security;
alter table public.ai_nutrition_plan_generations enable row level security;
alter table public.nutrition_plans enable row level security;
alter table public.nutrition_plan_days enable row level security;
alter table public.nutrition_plan_meals enable row level security;

create policy "profiles_self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "settings_self" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "plans_self" on public.training_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "weeks_by_plan_owner" on public.training_plan_weeks
  for all using (
    exists (
      select 1 from public.training_plans p
      where p.id = training_plan_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.training_plans p
      where p.id = training_plan_id and p.user_id = auth.uid()
    )
  );

create policy "days_by_plan_owner" on public.training_plan_days
  for all using (
    exists (
      select 1
      from public.training_plan_weeks w
      join public.training_plans p on p.id = w.training_plan_id
      where w.id = week_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1
      from public.training_plan_weeks w
      join public.training_plans p on p.id = w.training_plan_id
      where w.id = week_id and p.user_id = auth.uid()
    )
  );

create policy "exercises_by_plan_owner" on public.training_plan_exercises
  for all using (
    exists (
      select 1
      from public.training_plan_days d
      join public.training_plan_weeks w on w.id = d.week_id
      join public.training_plans p on p.id = w.training_plan_id
      where d.id = day_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1
      from public.training_plan_days d
      join public.training_plan_weeks w on w.id = d.week_id
      join public.training_plans p on p.id = w.training_plan_id
      where d.id = day_id and p.user_id = auth.uid()
    )
  );

create policy "workout_logs_self" on public.workout_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "workout_exercises_by_owner" on public.workout_log_exercises
  for all using (
    exists (
      select 1 from public.workout_logs w
      where w.id = workout_log_id and w.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.workout_logs w
      where w.id = workout_log_id and w.user_id = auth.uid()
    )
  );

create policy "food_logs_self" on public.food_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "body_logs_self" on public.body_metric_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "ai_training_generations_self" on public.ai_training_plan_generations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "ai_nutrition_generations_self" on public.ai_nutrition_plan_generations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "nutrition_plans_self" on public.nutrition_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "nutrition_plan_days_by_owner" on public.nutrition_plan_days
  for all using (
    exists (
      select 1 from public.nutrition_plans np
      where np.id = nutrition_plan_id and np.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.nutrition_plans np
      where np.id = nutrition_plan_id and np.user_id = auth.uid()
    )
  );

create policy "nutrition_plan_meals_by_owner" on public.nutrition_plan_meals
  for all using (
    exists (
      select 1
      from public.nutrition_plan_days d
      join public.nutrition_plans np on np.id = d.nutrition_plan_id
      where d.id = day_id and np.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1
      from public.nutrition_plan_days d
      join public.nutrition_plans np on np.id = d.nutrition_plan_id
      where d.id = day_id and np.user_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatar_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatar_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatar_owner_update" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatar_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- W1b: fresh-install schema; existing databases use the versioned migration.
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

-- This baseline is followed by the versioned migrations (including the account
-- deletion boundary). Keep those private functions in one migration source;
-- tests/product-db/account-deletion.test.ts checks fresh and upgraded databases.
-- Fresh installs use the same explicit API grants as the incremental migration.
begin;
-- Explicit Data API access for the legacy user-scoped operations. RLS still
-- restricts every row. Do not restore Supabase's old automatic/default grants.
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles, public.user_settings to authenticated;
grant select, insert, update, delete on public.training_plans to authenticated;
grant select, insert, delete on public.training_plan_weeks to authenticated;
grant select, insert on public.training_plan_days, public.training_plan_exercises to authenticated;
grant select, insert, update on public.workout_logs to authenticated;
grant select, insert, delete on public.workout_log_exercises to authenticated;
grant select, insert, update, delete on public.food_logs, public.body_metric_logs to authenticated;
grant select, insert, delete on public.ai_training_plan_generations,
  public.ai_nutrition_plan_generations to authenticated;
grant select, insert, update on public.nutrition_plans to authenticated;
grant select, insert on public.nutrition_plan_days, public.nutrition_plan_meals to authenticated;
-- No anon/service_role, sequence or function grants are needed by these paths.
-- New workout/coach/approval tables retain their separate restricted grants.
-- Existing installations keep their current grants; this additive migration
-- supplies missing privileges, and does not silently revoke custom access.
commit;
