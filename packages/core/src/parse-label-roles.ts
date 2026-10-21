import { parseLabelSchema, replaceSpokenNumbers } from "./parse-label";

/** A necessary gate, NOT a semantic parser or authorization to write. Frozen
 * source-v1/v2 stay unchanged. Spans index normalizedSource, not the raw input. */
export type NumericRole = "weight" | "reps" | "rpe" | "ordinal" | "count";
export type NumericEvidence = { role: NumericRole; value: number; unit?: "kg" | "lb";
  start: number; end: number; text: string; polarity: "stated" | "retracted" };
const n = "(\\d+(?:\\.\\d+)?)";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function numericRoleEvidence(input: string, exerciseNames: readonly string[] = []) {
  let source = input.normalize("NFKC").toLowerCase();
  // An exercise's number (e.g. 三头肌) is not a performance measurement.
  for (const name of [...exerciseNames].sort((a, b) => b.length - a.length)) {
    const normalized = name.normalize("NFKC").toLowerCase().trim();
    if (normalized) source = source.replace(new RegExp(escape(normalized), "g"), " ");
  }
  source = source.replace(/(最后|每|这|那|上|下|同)一(?=组|次)/g, "$1")
    .replace(/一共/g, "共");
  source = replaceSpokenNumbers(source).replace(/公斤|千克|kilograms?|kilos?|kgs?/g, "kg")
    .replace(/磅|pounds?|lbs?/g, "lb");
  const evidence: NumericEvidence[] = [];
  const patterns: [NumericRole, string][] = [["weight", `${n}\\s*(kg|lb)`],
    ["rpe", `rpe\\s*(?:大概|约|应该是|是|为|[:=])?\\s*${n}`],
    ["ordinal", `(?:第\\s*${n}\\s*组|(?:set\\s+${n})|${n}(?:st|nd|rd|th)\\s+set)`],
    ["count", `${n}\\s*(?:组|sets?\\b)`], ["reps", `${n}\\s*(?:次|个|下|reps?\\b)`]];
  for (const [role, pattern] of patterns) {
    for (const m of source.matchAll(new RegExp(pattern, "g"))) {
      const start = m.index!, end = start + m[0].length;
      if (evidence.some(e => start < e.end && end > e.start)) continue;
      const prefix = source.slice(0, start).split(/[,，。.;；]/).at(-1)!;
      evidence.push({ role, value: Number(m.slice(1).find(v => v !== undefined && /^\d/.test(v))),
        ...(role === "weight" ? { unit: m[2] as "kg" | "lb" } : {}), start, end, text: m[0],
        polarity: /(?:不是|并非|not)\s*(?:rpe\s*)?$/.test(prefix) ? "retracted" : "stated" });
    }
  }
  return { normalizedSource: source, evidence: evidence.sort((a, b) => a.start - b.start) };
}

export function labelRoleProblems(input: string, output: unknown, exerciseNames: readonly string[] = []): string[] {
  if (input.length > 400) return ["input_length"];
  const parsed = parseLabelSchema.safeParse(output);
  if (!parsed.success) return ["invalid_output"];
  const label = parsed.data;
  if (label.intent === "clarify" || label.intent === "end") return [];
  const { evidence } = numericRoleEvidence(input, exerciseNames);
  const has = (role: NumericRole, value: number, unit?: string) => evidence.some(e =>
    e.polarity === "stated" && e.role === role && e.value === value && (unit === undefined || e.unit === unit));
  const errors: string[] = [];
  if ((label.intent === "correct" || label.intent === "skip") && typeof label.target === "number"
      && !has("ordinal", label.target)) errors.push("target_requires_ordinal");
  if (label.intent === "repeat" && label.count !== 1 && !has("count", label.count)) errors.push("count_requires_sets");
  const values: { weight?: number | null; unit?: "kg" | "lb" | null; reps?: number; rpe?: number | null }[] = label.intent === "record" ? label.sets
    : label.intent === "correct" ? [label.changes] : [];
  for (const [i, value] of values.entries()) {
    if (value.weight != null && !has("weight", value.weight, value.unit ?? undefined)) errors.push(`values[${i}].weight_role`);
    if (value.reps != null && !has("reps", value.reps)) errors.push(`values[${i}].reps_role`);
    if (value.rpe != null && !has("rpe", value.rpe)) errors.push(`values[${i}].rpe_role`);
  }
  return errors;
}
