import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyRegionOf } from "@liftcut/core/exercise-catalog";
import { muscleVolume } from "@liftcut/core/muscle-volume";

const row = (name: string, completed = true, recordedSets?: number) => ({ id: "r", workoutLogId: "w", exercisePlanId: "e", name,
  actualWeight: 60, actualReps: 5, actualRpe: null, completed, ...(recordedSets === undefined ? {} : { recordedSets }) });

test("sets count toward the catalog region of each exercise, including aliases; unknown names are listed, not guessed", () => {
  const logs = [{ date: "2026-10-19", exercises: [row("杠铃卧推", true, 1), row("卧推", true, 1), row("Barbell Bench Press", true, 1),
    row("哑铃弯举", true, 1), row("哑铃弯举", false, 1), row("我自创的动作", true, 1), row("深蹲", true, 1)] }];
  const v = muscleVolume(logs, "2026-10-19", 7);
  assert.equal(v.regions.chest.sets, 3);
  assert.equal(v.regions.biceps.sets, 1); // The uncompleted row adds nothing.
  assert.deepEqual(v.unclassified, [{ name: "我自创的动作", sets: 1, unknownRows: 0 }]);
  assert.equal(v.regions.quadriceps.sets, 1); // "深蹲" names several catalog squats, all of them quadriceps.
  // A generic name counts only when every catalog exercise ending with it agrees.
  assert.deepEqual(["划船", "推举", "腿弯举", "弯举", "腿举", "推"].map(n => bodyRegionOf(n)), ["back", "shoulders", "hamstrings", null, null, null]);
});

test("the window ends today and includes exactly the given number of days; rows without a set count stay unknown", () => {
  const logs = [{ date: "2026-10-13", exercises: [row("深蹲", true, 1)] }, { date: "2026-10-12", exercises: [row("深蹲", true, 1)] },
    { date: "2026-10-20", exercises: [row("深蹲", true, 1)] }, { date: "2026-10-15", exercises: [row("深蹲"), row("深蹲")] }];
  const week = muscleVolume(logs, "2026-10-19", 7);
  assert.deepEqual([week.from, week.to], ["2026-10-13", "2026-10-19"]);
  assert.deepEqual(week.regions.quadriceps, { sets: 1, unknownRows: 2 }); // 12th is outside, 20th is after today.
  assert.deepEqual(muscleVolume(logs, "2026-10-19", 28).regions.quadriceps, { sets: 2, unknownRows: 2 });
});
