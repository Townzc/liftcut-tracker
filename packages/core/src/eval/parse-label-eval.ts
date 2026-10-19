import { identifyExercise } from "../exercise-catalog";
import { parseLabelSchema, type LabelUnit, type ParseLabel } from "../parse-label";
import { samePlain } from "../plain-data";
import type { ParseContext, ParseResult } from "../workout-log-parser";

/**
 * One evaluation for every sentence parser (rules, cloud model, on-device model):
 * each answer is resolved against the item's session into what would be saved,
 * then compared with the resolved gold label. Unknown stays null throughout.
 */
export type EvalContext = { exercises: string[]; selected: string | null; done: number; setCount: number };
export type EvalItem = { id: string; family: string; language: string; text: string; context: EvalContext; label: ParseLabel };
type SetValue = { weight: number | null; unit: LabelUnit | null; reps: number | null; rpe: number | null };
export type Resolved =
  | { intent: "record"; exercise: string; sets: SetValue[] }
  | { intent: "repeat"; exercise: string; count: number }
  | { intent: "correct"; exercise: string; setIndex: number; changes: { weight?: number; unit?: LabelUnit; reps?: number; rpe?: number } }
  | { intent: "skip"; exercise: string; setIndex: number }
  | { intent: "end" } | { intent: "clarify" };

/** A label as the app would apply it; anything that does not fit the session becomes a clarification. */
export function resolveLabel(label: ParseLabel, c: EvalContext): Resolved {
  if (label.intent === "end" || label.intent === "clarify") return { intent: label.intent };
  const exercise = label.exercise ?? c.selected;
  if (!exercise || !c.exercises.includes(exercise)) return { intent: "clarify" };
  if (label.intent === "record") return c.done + label.sets.length <= c.setCount ? { intent: "record", exercise, sets: label.sets } : { intent: "clarify" };
  if (label.intent === "repeat") return c.done > 0 && c.done + label.count <= c.setCount ? { intent: "repeat", exercise, count: label.count } : { intent: "clarify" };
  if (label.intent === "correct") {
    const setIndex = label.target === "last" ? c.done : label.target;
    return setIndex >= 1 && setIndex <= c.done ? { intent: "correct", exercise, setIndex, changes: label.changes } : { intent: "clarify" };
  }
  const setIndex = label.target === "next" ? c.done + 1 : label.target === "last" ? c.setCount : label.target;
  return setIndex > c.done && setIndex <= c.setCount ? { intent: "skip", exercise, setIndex } : { intent: "clarify" };
}
/** Raw model text: optional code fence, then JSON, then the label schema. */
export function resolveOutput(raw: string, c: EvalContext) {
  let value: unknown;
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return { json: false, schema: false, resolved: null }; }
  const label = parseLabelSchema.safeParse(value);
  return { json: true, schema: label.success, resolved: label.success ? resolveLabel(label.data, c) : null };
}
/** The session as the rule parser sees it: every exercise has `done` saved sets and catalog aliases. */
export function ruleContext(c: EvalContext): ParseContext {
  const exercises = c.exercises.map(name => { const e = identifyExercise(name);
    return { id: name, name, aliases: e ? [e.zh, e.en, ...e.aliases].filter(a => a !== name) : [], setCount: c.setCount }; });
  const actuals = exercises.flatMap(e => Array.from({ length: c.done }, (_, i) => ({ id: `${e.id}:${i + 1}`, exerciseId: e.id, setIndex: i + 1,
    revision: 1, status: "done" as const, weightKg: null, reps: 8, rpe: null })));
  return { exercises, actuals, ...(c.selected ? { selectedExerciseId: c.selected } : {}) };
}
export function resolveRuleResult(result: ParseResult): Resolved {
  if (result.status === "clarify") return { intent: "clarify" };
  const d = result.draft;
  if (d.kind === "end") return { intent: "end" };
  if (d.kind === "record") return { intent: "record", exercise: d.exerciseId, sets: d.sets.map(s => ({ weight: s.reportedWeight, unit: s.inputUnit, reps: s.reps, rpe: s.rpe })) };
  if (d.kind === "correct") return { intent: "correct", exercise: d.exerciseId, setIndex: d.setIndex, changes: d.changes };
  return { intent: "skip", exercise: d.exerciseId, setIndex: d.setIndex };
}

const NUMERIC = /(^|\.)(weight|unit|reps|rpe|count|setIndex)$/;
function flatten(value: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  else out[prefix] = value;
  return out;
}
const quantile = (xs: number[], q: number) => xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : null;
export type Scored = { item: EvalItem; pred: Resolved | null; json?: boolean; schema?: boolean; latencyMs?: number };

/** Metrics from the M4 brief. `invented` counts values given where the gold answer has none (target 0). */
export function scoreParses(rows: Scored[]) {
  let exact = 0, intents = 0, fields = 0, matched = 0, invented = 0, stated = 0, omitted = 0, corrections = 0, located = 0;
  let tp = 0, fp = 0, fn = 0;
  const failures: { id: string; text: string; gold: Resolved; pred: Resolved | null }[] = [], by: Record<string, Record<string, [number, number]>> = { family: {}, language: {} };
  for (const { item, pred } of rows) {
    const gold = resolveLabel(item.label, item.context), ok = samePlain(gold, pred);
    if (ok) exact++; else failures.push({ id: item.id, text: item.text, gold, pred });
    for (const [key, value] of [["family", item.family], ["language", item.language]] as const) {
      const cell = by[key][value] ??= [0, 0]; cell[0] += ok ? 1 : 0; cell[1]++;
    }
    if (pred?.intent === gold.intent) intents++;
    if (gold.intent === "clarify") {
      if (pred?.intent === "clarify") tp++;
      else { fn++; invented += Object.entries(flatten(pred ?? {})).filter(([path, v]) => NUMERIC.test(path) && v !== null).length; } // Values where it should have asked.
      continue;
    }
    if (pred?.intent === "clarify") fp++;
    const g = flatten(gold), p = flatten(pred ?? {});
    for (const [path, value] of Object.entries(g)) {
      fields++; if (samePlain(value, p[path])) matched++;
      if (NUMERIC.test(path) && value !== null) { stated++; if (p[path] === null || p[path] === undefined) omitted++; }
    }
    for (const [path, value] of Object.entries(p)) if (NUMERIC.test(path) && value !== null && (g[path] === null || g[path] === undefined)) invented++;
    if (gold.intent === "correct") { corrections++; if (pred?.intent === "correct" && pred.exercise === gold.exercise && pred.setIndex === gold.setIndex) located++; }
  }
  const latencies = rows.map(r => r.latencyMs).filter((x): x is number => typeof x === "number");
  const rate = (a: number, b: number) => b ? Math.round(a / b * 10000) / 10000 : null;
  return {
    total: rows.length, exact, exactRate: rate(exact, rows.length), intentAccuracy: rate(intents, rows.length),
    fieldAccuracy: rate(matched, fields), invented, omissionRate: rate(omitted, stated),
    correctionLocalization: rate(located, corrections), clarifyPrecision: rate(tp, tp + fp), clarifyRecall: rate(tp, tp + fn),
    jsonValidRate: rows.some(r => r.json !== undefined) ? rate(rows.filter(r => r.json).length, rows.length) : null,
    schemaValidRate: rows.some(r => r.schema !== undefined) ? rate(rows.filter(r => r.schema).length, rows.length) : null,
    latencyMs: latencies.length ? { p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95), max: Math.max(...latencies) } : null,
    byFamily: by.family, byLanguage: by.language, failures,
  };
}
