import { identifyExercise } from "./exercise-catalog";
import { samePlain } from "./plain-data";
import { parseLabelSchema, replaceSpokenNumbers, type ParseLabel } from "./parse-label";

// Versioned separately so frozen source-v1 replays remain reproducible.
// Experimental: no application write path imports this module.
export const GROUNDING_VERSION_V2 = "source-v2" as const;
type Exercise = { name: string; aliases?: readonly string[] };
type Action = Exclude<ParseLabel, { intent: "clarify" }>;
export type GroundedLabelV2 = { status: "grounded"; label: Action; version: typeof GROUNDING_VERSION_V2 }
  | { status: "clarify"; reason: "model_clarification" | "invalid_output" | "unverified_source" | "source_mismatch" };
const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[‐‑–—]/g, "-");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const N = "(\\d+(?:\\.\\d+)?)", U = "(kg|lb)", R = "(?:reps?|次|个|下)";
const match = (pattern: string, text: string) => new RegExp(`^(?:${pattern})$`).exec(text.trim());

/** Match complete aliases, longest first. A selected exercise is NOT a mention.
 * Ambiguous aliases and multiple mentions are rejected, never chosen by a model. */
function mention(text: string, exercises: readonly Exercise[]) {
  const names = new Map<string, Set<string>>();
  for (const e of exercises) {
    const catalog = identifyExercise(e.name);
    // Generic movement words belong to EVERY matching available exercise.
    // Two bench/row/press variants must ask, never pick the selected exercise.
    const generic: string[] = [];
    if (catalog?.en.endsWith("bench press") || normalize(e.name) === "bench") generic.push("bench", "benched");
    if (catalog?.zh.endsWith("深蹲") || /^(?:squat|深蹲)$/.test(normalize(e.name))) generic.push("squatted");
    for (const suffix of ["推举", "划船"]) if (catalog?.zh.endsWith(suffix)) generic.push(suffix);
    for (const raw of [e.name, ...(e.aliases ?? []), ...generic, ...(catalog ? [catalog.zh, catalog.en, ...catalog.aliases] : [])]) {
      const name = normalize(raw).trim();
      if (!name) continue;
      const targets = names.get(name) ?? new Set<string>(); targets.add(e.name); names.set(name, targets);
    }
  }
  const hits = [...names].flatMap(([name, targets]) => [...text.matchAll(new RegExp(
    `${/^[a-z]/.test(name) ? "(?<![a-z])" : ""}${escape(name)}${/[a-z]$/.test(name) ? "s?(?![a-z])" : ""}`, "g"))]
    .map(m => ({ at: m.index!, end: m.index! + m[0].length, targets })));
  const maximal = hits.filter(h => !hits.some(other => other !== h && other.at <= h.at && other.end >= h.end
    && (other.at < h.at || other.end > h.end)));
  const spans = new Map<string, typeof maximal>();
  for (const h of maximal) { const key = `${h.at}:${h.end}`; spans.set(key, [...(spans.get(key) ?? []), h]); }
  if (!spans.size) return { exercise: null, text };
  if (spans.size !== 1) return null;
  const group = [...spans.values()][0], targets = new Set(group.flatMap(h => [...h.targets]));
  if (targets.size !== 1) return null;
  return { exercise: [...targets][0], text: text.slice(0, group[0].at) + " " + text.slice(group[0].end) };
}

/** A deliberately bounded source verifier, not a general-language parser.
 * Every remaining character must fit a supported grammar. Unknown clauses,
 * plans, negations and prompt instructions therefore fail closed. No fields are
 * repaired or copied from the proposal. This does not authorize a write. */
function sourceLabel(input: string, exercises: readonly Exercise[]): Action | null {
  if (!input.trim() || input.length > 400 || exercises.length > 100) return null;
  const found = mention(normalize(input), exercises);
  if (!found) return null;
  const exercise = found.exercise;
  let text = found.text.trim().replace(/[。.!！]+$/, "").trim()
    .replace(/^(?:嗯|好|那个|ok|alright|so)[，, ]+/, "")
    .replace(/最后一组/g, "last set").replace(/下一?组/g, "next set").replace(/每一?组/g, "each set").replace(/上一组/g, "上组").replace(/一样|同样/g, "same")
    .replace(/\bthe last one\b/g, "last set");
  text = replaceSpokenNumbers(text).replace(/公斤|千克|(?<![a-z])(?:kgs?|kilos?|kilograms?)(?![a-z])/g, "kg")
    .replace(/磅|(?<![a-z])(?:lbs?|pounds?)(?![a-z])/g, "lb").replace(/[，、]/g, ",").replace(/[：]/g, ":").replace(/\s+/g, " ").trim();
  if (exercise === null && /^(?:练完了|结束训练|今天练完啦|今天就到这|今天就练到这吧|结束今天的训练|训练完成|今天的训练结束|就练到这里|收工|收工,今天练完了|不练了,结束|done for today|that's it for today|finish (?:the )?workout|end (?:the )?(?:workout|session)|all done|workout complete|i'm done, ?end the session)$/.test(text)) return { intent: "end" };

  const repeat = match(`(?:同上|和上组same|重复上组|跟上组same|跟刚才same|same again|same weight and reps again|same as (?:last set|before)|repeat that set)`, text);
  if (repeat) return { intent: "repeat", exercise, count: 1 };
  const repeated = match(`(?:(?:同上,? ?|same)再来${N}组|再来${N}组,? ?(?:同上|same的)|${N} more (?:sets,? same as before|just like that))`, text);
  if (repeated) return { intent: "repeat", exercise, count: Number(repeated[1] ?? repeated[2] ?? repeated[3]) };

  const target = `(?:第 ?${N} ?组|set ${N}|(?:the )?${N} set|(last set|next set))`;
  const targetValue = (m: RegExpExecArray) => m[4] ? m[4] === "last set" ? "last" : "next" : Number(m[1] ?? m[2] ?? m[3]);
  if (text === "跳过") return { intent: "skip", exercise, target: "next" };
  const skip = match(`(?:跳过|(?:i'll )?skip(?: the)?|skipping) ?${target}`, text) ?? match(`${target} ?(?:跳过|跳了|先跳过|不做了|不练了)`, text);
  if (skip) return { intent: "skip", exercise, target: targetValue(skip) };
  const correcting = /(?:不对|更正|改正|其实|改成|记错|应该是|\b(?:correction|correct|change|fix|make|was|actually|should be)\b)/.test(text);
  if (correcting) {
    text = text.replace(/^(?:不对|更正|改正|刚才|actually|correction|correct|change(?: the)?|fix(?: the)?|make(?: the)?)[ ,:]* */, "");
    const t = new RegExp(`^${target} *`).exec(text);
    if (!t || targetValue(t) === "next") return null;
    text = text.slice(t[0].length).replace(/^,? */, "").replace(/^(?:重量)?记错了,? */, "")
      .replace(/^(?:其实只做了|其实是?|应该是|改成|是|was actually|was|to|it was) */, "");
    const w = match(`(?:重量|weight(?: should be)?)? *(?:其实是?|改成)? *${N} *${U}(?:,? ?not ${N}(?: *${U})?)?`, text);
    if (w?.[4] && w[4] !== w[2]) return null; // Do not equate kg with lb in an old-value contrast.
    const p = match(`rpe *(?:其实是?|应该是|改成|was)? *${N}`, text);
    const r = match(`${N} *${R}(?:,? ?不是 *${N} *${R})?`, text);
    const changes = w ? { weight: Number(w[1]), unit: w[2] as "kg" | "lb" } : p ? { rpe: Number(p[1]) } : r ? { reps: Number(r[1]) } : null;
    const position = targetValue(t);
    return changes && position !== "next" ? { intent: "correct", exercise, target: position, changes } : null;
  }

  // Only these connective words are removable; everything else must be consumed.
  const bodyweight = /自重|\bbodyweight\b/.test(text);
  text = text.replace(/^今天 */, "").replace(/[, ]*感觉还(?:行|不错)$/, "")
    .replace(/[, ]*felt like (?=rpe *\d+(?:\.\d+)?$)/, " ")
    .replace(/^(?:(?:帮我)?(?:记录|记下)|刚做完|刚做了|(?:just )?did\b|log\b|record\b) */, "")
    .replace(/这组|做了|推了|自重|分别|\bbodyweight\b|(?<![a-z])(?:of|at|with|for|on the)(?![a-z])/g, " ").trim();
  let rpe: number | null = null, scope = "";
  // A trailing scope is moved intact; it cannot silently override a leading one.
  text = text.replace(new RegExp(`rpe *${N} +(last set|each set)$`), "$2 rpe $1");
  const effort = new RegExp(`[, @]*(?:(last set|each set|all) *(?:都是|是)? *)?rpe *${N}$`).exec(text);
  if (effort) { scope = effort[1] ?? ""; rpe = Number(effort[2]); text = text.slice(0, effort.index).trim(); }
  const clean = (s: string) => s.trim().replace(/^[, :]+|[, :]+$/g, "").replace(/\s+/g, " ");
  text = clean(text);
  if (bodyweight && new RegExp(`${N} *${U}`).test(text)) return null;
  // Separate weights remain paired with their own reps, in their stated order.
  const chunk = `${N} *${U} *(?:[x×*] *)?${N} *(?:${R})?`;
  if (match(`${chunk}(?:[,; ]+(?:then |然后)?${chunk})+`, text) && rpe === null) {
    const sets = [...text.matchAll(new RegExp(chunk, "g"))].map(m => ({ weight: Number(m[1]), unit: m[2] as "kg" | "lb", reps: Number(m[3]), rpe: null }));
    return { intent: "record", exercise, sets };
  }
  const weights = [...text.matchAll(new RegExp(`${N} *${U}`, "g"))];
  if (weights.length > 1 || (bodyweight && weights.length)) return null;
  const weight = weights.length ? Number(weights[0][1]) : null, unit = weights.length ? weights[0][2] as "kg" | "lb" : null;
  if (weights.length) text = clean(text.slice(0, weights[0].index) + text.slice(weights[0].index! + weights[0][0].length));
  text = text.replace(/^(?:[x×*]|sets) */, "");
  const uniform = match(`${N} *(?:组 *,? *(?:each set)?|sets? (?:of )?) *${N} *(?:${R})?`, text)
    ?? match(`${N} sets, *${N} reps each`, text)
    ?? (weight !== null ? match(`${N} *[x×*] *${N}`, text) : null);
  let reps: number[];
  if (uniform) {
    const count = Number(uniform[1]); if (!Number.isInteger(count) || count < 1 || count > 16) return null;
    reps = Array<number>(count).fill(Number(uniform[2]));
  } else {
    if (!match(`${N} *(?:${R})?(?: *[,/] *${N} *(?:${R})?)*`, text)
      && !match(`(?:${N} *${R} *)+`, text)) return null;
    if (weight === null && !bodyweight && !new RegExp(R).test(text)) return null;
    reps = [...text.matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0]));
    // "10,10次" can mean a weight missing its unit, not two bodyweight sets.
    // Without an explicit load/bodyweight, every listed value needs a reps unit.
    if (weight === null && !bodyweight && [...text.matchAll(new RegExp(R, "g"))].length !== reps.length) return null;
  }
  if (reps.length > 1 && rpe !== null && !scope) return null;
  return { intent: "record", exercise, sets: reps.map((n, i) => ({ weight, unit, reps: n,
    rpe: rpe === null || (scope === "last set" && i !== reps.length - 1) ? null : rpe })) };
}

/** Independent source-only baseline; never sees a model proposal or gold label. */
export function parseSourceLabelV2(text: string, exercises: readonly Exercise[]): Action | null {
  const parsed = parseLabelSchema.safeParse(sourceLabel(text, exercises));
  if (!parsed.success || parsed.data.intent === "clarify") return null;
  const expected = parsed.data;
  const values = expected.intent === "record" ? expected.sets : expected.intent === "correct" ? [expected.changes] : [];
  return values.some(v => v.weight != null && v.weight * (v.unit === "lb" ? 0.45359237 : 1) > 1000) ? null : expected;
}

export function groundParseLabelV2(text: string, output: unknown, exercises: readonly Exercise[]): GroundedLabelV2 {
  const candidate = parseLabelSchema.safeParse(output);
  if (!candidate.success) return { status: "clarify", reason: "invalid_output" };
  if (candidate.data.intent === "clarify") return { status: "clarify", reason: "model_clarification" };
  const expected = parseSourceLabelV2(text, exercises);
  if (!expected) return { status: "clarify", reason: "unverified_source" };
  if (!samePlain(expected, candidate.data)) return { status: "clarify", reason: "source_mismatch" };
  return { status: "grounded", label: candidate.data, version: GROUNDING_VERSION_V2 };
}
