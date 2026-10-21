import { numericRoleEvidence } from "@liftcut/core/parse-label-roles";
import { identifyExercise } from "@liftcut/core/exercise-catalog";
import { resolveConfirmedSet } from "@liftcut/core/confirmed-set-reference";
import { workoutWorkflowBoundary } from "@liftcut/core/workout-draft-context";
import type { Session } from "@liftcut/core/today";

type Values = { exerciseId: string; kind: "record" | "correct"; reps: number[]; weightKg: number | null;
  rpe: number | null; rpeScope: "last" | "each" | null; correctionSet: number | "last" | null };
const normalize = (s: string) => s.normalize("NFKC").toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Match only explicit, unambiguous names. A model-selected ID is not evidence
// of conversation focus. Longer names win over their nested generic aliases.
function mentionedExercises(input: string, session: Session): string[] {
  const text = normalize(input), hits: { id: string; start: number; end: number }[] = [];
  for (const e of session.prescription.exercises) {
    const item = identifyExercise(e.name);
    const names = [e.name, ...(item ? [item.zh, item.en, ...item.aliases] : [])];
    for (const generic of ["深蹲", "卧推", "推举", "划船", "硬拉", "弯举", "下压"])
      if (names.some(n => n.endsWith(generic))) names.push(generic);
    for (const name of new Set(names.map(normalize))) {
      const pattern = `${/^[a-z]/.test(name) ? "(?<![a-z])" : ""}${escape(name)}${/[a-z]$/.test(name) ? "(?![a-z])" : ""}`;
      for (const match of text.matchAll(new RegExp(pattern, "g")))
        hits.push({ id: e.id, start: match.index!, end: match.index! + match[0].length });
    }
  }
  const maximal = hits.filter(h => !hits.some(other => other.start <= h.start && other.end >= h.end
    && (other.start < h.start || other.end > h.end)));
  const ids = new Set(maximal.map(h => h.id));
  return [...ids];
}

function reportIssue(text: string, historical: boolean): string | null {
  if (workoutWorkflowBoundary(text) !== "atomic_candidate") return "WORKOUT_WORKFLOW_REQUIRED";
  if (/单侧|每只|每个哑铃|一边|一侧|each arm|per arm|each dumbbell/i.test(text)
    || !historical && /昨天|前天|上周|去年|yesterday|last week|\d{4}-\d{2}-\d{2}/i.test(text))
    return "WORKOUT_WORKFLOW_REQUIRED";
  if (/同上|重量(?:没变|不变|一样|相同)|(?:同样|相同)的?重量|还是[^，,;；。]*重量|\bsame (?:weight|load)\b/i.test(text))
    return "WORKOUT_CONFIRMED_REFERENCE_REQUIRED";
  if (/[?？]|(?:没|未|没有)(?:完成|做完|达到|做|练)|合适吗|要不要|可以吗|\b(?:didn't|did not|should|would|could)\b|\bcan i\b/i.test(text))
    return "WORKOUT_ACTUAL_REPORT_REQUIRED";
  if (/不确定|记不清|忘了|忘记|好像|大概|差不多|可能|也许|应该|最多|至少|不超过|不到|以上|以下|超过|少于|多于|约\s*[\d一二三四五六七八九十]|[\d一二三四五六七八九十]\s*左右|[\d一二三四五六七八九十]\s*(?:[-~～至到]|或(?:者)?)\s*[\d一二三四五六七八九十]|\b(?:about|around|maybe|probably|unsure)\b|not sure|can't remember|at most|at least|more than|less than|up to/i.test(text))
    return "WORKOUT_QUANTITY_UNCERTAIN";
  return null;
}

/** Necessary checks for the live cloud tool. This does not parse a whole
 * conversation or authorize writes; unresolved references need clarification. */
export function workoutSourceIssue(text: string, session: Session, p: Values, selectedExerciseId?: string): string | null {
  if (session.status !== "active") return "SESSION_ENDED";
  const issue = reportIssue(text, false); if (issue) return issue;
  const mentions = mentionedExercises(text, session);
  if (mentions.length > 1 || (mentions[0] ?? selectedExerciseId) !== p.exerciseId) return "WORKOUT_EXERCISE_NEEDS_REFERENCE";
  const { evidence, normalizedSource: source } = numericRoleEvidence(text, session.prescription.exercises.map(e => e.name));
  const stated = evidence.filter(e => e.polarity === "stated"), reps = stated.filter(e => e.role === "reps");
  const weights = stated.filter(e => e.role === "weight").map(e => Math.round(e.value * (e.unit === "lb" ? 0.45359237 : 1) * 1e6) / 1e6);
  if (p.weightKg !== null && !weights.includes(p.weightKg)) return "WORKOUT_WEIGHT_ROLE_MISMATCH";
  if (new Set(weights).size > 1) return "WORKOUT_MULTIPLE_LOADS_REQUIRE_SEPARATE_DRAFTS";
  if (p.reps.some(n => !reps.some(e => e.value === n))) return "WORKOUT_REPS_ROLE_MISMATCH";
  if (p.rpe !== null && !stated.some(e => e.role === "rpe" && e.value === p.rpe)) return "WORKOUT_RPE_ROLE_MISMATCH";
  if (new Set(stated.filter(e => e.role === "rpe").map(e => e.value)).size > 1)
    return "WORKOUT_MULTIPLE_EFFORTS_REQUIRE_SEPARATE_DRAFTS";
  if (p.kind === "correct") {
    if (!/更正|改正|不对|记错|说错|改成|改为|不是|\b(?:correction|correct|change|actually)\b/i.test(text))
      return "WORKOUT_CORRECTION_INTENT_REQUIRED";
    const targets = [...new Set(stated.filter(e => e.role === "ordinal").map(e => e.value))];
    if (p.correctionSet === null || (typeof p.correctionSet === "number"
      ? targets.length !== 1 || targets[0] !== p.correctionSet
      : targets.length > 0 || !/最后(?:一)?组|\blast set\b/i.test(text))) return "WORKOUT_TARGET_ROLE_MISMATCH";
    if (new Set(reps.map(e => e.value)).size !== 1 || weights.length || stated.some(e => e.role === "rpe"))
      return "CORRECTION_NEEDS_CLARIFICATION";
    try { resolveConfirmedSet(session, { exerciseId: p.exerciseId, target: p.correctionSet }); }
    catch { return "WORKOUT_TARGET_NOT_CONFIRMED"; }
  } else {
    if (p.correctionSet !== null || /更正|改正|不对|记错|说错|改成|改为|帮我改|\b(?:correction|correct|change)\b/i.test(text))
      return "WORKOUT_CORRECTION_INTENT_REQUIRED";
    // A quoted repetition count cannot be duplicated into invented sets.
    const each = /每组|每一组|一组|组组|\beach\b|per set|sets? of|\d\s*[x×*]\s*\d/i.test(source);
    const count = stated.filter(e => e.role === "count");
    const uniform = each && count.length === 1 && count[0].value === p.reps.length
      && reps.length === 1 && p.reps.every(n => n === reps[0].value);
    if (!uniform && (reps.length !== p.reps.length || reps.some((e, i) => e.value !== p.reps[i])))
      return "WORKOUT_SET_COUNT_MISMATCH";
    if (each && count.length && !uniform) return "WORKOUT_SET_COUNT_MISMATCH";
    const ordinals = stated.filter(e => e.role === "ordinal");
    if (ordinals.length) {
      const exercise = session.prescription.exercises.find(e => e.id === p.exerciseId)!;
      const available = Array.from({ length: exercise.sets }, (_, i) => i + 1)
        .find(i => !session.sets.some(s => s.planExerciseId === p.exerciseId && s.setIndex === i));
      if (ordinals.length !== 1 || p.reps.length !== 1 || ordinals[0].value !== available)
        return "WORKOUT_SLOT_NEEDS_REFERENCE";
    }
    if (p.rpe !== null && p.reps.length > 1) {
      const eachRpe = /(?:每(?:一)?组|组组|each set|all sets)\s*(?:都是|是|的|was|is)?\s*rpe|rpe\s*[\d.]+\s*(?:each set|all sets)/i;
      const lastRpe = /(?:最后(?:一)?组|last set)[^，,;；。]*rpe|rpe\s*[\d.]+\s*last set/i;
      if (p.rpeScope === "each" && !eachRpe.test(text)) return "RPE_SCOPE_REQUIRED";
      if (p.rpeScope === "last" && !lastRpe.test(text)) return "RPE_SCOPE_REQUIRED";
    }
  }
  return null;
}

/** Standalone exercise memory cannot be used to bypass workout source checks.
 * A historical date is allowed, but all actuals must be in this report. */
export function standaloneExerciseIssue(text: string, name: string,
  p: { weightKg: number | null; reps: number | null; sets: number | null; rpe: number | null }): string | null {
  const issue = reportIssue(text, true); if (issue) return issue;
  if (/更正|改正|不对|记错|说错|改成|改为|帮我改|\b(?:correction|correct|change)\b/i.test(text))
    return "WORKOUT_CORRECTION_NEEDS_REFERENCE";
  const evidence = numericRoleEvidence(text, [name]).evidence.filter(e => e.polarity === "stated");
  const weights = evidence.filter(e => e.role === "weight").map(e => Math.round(e.value * (e.unit === "lb" ? .45359237 : 1) * 1e6) / 1e6);
  if (p.weightKg !== null && !weights.includes(p.weightKg)) return "WORKOUT_WEIGHT_ROLE_MISMATCH";
  if (new Set(weights).size > 1) return "WORKOUT_MULTIPLE_LOADS_REQUIRE_SEPARATE_DRAFTS";
  for (const [key, role] of [["reps", "reps"], ["sets", "count"], ["rpe", "rpe"]] as const) {
    const values = evidence.filter(e => e.role === role);
    if (p[key] !== null && !values.some(e => e.value === p[key])) return `WORKOUT_${key.toUpperCase()}_ROLE_MISMATCH`;
    if (new Set(values.map(e => e.value)).size > 1) return "WORKOUT_MULTIPLE_VALUES_REQUIRE_SEPARATE_DRAFTS";
  }
  if (evidence.some(e => e.role === "ordinal")) return "WORKOUT_SLOT_NEEDS_REFERENCE";
  return null;
}
