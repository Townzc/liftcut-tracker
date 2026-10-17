-- Read access only; the plan role still cannot write actual health records.
grant select on public.personal_record_events,public.body_metric_logs,public.set_logs,
  public.workout_sessions,public.workout_logs,public.workout_log_exercises to liftcut_agent;
create policy personal_record_plan_read on public.personal_record_events for select to liftcut_agent using((select auth.uid())=user_id);
create policy set_logs_plan_read on public.set_logs for select to liftcut_agent using((select auth.uid())=user_id);
create policy workout_sessions_plan_read on public.workout_sessions for select to liftcut_agent using((select auth.uid())=user_id);

-- Reuse the JWT-subject-only INVOKER lock: no auth-schema access/elevation.
-- Statement triggers take the owner's ledger lock before any row lock, so a
-- concurrent measurement or undo cannot race the approval freshness check.
do $$ declare tbl text; begin
  foreach tbl in array array['personal_record_events','body_metric_logs','set_logs',
    'workout_sessions','workout_logs','workout_log_exercises'] loop
    execute format('create trigger serialize_memory_write before insert or update or delete on public.%I for each statement execute function agent_private.serialize_plan_write()',tbl);
  end loop;
end $$;
