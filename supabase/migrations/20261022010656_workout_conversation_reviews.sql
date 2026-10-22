begin;
-- Conversation focus survives the six-turn prompt window. Only server code can
-- prepare or approve a preview; browser API roles have no access to this ledger.
create table public.workout_coach_contexts (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  request_id uuid not null,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  state jsonb not null check(jsonb_typeof(state)='object' and octet_length(state::text)<=6000),
  updated_at timestamptz not null default now(),
  primary key(user_id,conversation_id)
);
create table public.workout_coach_reviews (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=60000),
  status text not null default 'pending' check(status in ('pending','applied','superseded')),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique(user_id,conversation_id,request_id)
);
create index workout_coach_reviews_owner_session on public.workout_coach_reviews(user_id,session_id);
create index workout_coach_contexts_session on public.workout_coach_contexts(session_id);
create index workout_coach_reviews_session on public.workout_coach_reviews(session_id);
alter table public.workout_coach_contexts enable row level security;
alter table public.workout_coach_contexts force row level security;
alter table public.workout_coach_reviews enable row level security;
alter table public.workout_coach_reviews force row level security;
revoke all on public.workout_coach_contexts,public.workout_coach_reviews from public,anon,authenticated;
grant select,insert,update on public.workout_coach_contexts to liftcut_workout;
grant select,insert,delete on public.workout_coach_reviews to liftcut_workout;
grant update(status,applied_at) on public.workout_coach_reviews to liftcut_workout;
create policy workout_coach_contexts_owner on public.workout_coach_contexts for all to liftcut_workout
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy workout_coach_reviews_owner on public.workout_coach_reviews for all to liftcut_workout
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
-- Deleting a chat removes its unconfirmed prose, while confirmed write evidence
-- remains immutable. A runtime DELETE cannot erase an applied review.
create policy workout_coach_reviews_unconfirmed_delete on public.workout_coach_reviews as restrictive
  for delete to liftcut_workout using(status<>'applied');
commit;
