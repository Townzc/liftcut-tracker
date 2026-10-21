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
