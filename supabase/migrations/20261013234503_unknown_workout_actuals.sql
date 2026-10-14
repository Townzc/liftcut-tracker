-- Unknown measurements must survive round trips as NULL, not a fabricated zero.
-- Run before deploying the nullable application; do not run against production from CI.
begin;
alter table public.workout_log_exercises
  alter column actual_weight drop not null,
  alter column actual_reps drop not null,
  alter column actual_rpe drop not null;

-- This app uses training RPE 1–10. Only its historical empty sentinel is known.
-- Weight/reps zero and target-equal RPE cannot be classified; leave them untouched.
update public.workout_log_exercises set actual_rpe = null where actual_rpe = 0;
commit;
