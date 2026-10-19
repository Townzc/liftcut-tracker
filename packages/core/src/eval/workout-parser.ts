import { parseWorkoutLog, type ParseResult } from "../workout-log-parser";
import { contexts, workoutLogCorpus } from "./workout-log-corpus";

// Plain-data equivalents of Node's deep strict equality and structured clone, so
// the evaluator also runs where Node built-ins do not exist (Expo, browsers).
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>, keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every(k => Object.hasOwn(y, k) && same(x[k], y[k]));
}
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}
function fields(value: unknown, prefix = "", result: Record<string, unknown> = {}) {
  if (value !== null && typeof value === "object") {
    for (const [key,child] of Object.entries(value)) fields(child, `${prefix}.${key}`,result);
  } else result[prefix] = value;
  return result;
}
/** Evaluation is independent of production grammar. Exact draft match is also
 * required: accepting empty/rejected output cannot pass the null-only metric. */
export function evaluateWorkoutParser(parser = parseWorkoutLog) {
  let exact = 0, fieldCount = 0, matchedFields = 0, nullFields = 0, inventedNulls = 0;
  let reportedFields = 0, omittedFields = 0, correctionCount = 0, correctionMatches = 0;
  let expectedDrafts = 0, draftMatches = 0, falseDrafts = 0;
  const failures: {id:string;expected:unknown;actual:ParseResult}[] = [];
  for (const item of workoutLogCorpus) {
    const actual = parser(item.text,clone(contexts[item.context]));
    const expected = item.expected === "clarify" ? {status:"clarify"} : {status:"draft",draft:item.expected};
    const correct = item.expected === "clarify" ? actual.status === "clarify" : same(actual,expected);
    if (correct) exact++; else failures.push({id:item.id,expected,actual});
    if (item.expected === "clarify") { if (actual.status === "draft") falseDrafts++; continue; }
    expectedDrafts++; if (correct) draftMatches++;
    const gold = fields(item.expected), found = fields(actual.status === "draft" ? actual.draft : {});
    for (const [path, value] of Object.entries(gold)) {
      fieldCount++; if (same(value,found[path])) matchedFields++;
      if (value === null) { nullFields++; if (found[path] !== null && found[path] !== undefined) inventedNulls++; }
      // Count only actual numeric inputs, not missing IDs/status metadata.
      if (/\.(weightKg|reportedWeight|reps|rpe)$/.test(path) && value !== null) {
        reportedFields++; if (found[path] === null || found[path] === undefined) omittedFields++;
      }
    }
    if (item.expected.kind === "correct") {
      correctionCount++;
      if (actual.status === "draft" && actual.draft.kind === "correct" &&
          actual.draft.recordId === item.expected.recordId && actual.draft.revision === item.expected.revision &&
          actual.draft.exerciseId === item.expected.exerciseId && actual.draft.setIndex === item.expected.setIndex) correctionMatches++;
    }
  }
  return {total:workoutLogCorpus.length,exact,expectedDrafts,draftMatches,expectedClarifications:workoutLogCorpus.length-expectedDrafts,
    falseDrafts,fieldCount,matchedFields,nullFields,inventedNulls,reportedFields,omittedFields,correctionCount,correctionMatches,
    families:[...new Set(workoutLogCorpus.map(r=>r.family))].length,
    languages:Object.fromEntries(["zh","en","mixed"].map(lang=>[lang,workoutLogCorpus.filter(r=>r.language===lang).length])),failures};
}
