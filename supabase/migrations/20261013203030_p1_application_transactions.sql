-- Apply after schema.sql, using a migration administrator, never the runtime login.
-- The runtime role is deliberately NOT a member of authenticated/service_role.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='liftcut_agent') then
    create role liftcut_agent nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end $$;
create schema agent_private;
revoke all on schema agent_private from public, anon, authenticated;
grant usage on schema agent_private, public, auth to liftcut_agent;
grant execute on function auth.uid() to liftcut_agent;

create table agent_private.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  request_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  version text not null check (version='p1-app-v1'),
  context jsonb not null,
  context_revision integer not null default 0 check (context_revision>=0),
  profile_hash text not null,
  revision integer not null default 0 check (revision>=0),
  status text not null default 'planning' check(status in
    ('planning','awaiting_approval','approved','revoked','declined','applied','stale','budget_exhausted')),
  current_proposal uuid,
  approval_id uuid,
  attempts integer not null default 0 check (attempts>=0),
  created_at timestamptz not null default now(),
  unique(user_id,request_key), unique(id,user_id)
);
create table agent_private.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  run_id uuid not null,
  version integer not null check(version>0),
  context_revision integer not null check(context_revision>=0),
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  plan jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(run_id,user_id) references agent_private.runs(id,user_id),
  unique(run_id,version), unique(id,run_id,user_id)
);
alter table agent_private.runs add constraint current_proposal_belongs_to_run
  foreign key(current_proposal,id,user_id) references agent_private.proposals(id,run_id,user_id);
create table agent_private.events (
  sequence bigint generated always as identity primary key,
  user_id uuid not null, run_id uuid not null,
  type text not null, actor text not null, data jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(run_id,user_id) references agent_private.runs(id,user_id)
);
create table agent_private.execution_keys (
  user_id uuid not null, key uuid not null, run_id uuid not null,
  intent_hash text not null check(intent_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key(user_id,key),
  foreign key(run_id,user_id) references agent_private.runs(id,user_id)
);
create table agent_private.receipts (
  id uuid primary key, user_id uuid not null, run_id uuid not null unique,
  proposal_id uuid not null, receipt jsonb not null,
  foreign key(proposal_id,run_id,user_id) references agent_private.proposals(id,run_id,user_id)
);
create index proposals_owner on agent_private.proposals(user_id);
create index events_owner_run on agent_private.events(user_id,run_id,sequence);
create index keys_run on agent_private.execution_keys(run_id,user_id);
create index receipts_owner on agent_private.receipts(user_id);
create index receipts_proposal on agent_private.receipts(proposal_id,run_id,user_id);

alter table agent_private.runs enable row level security;
alter table agent_private.proposals enable row level security;
alter table agent_private.events enable row level security;
alter table agent_private.execution_keys enable row level security;
alter table agent_private.receipts enable row level security;
create policy owner on agent_private.runs to liftcut_agent
  using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy owner on agent_private.proposals to liftcut_agent
  using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy owner on agent_private.events to liftcut_agent
  using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy owner on agent_private.execution_keys to liftcut_agent
  using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy owner on agent_private.receipts to liftcut_agent
  using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on all tables in schema agent_private from public, anon, authenticated;
grant select,insert,update on agent_private.runs to liftcut_agent;
-- Approved payloads, events, intent bindings and receipts are append-only even for runtime.
grant select,insert on agent_private.proposals,agent_private.events,agent_private.execution_keys,agent_private.receipts to liftcut_agent;
grant usage on sequence agent_private.events_sequence_seq to liftcut_agent;
grant select on public.user_settings to liftcut_agent;
-- SELECT FOR SHARE requires UPDATE privilege, restricted to user_id (never modified by P1).
grant update(user_id) on public.user_settings to liftcut_agent;
grant select,insert,update on public.training_plans to liftcut_agent;
grant select,insert on public.training_plan_weeks,public.training_plan_days,public.training_plan_exercises to liftcut_agent;
-- Existing schema.sql ownership policies apply to these tables, including liftcut_agent.
-- Fail deployment if pre-existing duplicates exist; do not silently choose a user's plan.
create unique index training_plans_one_active_per_user on public.training_plans(user_id) where is_active;
