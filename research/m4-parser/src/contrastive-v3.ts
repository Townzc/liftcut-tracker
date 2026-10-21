import type { ParseLabel } from "@liftcut/core/parse-label";
import { random, normalizeText, type Item } from "./synth";

// Pools are assigned before values are sampled. Both positions of a qualifier
// are learned; dev uses a separate sentence frame, never a renamed train row.
export const V3_POOLS = { train: { seed: 202610211, pairs: 1200, frames: ["load-first", "reps-first-notes"] },
  dev: { seed: 202610212, pairs: 120, frames: ["reps-first-exercise-last"] } } as const;
const reasons = ["missing_unit", "missing_reps", "plan_not_actual", "negation", "uncertain_quantity", "question",
  "rpe_scope", "unknown_exercise", "unsupported_unit", "out_of_range"] as const;
const names = ["杠铃卧推", "哑铃卧推", "引体向上", "俯卧撑"];
const english = ["Barbell bench press", "Dumbbell bench press", "Pull-up", "Push-up"];

export function contrastiveV3(split: keyof typeof V3_POOLS, excluded: Set<string>): Item[] {
  const pool = V3_POOLS[split], rng = random(pool.seed), rows: Item[] = [];
  for (let pair = 0, attempts = 0; pair < pool.pairs; attempts++) {
    if (attempts > pool.pairs * 50) throw new Error("V3 uniqueness exhausted");
    const zh = rng.chance(0.5), at = rng.int(0, 3), available = zh ? names : english, name = available[at];
    const weight = rng.int(1, 80) * 2.5, reps = rng.int(2, 18), rpe = rng.pick([6, 7, 8, 9, 9.5]);
    const unit = rng.pick(["kg", "lb"] as const), bodyweight = at >= 2, reason = reasons[pair % reasons.length];
    const count = reason === "rpe_scope" ? rng.int(2, 4) : 1, last = rng.chance(0.5);
    const load = bodyweight ? (zh ? "自重" : "bodyweight") : `${weight}${unit}`;
    const quantity = count > 1 ? (zh ? `${count}组，每组${reps}次` : `${count} sets of ${reps} reps`) : (zh ? `${reps}次` : `${reps} reps`);
    const frame = pool.frames[Math.floor(pair / 20) % pool.frames.length];
    let positive = frame === "load-first" ? (zh ? `记下刚完成的${name}：${load}，${quantity}` : `log the completed ${name}: ${load}, ${quantity}`)
      : frame === "reps-first-notes" ? (zh ? `刚才的${quantity}用的是${load}，请记在${name}` : `those ${quantity} were at ${load}; log them under ${name}`)
        : (zh ? `已经做完${quantity}，${load}，动作是${name}` : `completed ${quantity} with ${load} on ${name}`);
    const scope = zh ? (last ? "最后一组" : "每组") : (last ? "last set " : "each set ");
    if (count > 1) positive += `${zh ? "，" : ", "}${scope}RPE${rpe}`;
    let label: ParseLabel = { intent: "record", exercise: name, sets: Array.from({ length: count }, (_, i) =>
      ({ weight: bodyweight ? null : weight, unit: bodyweight ? null : unit, reps,
        rpe: count > 1 && (!last || i === count - 1) ? rpe : null })) };
    // Missing units also matter in PATCH requests, not just new set records.
    const patch = reason === "missing_unit" && Math.floor(pair / reasons.length) % 3 === 0;
    const target = patch ? rng.int(1, 4) : null;
    if (target !== null) {
      label = { intent: "correct", exercise: name, target, changes: { weight, unit } };
      positive = split === "train" ? (zh ? `把${name}第${target}组的重量更正为${weight}${unit}` : `correct ${name} set ${target} load to ${weight}${unit}`)
        : (zh ? `${name}那组用重记错了，第${target}组实际是${weight}${unit}` : `${name} had a load entry error: set ${target} actually used ${weight}${unit}`);
    }
    const qualifiers = { plan_not_actual: zh ? ["这只是计划：", "，仅为设想，还没有做"] : ["only a plan: ", ", hypothetical; not performed"],
      negation: zh ? ["没有实际完成：", "，实际上没有完成"] : ["not actually completed: ", ", not actually completed"],
      uncertain_quantity: zh ? ["这些数记不准：", "，这些数我不确定"] : ["unsure of these numbers: ", ", uncertain numbers"],
      question: zh ? ["请问这样合适吗：", "，这样安排合适吗？"] : ["is this suitable: ", ", would this be suitable?"] };
    let negative: string;
    switch (reason) {
      case "missing_unit": negative = patch ? positive.replace(`${weight}${unit}`, `${weight}${zh ? "，单位尚未提供" : ", unit not supplied"}`)
        : `${name}: ${weight}, ${reps}${zh ? "次，重量单位忘了" : " reps, weight unit unknown"}`; break;
      case "missing_reps": negative = `${name}: ${weight}${unit}${zh ? "，次数没记" : ", rep count missing"}`; break;
      case "plan_not_actual": case "negation": case "uncertain_quantity": case "question": {
        const [before, after] = qualifiers[reason];
        negative = split === "train" && Math.floor(pair / reasons.length) % 2 === 0 ? before + positive : positive + after; break;
      }
      case "rpe_scope": negative = positive.replace(`${scope}RPE`, "RPE"); break;
      case "unknown_exercise": negative = positive.replace(name, zh ? "列表以外的动作" : "an exercise outside the list"); break;
      case "unsupported_unit": negative = `${name}: ${weight}斤 ${reps}${zh ? "次" : " reps"}`; break;
      case "out_of_range": negative = `${name}: ${weight}${unit} ${reps + 200}${zh ? "次" : " reps"}`; break;
    }
    // Fields-only negatives also get distinct whole-sentence frames across splits.
    if (["missing_unit", "missing_reps", "unsupported_unit", "out_of_range"].includes(reason))
      negative = split === "train" ? (zh ? "我记的是 " : "my note: ") + negative : negative + (zh ? "，这是刚才那组" : ", that was the previous set");
    if ([positive, negative].some(text => excluded.has(normalizeText(text)))) continue;
    for (const [polarity, text, truth] of [["positive", positive, label], ["negative", negative, { intent: "clarify", reason }]] as const) {
      excluded.add(normalizeText(text));
      rows.push({ id: `v3-${split}-${pair}-${polarity}`, split, family: `contrast_${reason}_${polarity}`, language: zh ? "zh" : "en",
        template: `v3.${frame}.${zh ? "zh" : "en"}.${reason}.${patch ? "patch" : "record"}.${polarity}`, text,
        context: { exercises: [...available], selected: available[(at + 1) % available.length], done: target ?? 0, setCount: 5 }, label: truth });
    }
    pair++;
  }
  return rows;
}
