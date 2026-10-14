-- Extend the existing approval ledger; no health records or active plans change.
alter table agent_private.runs
  add column kind text not null default 'training' check(kind in ('training','nutrition')),
  add column base_state_hash text check(base_state_hash ~ '^[a-f0-9]{64}$'),
  add column baseline jsonb not null default '[]'::jsonb;

grant select, insert, update on public.nutrition_plans to liftcut_agent;
grant select, insert on public.nutrition_plan_days, public.nutrition_plan_meals to liftcut_agent;
do $$ begin
  if exists(select 1 from pg_roles where rolname='liftcut_workout') then
    grant select on public.nutrition_plans, public.nutrition_plan_days, public.nutrition_plan_meals to liftcut_workout;
  end if;
end $$;

-- Existing ownership RLS policies apply to both restricted runtime roles.
-- INVOKER, no data access and no elevated privileges. These triggers share the
-- ledger's per-user lock, so old clients cannot race a checked plan replacement.
-- Administrators with no JWT are migration operators, not application users.
create function agent_private.serialize_plan_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is not null then
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 713));
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
revoke all on function agent_private.serialize_plan_write() from public, anon, authenticated;
do $$ declare tbl text; begin
  foreach tbl in array array['training_plans','training_plan_weeks','training_plan_days','training_plan_exercises',
    'nutrition_plans','nutrition_plan_days','nutrition_plan_meals'] loop
    execute format('create trigger serialize_plan_write before insert or update or delete on public.%I for each row execute function agent_private.serialize_plan_write()', tbl);
  end loop;
end $$;
create index agent_runs_recent on agent_private.runs(user_id, created_at desc);
