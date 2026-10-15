begin;
create table public.coach_conversations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(char_length(title)<=80),
  created_at timestamptz not null default now(),
  updated_at timestamptz(3) not null default now(),
  deleted_at timestamptz,
  unique(id,user_id)
);
create index coach_conversations_owner_recent on public.coach_conversations(user_id,updated_at desc,id desc) where deleted_at is null;
create index coach_conversations_owner on public.coach_conversations(user_id);
create table public.coach_turns (
  id uuid primary key,
  conversation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz(3) not null,
  revision integer not null check(revision between 1 and 1000000),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=24000),
  foreign key(conversation_id,user_id) references public.coach_conversations(id,user_id) on delete cascade
);
create index coach_turns_owner_page on public.coach_turns(user_id,conversation_id,at desc,id desc);
alter table public.coach_conversations enable row level security;
alter table public.coach_conversations force row level security;
alter table public.coach_turns enable row level security;
alter table public.coach_turns force row level security;
revoke all on public.coach_conversations,public.coach_turns from public,anon,authenticated;
grant select,insert,update on public.coach_conversations to liftcut_workout;
grant select,insert,update,delete on public.coach_turns to liftcut_workout;
create policy coach_conversations_owner on public.coach_conversations for all to liftcut_workout
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy coach_turns_owner on public.coach_turns for all to liftcut_workout
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);

-- One server round trip. Separate SQL statements after the lock acquire fresh
-- READ COMMITTED snapshots; a single lock/count CTE would allow stale counts.
-- SECURITY INVOKER preserves the runtime role and every existing RLS policy.
create function public.reserve_coach_request(request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
  began timestamptz := clock_timestamp();
  locked_at timestamptz; checked_at timestamptz;
  minute_count integer; day_count integer; already_used boolean;
begin
  if owner_id is null then raise exception 'OWNER_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text,716));
  locked_at := clock_timestamp();
  select count(*) filter(where created_at>now()-interval '60 seconds'),count(*),
    exists(select 1 from public.coach_request_usage where id=request_id)
    into minute_count,day_count,already_used
    from public.coach_request_usage where user_id=owner_id and created_at>now()-interval '24 hours';
  checked_at := clock_timestamp();
  if already_used then return jsonb_build_object('error','REQUEST_ALREADY_USED'); end if;
  if minute_count>=6 or day_count>=60 then return jsonb_build_object('error','RATE_LIMITED'); end if;
  insert into public.coach_request_usage(id,user_id) values(request_id,owner_id);
  return jsonb_build_object('lockMs',extract(epoch from locked_at-began)*1000,
    'checkMs',extract(epoch from checked_at-locked_at)*1000,'insertMs',extract(epoch from clock_timestamp()-checked_at)*1000);
end $$;
revoke all on function public.reserve_coach_request(uuid) from public,anon,authenticated;
grant execute on function public.reserve_coach_request(uuid) to liftcut_workout;
commit;
