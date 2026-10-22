/**
 * Everything LiftCut may send to a language model, by category. The consent
 * screen is rendered from this list and record reads are filtered by it, so a
 * field that is not listed here never reaches a provider (plan rule 3). Adding a
 * field means editing this list, which changes MODEL_DATA_HASH, which a test ties
 * to the consent version: users are asked again whenever the list grows.
 */
/** `nested` lists the fields holding lists of records filtered with the same field list; other allowed values pass whole. */
export type ModelDataCategory = { id: string; topics: readonly string[]; fields: readonly string[]; nested?: readonly string[]; accountOnly?: true; zh: string; en: string };

export const MODEL_DATA: readonly ModelDataCategory[] = [
  { id: "conversation", topics: [], fields: [], zh: "你这次输入的消息，以及当前对话最近六轮", en: "Your message and the last six turns of this conversation" },
  { id: "body", topics: ["body"], fields: ["id", "kind", "date", "weightKg", "waistCm", "legacy"],
    zh: "身体记录：日期、体重、腰围", en: "Body records: date, weight, waist" },
  { id: "food", topics: ["food"], fields: ["id", "kind", "date", "mealType", "foodName", "calories", "protein", "legacy"],
    zh: "饮食记录：日期、餐次、食物名、热量、蛋白质", en: "Food records: date, meal, food name, calories, protein" },
  { id: "workout", topics: ["workout"], fields: ["id", "date", "status", "legacy", "actualSets", "exercise", "setIndex", "weightKg", "perHandLoad", "reps", "sets", "rpe"], nested: ["actualSets"],
    zh: "训练记录：日期、动作、组号、重量、单边重量、次数、组数、RPE", en: "Workout records: date, exercise, set, weight, per-hand load, reps, sets, RPE" },
  { id: "memory", topics: ["memory"], fields: ["id", "recordId", "date", "createdAt", "metric", "value", "unit", "source", "exerciseName", "reps", "sets", "rpe"],
    zh: "已确认的最新记录：体重、腰围、各动作最近重量、你说过的训练偏好（目标、时间、器械、饮食、伤病、单位）",
    en: "Latest confirmed values: weight, waist, latest load per exercise, and the training preferences you stated (goal, schedule, equipment, diet, injuries, units)" },
  { id: "plans", topics: ["plan", "nutrition"], accountOnly: true, fields: ["plan", "week", "day", "title", "exercise", "targetSets", "targetReps", "targetRpe",
    "calorieTarget", "proteinTarget", "mealType", "foods", "actual", "rule", "candidates"],
    zh: "当前训练计划与营养计划（目标值，不是实际记录）", en: "Your current training and nutrition plans (targets, not actual records)" },
  { id: "profile", topics: ["profile"], accountOnly: true, fields: ["fitnessGoal", "experience", "equipment", "sessionMinutes", "weeklyTrainingDays", "targetWeightKg",
    "calorieTarget", "proteinTarget", "actual"],
    zh: "个人设置：目标、训练经验、地点与器械、每次时长、每周天数、目标体重、热量与蛋白质目标；生成或调整计划时还包括年龄、性别、身高、当前体重、饮食偏好与忌口、伤病与生活习惯备注",
    en: "Settings: goal, experience, location and equipment, session length, days per week, target weight, calorie and protein targets; when drafting a plan also age, gender, height, current weight, diet and food restrictions, injury and lifestyle notes" },
  { id: "currentWorkout", topics: ["current_workout"], accountOnly: true, nested: ["exercises", "actualSets"],
    fields: ["sourceId", "readAt", "active", "id", "date", "status", "revision", "exercises", "name", "actualSets", "exerciseId", "setIndex", "reps", "weightKg", "rpe", "selectedExerciseId", "perHandLoad", "confirmedFocus", "pendingText"],
    zh: "进行中的训练：处方里的动作名、已记录的组（组号、次数、重量、单边重量、RPE、状态），本对话最后确认的记录及待澄清原话", en: "The workout in progress: prescribed exercise names, recorded sets (set, reps, weight, per-hand load, RPE, status), the last record confirmed in this conversation, and the unconfirmed message awaiting clarification" },
  { id: "planning", topics: ["plan_context"], accountOnly: true,
    fields: ["kind", "personalization", "sourceId", "currentPlans", "editingPendingDraft", "editablePlan", "instruction"],
    zh: "生成或调整计划时：把上面的个人设置、已确认记录和当前计划整理成计划依据，以及待你批准的计划草稿",
    en: "When drafting a plan: the settings, confirmed values and current plans above, arranged as the plan basis, plus any draft awaiting your approval" },
];

/** Keeps only the listed fields of each row (and of each record in a `nested` list); an unlisted topic yields no rows. */
export function allowModelRows(topic: string, rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const category = MODEL_DATA.find(c => c.topics.includes(topic));
  if (!category) return [];
  const pick = (row: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(row)
    .filter(([k]) => category.fields.includes(k))
    .map(([k, v]) => [k, category.nested?.includes(k) && Array.isArray(v) ? v.map(x => x && typeof x === "object" ? pick(x as Record<string, unknown>) : x) : v]));
  return rows.map(pick);
}

/** One tool result through the same filter; null when its topic is not listed. */
export const allowModelObject = (topic: string, value: Record<string, unknown>) => allowModelRows(topic, [value])[0] ?? null;

/** FNV-1a over the list: no crypto module is needed on the phone or in the browser. */
export const MODEL_DATA_HASH = (() => {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(MODEL_DATA)) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
})();
