import { format, messages, type Locale, type MessageKey } from "./messages";

type Values = { load: number | null; unit: "kg" | "lb" | null; reps: number | null; rpe: number | null; perHand?: boolean };
/** Presentation only: no unit inference, conversion, rounding or replacement of null by zero. */
export function setValues(values: Values, locale: Locale) {
  const m = messages[locale], unit = values.unit === "kg" ? m.unitKg : values.unit === "lb" ? m.unitLb : "";
  const load = `${values.load ?? "—"}${unit ? ` ${unit}` : ""}${values.perHand ? ` ${m.perHand}` : ""}`;
  return format(m.setValues, { load, reps: values.reps ?? "—", rpe: values.rpe ?? "—" });
}
export function confirmedValues(s: { weightKg: number | null; reps: number | null; rpe: number | null;
  perHandLoad?: { value: number; unit: "kg" | "lb" } }, locale: Locale) {
  return setValues({ load: s.perHandLoad?.value ?? s.weightKg, unit: s.perHandLoad?.unit ?? "kg",
    perHand: !!s.perHandLoad, reps: s.reps, rpe: s.rpe }, locale);
}
const topics: Record<string, MessageKey> = { body: "sourceBody", food: "sourceFood", workout: "sourceWorkout",
  plan: "sourcePlan", nutrition: "sourceNutrition", profile: "sourceProfile" };
export const sourceTopic = (topic: string, locale: Locale) => messages[locale][topics[topic] ?? "sourceRecords"];

/** Preserve the stored custom title; use the known week/day when no translation is available. */
export function workoutTitle(title: string, locale: Locale, week: number, day: number) {
  const chinese = /\p{Script=Han}/u.test(title);
  const foreign = locale === "en" ? chinese : !chinese && /[a-z]{2,}/i.test(title);
  return foreign ? format(messages[locale].day, { week, day }) : title;
}
