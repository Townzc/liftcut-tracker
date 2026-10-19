import { z } from "zod";

/**
 * Version 1 of the context-free label a sentence parser emits (M4): what the user
 * said, never what the plan prescribes. Set numbers, record IDs and kg conversion
 * are resolved later by deterministic code against the session, so the label
 * holds only values the sentence states. Unknown is null; "last"/"next" stay
 * symbolic because the sentence does not say which set number that is.
 */
export const PARSE_LABEL_VERSION = 1;
const unit = z.enum(["kg", "lb"]);
const weight = z.number().min(0).max(2205); // 1000 kg in lb.
const reps = z.number().int().min(0).max(100);
const rpe = z.number().min(1).max(10).multipleOf(0.5);
const setNumber = z.number().int().min(1).max(100);
/** The exercise as named in the session's list, or null when the sentence does not name one. */
const exercise = z.string().trim().min(1).max(60).nullable();
const set = z.strictObject({ weight: weight.nullable(), unit: unit.nullable(), reps, rpe: rpe.nullable() })
  .refine(s => (s.weight === null) === (s.unit === null), "weight and unit are stated together");
export const CLARIFY_REASONS = ["uncertain_quantity", "plan_not_actual", "negation", "question", "missing_reps", "missing_unit",
  "unsupported_unit", "rpe_scope", "unknown_exercise", "out_of_range"] as const;
export const parseLabelSchema = z.discriminatedUnion("intent", [
  z.strictObject({ intent: z.literal("record"), exercise, sets: z.array(set).min(1).max(16) }),
  /** "同上" / "same again": copy the last confirmed set; the label carries no numbers of its own. */
  z.strictObject({ intent: z.literal("repeat"), exercise, count: z.number().int().min(1).max(16) }),
  z.strictObject({ intent: z.literal("correct"), exercise, target: z.union([setNumber, z.literal("last")]),
    changes: z.strictObject({ weight: weight.optional(), unit: unit.optional(), reps: reps.optional(), rpe: rpe.optional() })
      .refine(c => (c.weight === undefined) === (c.unit === undefined), "weight and unit are stated together")
      .refine(c => Object.keys(c).length > 0, "a correction changes something") }),
  z.strictObject({ intent: z.literal("skip"), exercise, target: z.union([setNumber, z.enum(["last", "next"])]) }),
  z.strictObject({ intent: z.literal("end") }),
  z.strictObject({ intent: z.literal("clarify"), reason: z.enum(CLARIFY_REASONS) }),
]);
export type ParseLabel = z.infer<typeof parseLabelSchema>;
export type LabelUnit = z.infer<typeof unit>;

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const EN_SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const EN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const EN_ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

/** Chinese numerals as spoken in a gym: 十二, 六十五, 一百零五, colloquial 一百二 (120), 七点五. */
function chineseNumber(text: string) {
  const [whole, fraction = ""] = text.split("点");
  let value = 0, digit: number | null = null, last = 0, zero = false;
  for (const ch of whole) {
    if (ch in CN_UNITS) { value += (digit ?? 1) * CN_UNITS[ch]; last = CN_UNITS[ch]; digit = null; zero = false; }
    else if (CN_DIGITS[ch] === 0) zero = true;
    else digit = CN_DIGITS[ch];
  }
  if (digit !== null) value += last >= 100 && !zero ? digit * last / 10 : digit;
  return fraction ? Number(`${value}.${[...fraction].map(ch => CN_DIGITS[ch]).join("")}`) : value;
}
function englishNumber(words: string) {
  let value = 0;
  for (const w of words.split(/[\s-]+/)) {
    if (w === "hundred") value = (value || 1) * 100;
    else if (w !== "and") value += EN_TENS[w] ?? EN_ORDINALS[w] ?? EN_SMALL.indexOf(w);
  }
  return value;
}
const alt = (words: string[]) => `(?:${[...words].sort((a, b) => b.length - a.length).join("|")})`;
const EN_TENS_UNIT = `${alt(Object.keys(EN_TENS))}(?:[\\s-]${alt(EN_SMALL.slice(1, 10))})?`, EN_BELOW_100 = `(?:${EN_TENS_UNIT}|${alt(EN_SMALL)})`;
const EN_NUMBER = `(?:(?:${EN_BELOW_100}\\s+)?hundred(?:\\s+and)?(?:\\s+${EN_BELOW_100})?|${EN_BELOW_100}|${alt(Object.keys(EN_ORDINALS))})`;
const NUMBER = new RegExp(`\\d+(?:\\.\\d+)?|[零〇一二两俩三四五六七八九十百千]+(?:点[零〇一二三四五六七八九]+)?|\\b${EN_NUMBER}\\b`, "g");
/** Fixed phrases whose 一 is not a quantity: 最后一组, 每一组, 一共… (第一组 and 十一下 still count). */
const NOT_A_NUMBER = /(最后|每|这|那|上|下|同)一(?=组|次|个|下)|(?<![零〇一二两俩三四五六七八九十百千点])一(共|起|直)/g;

/**
 * Every number a sentence states, in order: digits, Chinese numerals, English words
 * and ordinals. `ignore` removes names first (三头肌下压 and one-arm row are not numbers).
 */
export function numbersIn(text: string, ignore: string[] = []): number[] {
  let t = text.normalize("NFKC").toLowerCase();
  for (const name of [...ignore].sort((a, b) => b.length - a.length)) t = t.split(name.normalize("NFKC").toLowerCase()).join(" ");
  // 千克 is a unit, not a thousand.
  return [...t.replace(/千克/g, " kg").replace(NOT_A_NUMBER, " ").matchAll(NUMBER)].map(([m]) =>
    /\d/.test(m) ? Number(m) : /^[a-z]/.test(m) ? englishNumber(m) : chineseNumber(m));
}
/** Weight units a sentence states. 斤 (half a kilogram) is reported separately so it is never read as kg. */
export function unitsIn(text: string): Set<LabelUnit | "jin"> {
  const t = text.normalize("NFKC").toLowerCase(), units = new Set<LabelUnit | "jin">();
  // Letters around an abbreviation end it; digits do not, so 60kg5个 still reads as kg.
  if (/(?<![a-z])(?:kgs?|kilo(?:gram)?s?)(?![a-z])|公斤|千克/.test(t)) units.add("kg");
  if (/(?<![a-z])(?:lbs?|pounds?)(?![a-z])|磅/.test(t)) units.add("lb");
  if (/(?<!公)斤/.test(t)) units.add("jin");
  return units;
}

/**
 * The deterministic check a label must pass against its sentence: every number
 * the label claims appears in the sentence, the sentence states no number the
 * label cannot account for, and the units match. Clarify labels are exempt
 * because they make no claim. `exerciseNames` are the session's names and aliases.
 * Returns the problems found; empty means consistent.
 */
export function labelTextProblems(text: string, label: ParseLabel, exerciseNames: string[] = []): string[] {
  if (label.intent === "clarify") return [];
  const required = new Set<number>(), allowed = new Set<number>(), units = new Set<LabelUnit>();
  const need = (n: number | null | undefined) => { if (n !== null && n !== undefined) { required.add(n); allowed.add(n); } };
  if (label.intent === "record") {
    for (const s of label.sets) { need(s.weight); need(s.reps); need(s.rpe); if (s.unit) units.add(s.unit); }
    allowed.add(label.sets.length); // "3组5个" / "5x5" state the set count.
  } else if (label.intent === "repeat") { if (label.count > 1) need(label.count); allowed.add(1); }
  else if (label.intent === "correct") {
    if (label.target !== "last") need(label.target);
    need(label.changes.weight); need(label.changes.reps); need(label.changes.rpe);
    if (label.changes.unit) units.add(label.changes.unit);
  } else if (label.intent === "skip" && typeof label.target === "number") need(label.target);
  const found = numbersIn(text, exerciseNames), stated = new Set(found), problems: string[] = [];
  for (const n of required) if (!stated.has(n)) problems.push(`missing:${n}`);
  for (const n of found) if (!allowed.has(n)) problems.push(`extra:${n}`);
  const said = unitsIn(text);
  for (const u of said) if (!units.has(u as LabelUnit)) problems.push(`unit:${u}`);
  for (const u of units) if (!said.has(u)) problems.push(`missing_unit:${u}`);
  return [...new Set(problems)];
}
