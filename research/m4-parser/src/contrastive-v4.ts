import { CLARIFY_REASONS, type ParseLabel } from "@liftcut/core/parse-label";
import { V2_SYSTEM } from "./contrastive-data";
import type { Item } from "./synth";

export const V4_TARGETS = ["missing_unit", "rpe_scope", "unknown_exercise"] as const;
// Evaluation-only factor. SFT keeps V2_SYSTEM unchanged, isolating data from prompt effects.
export const V4_ENUM_SYSTEM = `${V2_SYSTEM} For intent clarify, reason must be exactly one of: ${CLARIFY_REASONS.join(", ")}. No other reason value is valid.`;

/** Re-render only three v3 families from sampled labels, never from evaluator
 * failures, private utterances, teacher output or a parser's guessed answer. */
export function boundaryPair(source: Item, index: number): [Item, Item] {
  const reason = V4_TARGETS.find(r => source.family === `contrast_${r}_positive`);
  if (!reason || !["record", "correct"].includes(source.label.intent)) throw new Error("Not a v4 boundary pair");
  const zh = source.language === "zh", label = source.label;
  if (label.intent !== "record" && label.intent !== "correct") throw new Error("Unexpected source intent");
  const original = label.intent === "record" ? label.sets[0] : label.changes;
  const weight = original.weight ?? 17.5 + index * 1.25, unit = original.unit ?? (index % 2 ? "lb" : "kg");
  const reps = original.reps ?? 5 + index % 11, frame = Math.floor(index / 2) % 3;
  let name = label.exercise!, truth: ParseLabel = structuredClone(label), positive: string, negative: string;
  let variant: string;
  const render = (exercise: string, load: string, quantity: string) => zh
    ? [ `${exercise}的已做记录：${load}；${quantity}`, `完成情况：${quantity}；${exercise}，负重${load}`, `${load}用于${exercise}；实际完成${quantity}` ][frame]
    : [ `completed log for ${exercise}: ${load}; ${quantity}`, `finished ${quantity}; ${exercise}, load ${load}`, `${load} on ${exercise}; completed ${quantity}` ][frame];
  if (reason === "missing_unit") {
    const patch = label.intent === "correct", explicit = index % 2 === 1;
    const target = patch ? label.target : null;
    const utterance = (load: string) => patch ? (zh ? `${name}第${target}组：重量栏应改为${load}` : `${name} set ${target}: replace the load entry with ${load}`)
      : render(name, load, zh ? `${reps}次` : `${reps} reps`);
    truth = patch ? { intent: "correct", exercise: name, target: label.target, changes: { weight, unit } }
      : { intent: "record", exercise: name, sets: [{ weight, unit, reps, rpe: null }] };
    positive = utterance(`${weight}${unit}`); negative = utterance(String(weight));
    if (explicit) negative += zh ? "；单位暂未注明" : "; unit not specified";
    variant = `${patch ? "patch" : "record"}.${explicit ? "explicit" : "implicit"}`;
  } else if (reason === "rpe_scope") {
    if (label.intent !== "record" || label.sets.length < 2) throw new Error("Scope needs multiple sets");
    const count = label.sets.length, rpe = label.sets.find(s => s.rpe !== null)!.rpe!, last = index % 2 === 1;
    truth = { intent: "record", exercise: name, sets: label.sets.map((s, i) => ({ ...s, rpe: !last || i === count - 1 ? rpe : null })) };
    const load = original.weight === null ? (zh ? "自重" : "bodyweight") : `${weight}${unit}`;
    const stem = render(name, load, zh ? `${count}组，每组${reps}次` : `${count} sets, ${reps} reps per set`);
    const scoped = zh ? `${last ? "最后一组" : "每组"}RPE${rpe}` : `${last ? "last set" : "each set"} RPE ${rpe}`;
    // Both ambiguous and explicit scope occur before/after/inside the report.
    const join = zh ? "；" : "; ";
    const place = (scope: string) => frame === 0 ? `${scope}${join}${stem}` : frame === 1 ? `${stem}${join}${scope}`
      : render(name, `${load}${join}${scope}`, zh ? `${count}组，每组${reps}次` : `${count} sets, ${reps} reps per set`);
    positive = place(scoped); negative = place(`RPE ${rpe}`); variant = `${last ? "last" : "each"}.position-${frame}`;
  } else {
    const mode = index % 3;
    if (mode === 1) name = source.context.exercises[index % 2]; // Two bench variants in this catalog.
    const load = mode === 1 || original.weight !== null ? `${weight}${unit}` : zh ? "自重" : "bodyweight";
    truth = { intent: "record", exercise: name, sets: [{ weight: mode === 1 ? weight : original.weight ?? null,
      unit: mode === 1 ? unit : original.unit ?? null, reps, rpe: null }] };
    const missing = mode === 0 ? (zh ? ["坐姿腿屈伸", "器械提踵", "绳索面拉", "髋外展"][Math.floor(index / 3) % 4]
      : ["Leg extension", "Calf raise", "Cable face pull", "Hip abduction"][Math.floor(index / 3) % 4])
      : mode === 1 ? (zh ? "卧推" : "bench press") : (zh ? "目录未收录的动作" : "an exercise absent from the catalog");
    positive = render(name, load, zh ? `${reps}次` : `${reps} reps`);
    negative = render(missing, load, zh ? `${reps}次` : `${reps} reps`);
    variant = ["absent-name", "ambiguous-name", "explicit-absence"][mode];
  }
  return ([["positive", positive, truth], ["negative", negative, { intent: "clarify", reason }]] as const).map(([polarity, text, target]) => ({
    ...source, id: source.id.replace("v3-", "v4-").replace(/-positive$/, `-${polarity}`), text, label: target,
    family: `contrast_${reason}_${polarity}`, template: `v4.${reason}.${variant}.frame-${frame}.${source.language}.${polarity}`,
  })) as [Item, Item];
}
