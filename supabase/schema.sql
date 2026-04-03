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
  actual_weight numeric not null,
  actual_reps int not null,
  actual_rpe numeric not null,
  completed boolean not null default false
);

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
