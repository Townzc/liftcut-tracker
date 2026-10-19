import type { Session } from "./today";
import { parseWorkoutLog, type ParseResult } from "@liftcut/core/workout-log-parser";
import { workoutContext } from "./workout-context";
import { identifyExercise } from "@liftcut/core/exercise-catalog";
import { isCoachIntroduction } from "./coach-local-chat";

export type CoachIntent = { kind: "help" | "plan" | "progress" | "receipts" | "longTerm" | "noSession" | "invalid" }
  | { kind: "replace"; exerciseId?: string }
  | { kind: "parse"; result: ParseResult };
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().trim().replace(/[。.!?？]+$/, "").trim();

// This is a bounded rule router, not a free-form model. No network, side effects,
// authorization or numeric inference. Actual drafts use the existing parser.
export function coachIntent(input: string, session: Session | null | undefined, selected?: string): CoachIntent {
  if (!input.trim() || input.length > 400) return {kind: "invalid"};
  const text = normalize(input);
  if (isCoachIntroduction(text)) return {kind: "help"};
  if (/^(查看回执|回执|撤销|撤销上一条|取消上一条|(?:show )?receipts|undo|undo last)$/.test(text)) return {kind: "receipts"};
  if (/^(修改长期计划|长期计划|change long-term plan|long-term plan)$/.test(text)) return {kind: "longTerm"};
  if (!session || session.status !== "active") return {kind: "noSession"};
  if (/^(看看本次计划|查看本次计划|今天练什么|我今天练什么|本次计划|show plan|today's plan|what is my plan)$/.test(text)) return {kind: "plan"};
  if (/^(已完成多少|我做了多少|训练进度|本次进度|查看进度|progress|my progress)$/.test(text)) return {kind: "progress"};
  const replacement = /^(?:替换动作|更换动作|替换|更换|换掉|replace(?: exercise)?|swap(?: exercise)?)\s*[:：]?\s*(.*)$/.exec(text);
  if (replacement) {
    const name = replacement[1].trim();
    const context = workoutContext(session);
    const named = name ? identifyExercise(name) : null;
    const matches = context.exercises.filter(e => normalize(e.name) === name || (!!named && identifyExercise(e.name)?.id === named.id));
    const exerciseId = name ? matches.length === 1 ? matches[0].id : undefined
      : session.prescription.exercises.find(e => e.id === selected)?.id;
    // An explicit but unknown name never silently falls back to a selected one.
    return {kind: "replace", exerciseId};
  }
  return {kind: "parse", result: parseWorkoutLog(input, workoutContext(session, selected))};
}
