import { exerciseCatalog } from "@liftcut/core/exercise-catalog";
import { labelTextProblems, parseLabelSchema, type LabelUnit, type ParseLabel } from "@liftcut/core/parse-label";

/**
 * Synthetic sentence data for the M4 parser. Labels are sampled first; sentences
 * are rendered from templates for that label, so no model or parser ever labels
 * a sentence. Every item must pass the label schema and the deterministic
 * sentence/label check, or the build fails.
 */
export type Split = "train" | "dev" | "test";
export type Language = "zh" | "en" | "mixed";
/** `done` sets are already saved and `setCount` are planned for every exercise: enough state to resolve "last" or "next". */
export type Context = { exercises: string[]; selected: string | null; done: number; setCount: number };
export type Item = { id: string; split: Split; family: string; template: string; language: Language; text: string; context: Context; label: ParseLabel };

/** mulberry32: small, seedable and identical on every platform. */
export function random(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)], chance: (p: number) => next() < p };
}
type Rng = ReturnType<typeof random>;

const ZH_DIGITS = "零一二三四五六七八九";
/** Spoken Chinese: 六十二点五, 一百零五, and the colloquial 一百二 for 120. */
export function zhNumber(n: number, rng: Rng): string {
  if (!Number.isInteger(n)) { const [i, f] = String(n).split("."); return `${zhNumber(Number(i), rng)}点${[...f].map(d => ZH_DIGITS[Number(d)]).join("")}`; }
  if (n < 10) return ZH_DIGITS[n];
  if (n < 20) return `十${n % 10 ? ZH_DIGITS[n % 10] : ""}`;
  if (n < 100) return `${ZH_DIGITS[Math.floor(n / 10)]}十${n % 10 ? ZH_DIGITS[n % 10] : ""}`;
  if (n >= 1000) {
    const k = Math.floor(n / 1000), rest = n % 1000, head = `${k === 2 && rng.chance(0.5) ? "两" : ZH_DIGITS[k]}千`;
    return rest === 0 ? head : `${head}${rest < 100 ? "零" : ""}${zhNumber(rest, rng)}`;
  }
  const head = `${n >= 200 && n < 300 && rng.chance(0.5) ? "两" : ZH_DIGITS[Math.floor(n / 100)]}百`, rest = n % 100;
  if (!rest) return head;
  if (rest < 10) return `${head}零${ZH_DIGITS[rest]}`;
  if (rest % 10 === 0 && rng.chance(0.5)) return head + ZH_DIGITS[rest / 10];
  return head + (rest < 20 ? `一${zhNumber(rest, rng)}` : zhNumber(rest, rng));
}
const EN_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
export const enNumber = (n: number) => n < 20 ? EN_WORDS[n] : `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? `-${EN_WORDS[n % 10]}` : ""}`;

// Template placeholders: {ex} exercise mention (may be empty), {ex!} required mention, {w} weight, {u} unit,
// {r} reps, {rs} reps list, {n} set count, {t} set number, {rpe} RPE, {tail} RPE phrase chosen by scope.
type Template = { id: string; family: string; language: "zh" | "en"; text: string; heldOut?: true };
const T = (family: string, language: "zh" | "en", texts: string[], heldOut: number[] = []): Template[] =>
  texts.map((text, i) => ({ id: `${language}.${family}.${i}`, family, language, text, ...(heldOut.includes(i) ? { heldOut: true as const } : {}) }));
export const templates: Template[] = [
  ...T("record_weighted", "zh", ["{ex} {w}{u} {r}个{tail}", "{ex}{w}{u}做了{r}次{tail}", "记录{ex} {w}{u} x {r}{tail}", "{ex} {w}{u}，{r}下{tail}",
    "刚做完{ex!}，{w}{u}{r}个{tail}", "{ex}这组{w}{u}推了{r}个{tail}"], [5]),
  ...T("record_weighted", "en", ["{ex} {w}{u} {r} reps{tail}", "{ex} {w} {u} x {r}{tail}", "did {r} reps of {ex!} at {w}{u}{tail}", "log {ex} {w}{u} for {r}{tail}",
    "{ex} {r} reps with {w}{u}{tail}"], [4]),
  ...T("record_bodyweight", "zh", ["{ex} {r}个{tail}", "{ex}自重{r}次{tail}", "记录{ex} {r}下{tail}", "{ex!}做了{r}个，自重{tail}"], [3]),
  ...T("record_bodyweight", "en", ["{ex} {r} reps{tail}", "{ex} bodyweight x {r}{tail}", "just did {r} {ex!}{tail}"], [2]),
  ...T("record_list", "zh", ["{ex} {w}{u} {rs}{tail}", "{ex}{w}{u}，分别{rs}个{tail}", "{ex} {w}{u}做了几组：{rs}{tail}"], [2]),
  ...T("record_list", "en", ["{ex} {w}{u} {rs}{tail}", "{ex} {w}{u}, sets of {rs}{tail}", "{ex!} at {w}{u}: {rs} reps{tail}"], [2]),
  ...T("record_uniform", "zh", ["{ex} {w}{u} {n}组每组{r}个{tail}", "{ex} {w}{u} {n}x{r}{tail}", "{ex}{n}组{r}次 {w}{u}{tail}"], [2]),
  ...T("record_uniform", "en", ["{ex} {w}{u} {n}x{r}{tail}", "{ex} {n} sets of {r} at {w}{u}{tail}", "{ex!} {w}{u}, {n} sets, {r} reps each{tail}"], [2]),
  ...T("record_pyramid", "zh", ["{ex} {pyramid}", "{ex}递增：{pyramid}"], [1]),
  ...T("record_pyramid", "en", ["{ex} {pyramid}", "{ex!} ramping up: {pyramid}"], [1]),
  ...T("repeat", "zh", ["同上", "{ex}同上", "和上一组一样", "同上，再来{n}组", "{ex}重复上一组", "{ex}跟上一组一样", "再来{n}组，同上", "{ex}再来{n}组一样的"], [7]),
  ...T("repeat", "en", ["same again", "same as last set", "{ex} same as before", "{n} more sets, same as before", "{ex} repeat that set", "{n} more just like that"], [5]),
  ...T("correct_reps", "zh", ["更正：第{t}组其实是{r}个", "刚才第{t}组记错了，是{r}次", "最后一组改成{r}个", "{ex}第{t}组应该是{r}下"], [3]),
  ...T("correct_reps", "en", ["correction: set {t} was {r} reps", "change the last set to {r} reps", "{ex} set {t} was actually {r}"], [2]),
  ...T("correct_weight", "zh", ["第{t}组重量其实是{w}{u}", "最后一组重量改成{w}{u}", "更正{ex}第{t}组是{w}{u}"], [2]),
  ...T("correct_weight", "en", ["set {t} was actually {w}{u}", "fix the last set, it was {w}{u}", "{ex} set {t} weight should be {w}{u}"], [2]),
  ...T("correct_rpe", "zh", ["第{t}组 RPE 其实是 {rpe}", "最后一组 RPE 改成 {rpe}"], [1]),
  ...T("correct_rpe", "en", ["set {t} rpe was {rpe}", "make the last set rpe {rpe}"], [1]),
  ...T("skip", "zh", ["跳过第{t}组", "{ex}第{t}组不做了", "下一组跳过", "最后一组跳过", "{ex}第{t}组先跳过", "{ex}最后一组不练了", "{ex}跳过下一组"], [6]),
  ...T("skip", "en", ["skip set {t}", "skip the next set", "skip the last set", "{ex} skip set {t}", "drop the last set of {ex!}", "skipping set {t} of {ex!}"], [5]),
  ...T("end", "zh", ["今天练完啦", "今天就到这", "结束今天的训练", "收工，今天练完了", "训练完成", "不练了，结束", "就练到这里", "今天的训练结束"], [7]),
  ...T("end", "en", ["done for today", "finish the workout", "that's it for today", "end the session", "all done", "workout complete", "wrapping up the session"], [6]),
  ...T("clarify_uncertain_quantity", "zh", ["{ex} 大概{w}{u}做了{r}个", "{ex}{r}个左右", "{ex}做了好多个", "{ex} 差不多{w}{u}"], [3]),
  ...T("clarify_uncertain_quantity", "en", ["{ex} about {w}{u} for {r}ish", "{ex} maybe {r} reps", "{ex} a bunch of reps"], [2]),
  ...T("clarify_plan_not_actual", "zh", ["待会儿{ex}{w}{u}{r}个", "计划{ex} {n}组{r}个", "下次{ex}试试{w}{u}"], [2]),
  ...T("clarify_plan_not_actual", "en", ["planning {ex} {w}{u} for {r} next", "going to do {n} sets of {r} on {ex!}"], [1]),
  ...T("clarify_question", "zh", ["{ex}{w}{u}能做几个？", "下一组加到{w}{u}吗？", "{ex}要做几组？"], [2]),
  ...T("clarify_question", "en", ["should I go {w}{u} next set?", "how many reps of {ex!} today?"], [1]),
  ...T("clarify_negation", "zh", ["{ex}没做完", "{ex} {w}{u}没推起来", "{ex}今天没练"], [2]),
  ...T("clarify_negation", "en", ["didn't finish {ex!}", "{ex} {w}{u} failed, no reps"], [1]),
  ...T("clarify_missing_reps", "zh", ["{ex} {w}{u}", "{ex}做了{w}{u}"], [1]),
  ...T("clarify_missing_reps", "en", ["{ex} {w}{u}", "{ex!} at {w}{u} today"], [1]),
  ...T("clarify_missing_unit", "zh", ["{ex} {w} {r}个", "{ex}{w}，{r}次"], [1]),
  ...T("clarify_missing_unit", "en", ["{ex} {w} for {r}", "{ex} {w} x {r}"], [1]),
  ...T("clarify_unsupported_unit", "zh", ["{ex} {w}斤 {r}个", "{ex}{w}斤做了{r}次"], [1]),
  ...T("clarify_rpe_scope", "zh", ["{ex} {w}{u} {rs} RPE {rpe}", "{ex} {w}{u} {n}组每组{r}个 RPE {rpe}"], [1]),
  ...T("clarify_rpe_scope", "en", ["{ex} {w}{u} {rs} rpe {rpe}", "{ex} {n}x{r} at {w}{u} rpe {rpe}"], [1]),
  ...T("clarify_unknown_exercise", "zh", ["{ex!} {w}{u} {r}个", "{ex!}做了{r}次"], [1]),
  ...T("clarify_unknown_exercise", "en", ["{ex!} {w}{u} {r} reps", "{ex!} {r} reps"], [1]),
  ...T("clarify_out_of_range", "zh", ["{ex} {w}{u} {r}个", "{ex} {w}{u} {r}个，RPE {rpe}"], [1]),
  ...T("clarify_out_of_range", "en", ["{ex} {w}{u} {r} reps", "{ex} {w}{u} x {r} rpe {rpe}"], [1]),
];
/** Share of each family in every split; record and clarify dominate like real gym use. */
export const familyWeights: Record<string, number> = {
  record_weighted: 16, record_bodyweight: 6, record_list: 10, record_uniform: 8, record_pyramid: 4, repeat: 4,
  correct_reps: 6, correct_weight: 3, correct_rpe: 2, skip: 6, end: 4,
  clarify_uncertain_quantity: 4, clarify_plan_not_actual: 3, clarify_question: 3, clarify_negation: 3, clarify_missing_reps: 3,
  clarify_missing_unit: 3, clarify_unsupported_unit: 2, clarify_rpe_scope: 3, clarify_unknown_exercise: 3, clarify_out_of_range: 3,
};

const hasHan = (s: string) => /[一-鿿]/.test(s);
const surfaces = exerciseCatalog.map(e => ({ e, zh: [e.zh, ...e.aliases.filter(hasHan)], en: [e.en, e.en.toLowerCase(), ...e.aliases.filter(a => !hasHan(a))] }));
/** Every catalog name and alias: removed before numbers are read, so 单臂 or one-arm in a name is never a number. */
export const exerciseNames = [...new Set(surfaces.flatMap(s => [...s.zh, ...s.en]))];
const UNITS = { zh: { kg: ["公斤", "kg", "千克"], lb: ["磅", "lb", "lbs"] }, en: { kg: ["kg", "kgs", " kilos"], lb: ["lb", "lbs", " pounds"] } };
const RPES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

function render(template: Template, rng: Rng, label: ParseLabel, v: { mention: string; w?: number; unit?: LabelUnit; r?: number; rs?: number[];
  n?: number; t?: number; rpe?: number; tail?: string; pyramid?: { w: number; r: number }[] }) {
  // Digits only where spelled-out numbers would blur the sentence: "5x5", or 九十 九个 without a unit.
  const zh = template.language === "zh", plain = /x\{|\} x/.test(template.text) || template.family === "clarify_missing_unit";
  const spoken = !plain && rng.chance(zh ? 0.3 : 0.15);
  const num = (n: number) => !spoken ? String(n) : zh ? (n === 2 ? "两" : zhNumber(n, rng)) : Number.isInteger(n) && n < 100 ? enNumber(n) : String(n);
  // A spelled-out number always needs a space before its unit (sixty kg, not sixtykg).
  const unit = (u: LabelUnit) => `${spoken && !zh || rng.chance(0.3) ? " " : ""}${rng.pick(UNITS[template.language][u])}`.replace(/^ +/, m => m.slice(0, 1));
  const sep = zh ? rng.pick(["、", ",", "/"]) : rng.pick([", ", "/"]);
  const piece = (p: { w: number; r: number }) => zh ? `${num(p.w)}${unit(v.unit!)}${num(p.r)}个` : `${num(p.w)}${unit(v.unit!)} x ${num(p.r)}`;
  const ex = /[a-z]$/i.test(v.mention) ? `${v.mention} ` : v.mention; // Dumbbell curl 20kg, not curl20kg.
  const values: Record<string, string> = { ex, "ex!": ex, w: v.w === undefined ? "" : num(v.w), u: v.unit ? unit(v.unit) : "",
    r: v.r === undefined ? "" : num(v.r), rs: (v.rs ?? []).map(num).join(sep), n: v.n === undefined ? "" : num(v.n), t: v.t === undefined ? "" : num(v.t),
    rpe: v.rpe === undefined ? "" : String(v.rpe), tail: v.tail ?? "", pyramid: (v.pyramid ?? []).map(piece).join(zh ? "，" : rng.pick([", ", ", then "])) };
  // Spoken fillers vary the surface without changing what was said.
  const filler = rng.pick(zh ? ["", "", "", "嗯，", "好，", "那个，", "OK，"] : ["", "", "", "ok ", "alright, ", "so "]);
  return (filler + template.text).replace(/\{(ex!|[a-z]+)\}/g, (_, key: string) => values[key])
    .replace(/\s+/g, " ").replace(/\s*([，：、])\s*/g, "$1").replace(/^[\s，,]+/, "").trim();
}
function tail(rng: Rng, zh: boolean, scope: "none" | "one" | "last" | "each", rpe: number) {
  if (scope === "none") return "";
  if (scope === "one") return zh ? rng.pick([`，RPE ${rpe}`, ` RPE${rpe}`, `，rpe ${rpe}`]) : rng.pick([`, rpe ${rpe}`, ` @ rpe ${rpe}`]);
  if (scope === "last") return zh ? rng.pick([`，最后一组 RPE ${rpe}`, `，最后一组RPE${rpe}`]) : rng.pick([`, last set rpe ${rpe}`, `, last set at rpe ${rpe}`]);
  return zh ? rng.pick([`，每组 RPE ${rpe}`, `，每组都是RPE ${rpe}`]) : rng.pick([`, rpe ${rpe} each set`, `, all at rpe ${rpe}`]);
}

/** One item: context, then the label, then a sentence for that label from the chosen template. */
function sample(template: Template, rng: Rng): Omit<Item, "id" | "split"> {
  const zh = template.language === "zh", family = template.family, text = template.text;
  const count = rng.int(2, 4), pool = [...surfaces];
  // Bodyweight sentences name a bodyweight movement; every other family may state a load, so it names a loaded one.
  const bodyweight = family === "record_bodyweight";
  const loadable = (s: typeof surfaces[number]) => s.e.equipment.some(g => !["bands", "band_anchor", "pullup_bar", "bench", "incline_bench"].includes(g));
  const chosen: typeof surfaces = [rng.pick(pool.filter(s => loadable(s) !== bodyweight))];
  while (chosen.length < count) { const s = rng.pick(pool); if (!chosen.includes(s)) chosen.push(s); }
  const english = rng.chance(0.25), name = (s: typeof surfaces[number]) => english ? s.e.en : s.e.zh;
  const target = chosen[0], others = chosen.slice(1).sort(() => rng.next() - 0.5);
  const exercises = [target, ...others].map(name).sort(() => rng.next() - 0.5);
  // A template that cannot name the exercise ("同上") relies on the exercise selected in the app.
  const selected = !text.includes("{ex") || rng.chance(0.75) ? name(target) : null;
  const unknown = family === "clarify_unknown_exercise" ? rng.pick(pool.filter(s => !chosen.includes(s))) : null;
  const mustMention = text.includes("{ex!}") || !selected, mention = text.includes("{ex") && (mustMention || rng.chance(0.5));
  // A surface form no other session exercise also contains, so the reference is never ambiguous.
  const said = unknown ?? target, mixed = rng.chance(zh ? 0.2 : 0.15), forms = (zh !== mixed ? said.zh : said.en)
    .filter(f => !chosen.some(o => o !== said && [...o.zh, ...o.en].some(n => n.includes(f) || f.includes(n))));
  const surface = mention ? rng.pick(forms.length ? forms : [zh !== mixed ? said.e.zh : said.e.en]) : "";
  const exercise = mention && !unknown ? name(target) : null;
  const unit: LabelUnit = rng.chance(0.75) ? "kg" : "lb";
  // Plausible loads by equipment: barbells and plate machines are heavy, dumbbells and kettlebells light.
  const gear = target.e.equipment, heavy = gear.some(g => ["barbell", "smith", "leg_press"].includes(g)), light = gear.some(g => ["dumbbells", "kettlebell"].includes(g));
  const weight = () => unit === "kg" ? (heavy ? rng.int(8, 100) * 2.5 : light ? rng.int(1, 25) * 2 : rng.int(2, 36) * 2.5)
    : (heavy ? rng.int(9, 100) * 5 : light ? rng.int(1, 20) * 5 : rng.int(2, 40) * 5);
  const w = weight(), r = rng.int(1, 20), rpe = rng.pick(RPES), n = rng.int(2, 5);
  const target_ = /最后|last/.test(text) ? "last" as const : /下一组|next/.test(text) ? "next" as const : rng.int(1, 5);
  const v: Parameters<typeof render>[3] = { mention: surface, w, unit, r, n, rpe, t: typeof target_ === "number" ? target_ : undefined };
  let label: ParseLabel;
  if (family === "record_weighted" || family === "record_bodyweight") {
    const scope = rng.pick(["none", "none", "one"] as const);
    label = { intent: "record", exercise, sets: [{ weight: bodyweight ? null : w, unit: bodyweight ? null : unit, reps: bodyweight ? rng.int(3, 30) : r, rpe: scope === "one" ? rpe : null }] };
    Object.assign(v, { r: label.sets[0].reps, tail: tail(rng, zh, scope, rpe) });
  } else if (family === "record_list" || family === "record_uniform") {
    const scope = rng.pick(["none", "none", "last", "each"] as const), base = rng.int(3, 12);
    const reps = family === "record_uniform" ? Array<number>(n).fill(base) : Array.from({ length: n }, (_, i) => Math.max(1, base - (i && rng.int(0, 2))));
    label = { intent: "record", exercise, sets: reps.map((reps, i) => ({ weight: w, unit, reps, rpe: scope === "each" || (scope === "last" && i === n - 1) ? rpe : null })) };
    Object.assign(v, { r: base, rs: reps, tail: tail(rng, zh, scope, rpe) });
  } else if (family === "record_pyramid") {
    const start = weight(), step = unit === "kg" ? rng.pick([2.5, 5, 10]) : rng.pick([10, 20]);
    const pyramid = Array.from({ length: rng.int(2, 3) }, (_, i) => ({ w: start + i * step, r: Math.max(1, rng.int(6, 12) - i * rng.int(1, 3)) }));
    label = { intent: "record", exercise, sets: pyramid.map(p => ({ weight: p.w, unit, reps: p.r, rpe: null })) };
    v.pyramid = pyramid;
  } else if (family === "repeat") label = { intent: "repeat", exercise, count: text.includes("{n}") ? n : 1 };
  else if (family.startsWith("correct_")) {
    const changes = family === "correct_reps" ? { reps: r } : family === "correct_weight" ? { weight: w, unit } : { rpe };
    label = { intent: "correct", exercise, target: target_ === "next" ? "last" : target_, changes };
  } else if (family === "skip") label = { intent: "skip", exercise, target: target_ };
  else if (family === "end") label = { intent: "end" };
  else {
    const reason = family.replace("clarify_", "") as Extract<ParseLabel, { intent: "clarify" }>["reason"];
    if (reason === "rpe_scope") Object.assign(v, { rs: Array.from({ length: n }, () => rng.int(3, 12)) });
    // The out-of-range value must be one the template actually says: RPE above 10, reps above 100, or over 1000 kg.
    if (reason === "out_of_range") Object.assign(v, text.includes("{rpe}") ? { rpe: rng.int(11, 15) }
      : rng.pick([{ r: rng.int(120, 500) }, { w: (unit === "kg" ? rng.int(12, 30) : rng.int(24, 60)) * 100 }]));
    label = { intent: "clarify", reason };
  }
  // A session state the sentence makes sense in: a corrected set exists, a skipped one does not, new sets fit.
  let done = rng.int(0, 3), need = 1;
  if (label.intent === "record") need = label.sets.length;
  if (label.intent === "repeat") { done = rng.int(1, 3); need = label.count; }
  if (label.intent === "correct") done = typeof label.target === "number" ? rng.int(label.target, Math.max(label.target, 5)) : rng.int(1, 5);
  if (label.intent === "skip" && typeof label.target === "number") done = rng.int(0, label.target - 1);
  const setCount = Math.max(done + need, label.intent === "skip" && typeof label.target === "number" ? label.target : 0, rng.int(3, 5));
  const textOut = render(template, rng, label, v);
  if (/undefined|NaN/.test(textOut)) throw new Error(`${template.id} rendered an unset value: ${textOut}`);
  return { family, template: template.id, language: mixed && mention ? "mixed" : template.language, text: textOut, context: { exercises, selected, done, setCount }, label };
}

/** Problems with an item; an empty list means it may be used. */
export function itemProblems(item: Pick<Item, "text" | "label" | "context">): string[] {
  const parsed = parseLabelSchema.safeParse(item.label);
  if (!parsed.success) return ["schema"];
  const label = parsed.data, problems = labelTextProblems(item.text, label, [...exerciseNames, ...item.context.exercises]);
  if ("exercise" in label && label.exercise !== null && !item.context.exercises.includes(label.exercise)) problems.push("exercise_not_in_context");
  return problems;
}
export const normalizeText = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s，,。.!！:：、/]+/g, " ").trim();

/**
 * A split from its own seed. Test uses only held-out templates. No split contains a
 * text in `exclude`; evaluation splits are distinct, train keeps a short fixed phrase
 * ("all done") at most three times so rare intents are not starved.
 */
export function generate(split: Split, total: number, seed: number, exclude = new Set<string>(), stats = { attempts: 0, duplicates: 0 }): Item[] {
  const rng = random(seed), families = Object.entries(familyWeights), weightSum = families.reduce((s, [, w]) => s + w, 0);
  const items: Item[] = [], seen = new Map([...exclude].map(text => [text, Infinity])), copies = split === "train" ? 3 : 1;
  for (let attempts = 0; items.length < total; attempts++) {
    if (attempts > total * 20) throw new Error(`could not generate ${total} distinct ${split} items`);
    let x = rng.next() * weightSum, family = families[0][0];
    for (const [f, w] of families) { if ((x -= w) < 0) { family = f; break; } }
    const language = rng.chance(0.6) ? "zh" : "en";
    const fit = (l: string) => templates.filter(t => t.family === family && t.language === l && Boolean(t.heldOut) === (split === "test"));
    const template = rng.pick(fit(language).length ? fit(language) : fit("zh"));
    const item = { id: `${split}-${String(items.length).padStart(5, "0")}`, split, ...sample(template, rng) };
    const key = normalizeText(item.text);
    stats.attempts++;
    if ((seen.get(key) ?? 0) >= copies) { stats.duplicates++; continue; }
    const problems = itemProblems(item);
    if (problems.length) throw new Error(`${template.id} produced an inconsistent item: ${item.text} ${JSON.stringify(item.label)} ${problems}`);
    seen.set(key, (seen.get(key) ?? 0) + 1); items.push(item);
  }
  return items;
}
