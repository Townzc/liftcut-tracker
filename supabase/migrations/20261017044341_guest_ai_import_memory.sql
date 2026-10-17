-- No prompts, IP addresses or guest health records are stored by the trial limiter.
create schema if not exists coach_private;
revoke all on schema coach_private from public, anon, authenticated;
grant usage on schema coach_private to liftcut_workout;
create table coach_private.guest_ai_usage (
  request_id uuid primary key,
  guest_id uuid not null,
  network_hash text not null check (length(network_hash)=64),
  created_at timestamptz not null default now()
);
create index guest_ai_usage_time on coach_private.guest_ai_usage(created_at);
create index guest_ai_usage_guest on coach_private.guest_ai_usage(guest_id,created_at);
create index guest_ai_usage_network on coach_private.guest_ai_usage(network_hash,created_at);
alter table coach_private.guest_ai_usage enable row level security;
alter table coach_private.guest_ai_usage force row level security;
create policy guest_usage_internal on coach_private.guest_ai_usage to liftcut_workout using (true) with check (true);
revoke all on coach_private.guest_ai_usage from public, anon, authenticated;
grant select,insert on coach_private.guest_ai_usage to liftcut_workout;

create table coach_private.guest_imports (
  workspace_id uuid primary key,
  guest_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now()
);
create index guest_imports_owner on coach_private.guest_imports(user_id);
alter table coach_private.guest_imports enable row level security;
alter table coach_private.guest_imports force row level security;
create policy guest_import_owner on coach_private.guest_imports to liftcut_workout
  using (user_id=auth.uid()) with check (user_id=auth.uid());
revoke all on coach_private.guest_imports from public, anon, authenticated;
grant select,insert on coach_private.guest_imports to liftcut_workout;
