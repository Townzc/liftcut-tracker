import { exerciseCatalog, identifyExercise } from "@liftcut/core/exercise-catalog";
import { replaceSpokenNumbers, unitsIn } from "@liftcut/core/parse-label";
import { itemProblems, random, type Item } from "./synth";

const norm = (s: string) => s.normalize("NFKC").toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const aliases = exerciseCatalog.flatMap(e => [e.zh, e.en, ...e.aliases].map(name => ({ name: norm(name), id: e.id })));
const identities = new Map<string, string | undefined>();
const identity = (name: string) => {
  if (!identities.has(name)) identities.set(name, identifyExercise(name)?.id);
  return identities.get(name);
};

/** Exact registered aliases only, with longer mentions taking precedence over
 * embedded aliases. No selected exercise, plan values or fuzzy matching. */
export function mentionedIds(text: string): string[] {
  const input = norm(text);
  const hits = aliases.flatMap(a => [...input.matchAll(new RegExp(
    `${/^[a-z]/.test(a.name) ? "(?<![a-z])" : ""}${escape(a.name)}${/[a-z]$/.test(a.name) ? "(?![a-z])" : ""}`, "g"))]
    .map(m => ({ id: a.id, start: m.index!, end: m.index! + m[0].length })));
  return [...new Set(hits.filter(h => !hits.some(other => other.start <= h.start && other.end >= h.end
    && (other.start < h.start || other.end > h.end))).map(h => h.id))].sort();
}

/** Dataset audit, not a general natural-language parser or write authorization. */
export function trainingPolicyProblems(row: Item): string[] {
  const errors = itemProblems(row), label = row.label, mentions = mentionedIds(row.text);
  const expectedReason = /^(?:contrast_|clarify_)(missing_unit|rpe_scope)(?:_negative)?$/.exec(row.family)?.[1];
  if (expectedReason && (label.intent !== "clarify" || label.reason !== expectedReason)) errors.push("boundary_reason");
  if (row.family.endsWith("_positive") && !["record", "correct"].includes(label.intent)) errors.push("positive_refusal");
  const available = row.context.exercises.map(name => ({ name, id: identity(name) }));
  const matched = available.filter(e => e.id && mentions.includes(e.id));
  if (available.some(e => !e.id) || new Set(available.map(e => e.id)).size !== available.length) errors.push("catalog_identity");
  if (label.intent === "clarify") {
    if (label.reason === "unknown_exercise" && mentions.length === 1 && matched.length === 1) errors.push("registered_alias_is_known");
    if (label.reason === "missing_unit" && unitsIn(row.text).size) errors.push("unit_is_present");
    if (label.reason === "rpe_scope" && effortScope(row.text)) errors.push("rpe_scope_is_explicit");
    return errors;
  }
  if ("exercise" in label && (label.exercise === null ? mentions.length !== 0
    : mentions.length !== 1 || matched.length !== 1 || matched[0].name !== label.exercise)) errors.push("exercise_binding");
  let text = norm(row.text);
  for (const { name } of [...aliases].sort((a, b) => b.name.length - a.name.length)) text = text.split(name).join(" ");
  text = replaceSpokenNumbers(text).replace(/公斤|千克|(?<![a-z])(?:kgs?|kilos?|kilograms?)(?![a-z])/g, "kg")
    .replace(/磅|(?<![a-z])(?:lbs?|pounds?)(?![a-z])/g, "lb");
  const values = label.intent === "record" ? label.sets : label.intent === "correct" ? [label.changes] : [];
  for (const value of values) if (value.weight != null && !new RegExp(
    `(?<![\\d.])${escape(String(value.weight))}\\s*${value.unit}(?![a-z])`).test(text)) errors.push("weight_unit_binding");
  if (label.intent === "record" && label.sets.length > 1 && /rpe\s*\d/i.test(row.text)) {
    const scope = effortScope(row.text), effort = Number(/rpe\s*(\d+(?:\.\d+)?)/i.exec(row.text)![1]);
    if (!scope) errors.push("rpe_scope_missing");
    else if (label.sets.some((s, i) => s.rpe !== (scope === "last" && i < label.sets.length - 1 ? null : effort))) errors.push("rpe_scope_binding");
  }
  return [...new Set(errors)];
}

function effortScope(text: string): "last" | "each" | null {
  const t = norm(text);
  const last = /(?:最后一组|last set)\s*(?:at\s*)?rpe/.test(t);
  const each = /(?:每组|each set|all)\s*(?:都是|at\s*)?rpe|rpe\s*\d+(?:\.\d+)?\s*each set/.test(t);
  return last === each ? null : last ? "last" : "each";
}

/** Repair only the demonstrated v4 ambiguous-name family, using its paired
 * label's explicit fields and the authoritative alias registry. Never infer
 * numeric targets from text, an evaluator failure, or a model response. */
export function repairAliases(rows: Item[]): Item[] {
  return rows.map((row, i) => {
    if (!row.template.startsWith("v4.unknown_exercise.ambiguous-name.") || !row.template.endsWith(".negative")) return structuredClone(row);
    if (row.label.intent !== "clarify" || row.label.reason !== "unknown_exercise") throw new Error("Unexpected alias source");
    const pair = rows[i - 1], ids = mentionedIds(row.text);
    const exercise = row.context.exercises.filter(n => identity(n) === ids[0]);
    if (ids.length !== 1 || exercise.length !== 1 || pair?.id !== row.id.replace(/negative$/, "positive")
      || pair.label.intent !== "record") throw new Error("Unresolved registry alias pair");
    return { ...structuredClone(row), id: `v6-alias-${i}`, family: "registry_alias_positive",
      template: `v6.registry-alias.${row.language}`, label: { ...structuredClone(pair.label), exercise: exercise[0] } };
  });
}

/** Change only the training catalog membership/order. Names come exclusively
 * from training catalogs; no evaluation/private text, labels or directories. */
export function varyCatalogs(rows: Item[]): Item[] {
  const pool = [...new Set(rows.flatMap(r => r.context.exercises))].sort(), rng = random(2026102206);
  return rows.map(row => {
    const mentions = mentionedIds(row.text), label = row.label;
    const target = "exercise" in label ? label.exercise : null;
    const anchors = row.context.exercises.filter(n => identity(n) && mentions.includes(identity(n)!));
    if (target && !anchors.includes(target)) throw new Error("Missing explicit target anchor");
    const anchorIds = new Set(anchors.map(n => identity(n)!));
    const candidates = pool.filter(n => identity(n) && !mentions.includes(identity(n)!) && !anchorIds.has(identity(n)!));
    if (anchors.length + new Set(candidates.map(identity)).size < row.context.exercises.length) throw new Error("Insufficient training catalog pool");
    const exercises = [...anchors];
    while (exercises.length < row.context.exercises.length) {
      const next = rng.pick(candidates), id = identity(next)!;
      if (!exercises.some(n => identity(n)! === id)) exercises.push(next);
    }
    for (let i = exercises.length - 1; i > 0; i--) { const j = rng.int(0, i); [exercises[i], exercises[j]] = [exercises[j], exercises[i]]; }
    return { ...structuredClone(row), context: { ...row.context, exercises,
      selected: row.context.selected && exercises.includes(row.context.selected) ? row.context.selected : null } };
  });
}
