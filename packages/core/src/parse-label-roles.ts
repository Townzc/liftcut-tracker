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
  // Polite discourse markers and anaphoric "the last one" are not reps.
  // Preserve literal "做了一下/一次"; only these non-performance verbs qualify.
  source = source.replace(/(记|记录|确认|看|等|核对|说|问|改|查|想)一下/g, "$1")
    .replace(/(最后|每|这|那|上|下|同)一(?=组|次|个)/g, "$1")
    .replace(/一共/g, "共")
    .replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+set\b/g, "set $1");
  source = replaceSpokenNumbers(source).replace(/公斤|千克|kilograms?|kilos?|kgs?/g, "kg")
    .replace(/磅|pounds?|lbs?/g, "lb");
  const evidence: NumericEvidence[] = [];
  // Explicit multiplication distinguishes a count/reps pair from a load/reps
  // pair; never label a bare load as a set number just because it is numeric.
  for (const m of source.matchAll(new RegExp(`${n}\\s*(?:(kg|lb)\\s*)?[x×*]\\s*${n}`, "g"))) {
    const start = m.index!, right = start + m[0].lastIndexOf(m[3]);
    const polarity = /(?:不是|并非|not)\s*$/.test(source.slice(0, start)) ? "retracted" as const : "stated" as const;
    evidence.push({ role: m[2] ? "weight" : "count", value: Number(m[1]), ...(m[2] ? { unit: m[2] as "kg" | "lb" } : {}),
      start, end: start + m[0].indexOf(m[2] ?? "") + (m[2]?.length ?? m[1].length), text: "", polarity },
      { role: "reps", value: Number(m[3]), start: right, end: right + m[3].length, text: m[3], polarity });
    evidence[evidence.length - 2].text = source.slice(start, evidence[evidence.length - 2].end);
  }
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
