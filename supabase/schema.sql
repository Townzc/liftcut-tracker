-- LiftCut Tracker V1.1 Supabase schema
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
  height numeric not null,
  current_weight numeric not null,
  target_weight numeric not null,
  weekly_training_days int not null,
  calorie_target int not null,
  protein_target int not null,
  target_weekly_loss_min numeric not null,
  target_weekly_loss_max numeric not null,
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

-- Backward-compatible migration for older projects (run safely multiple times)
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
update public.profiles
set display_name = split_part(email, '@', 1)
where display_name is null or btrim(display_name) = '';
update public.profiles
set updated_at = now()
where updated_at is null;
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

create index if not exists idx_training_plans_user on public.training_plans(user_id);
create index if not exists idx_workout_logs_user_date on public.workout_logs(user_id, date desc);
create index if not exists idx_food_logs_user_date on public.food_logs(user_id, date desc);
create index if not exists idx_body_logs_user_date on public.body_metric_logs(user_id, date desc);

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
