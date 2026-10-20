import type { ParseLabel } from "@liftcut/core/parse-label";
import { random, type Item } from "./synth";

/** Labels first, text second. Paired examples differ in a missing field or
 * communicative intent, not in a teacher's guess. Old eval text is excluded by
 * the caller. Family/template IDs are kept for audit and grouped reporting. */
export const V2_SYSTEM = "Parse one gym report as LiftCut label v1 JSON. Copy only explicit values and an exercise name from the list. Unknown is null, never a plan value or guess. Missing weight unit or reps, uncertainty, plans, questions and negated/failed sets require clarify. A correction changes only stated fields; repeat carries no values. Preserve set order. RPE for multiple sets needs explicit scope. Reply with one JSON object.";
const cases = [
  { names: ["卧推", "深蹲", "Pull-up", "Push-up"], mentioned: ["卧推", "深蹲", "Pull-up", "Push-up"] },
  { names: ["Dumbbell bench press", "Barbell bench press", "Dumbbell curl", "Barbell curl"], mentioned: ["哑铃卧推", "卧推", "哑铃弯举", "杠铃弯举"] },
] as const;
const reasons = ["missing_unit", "missing_reps", "plan_not_actual", "negation", "uncertain_quantity", "question", "rpe_scope", "unknown_exercise"] as const;
export const AUGMENT = { train: { seed: 202610201, pairs: 1200 }, dev: { seed: 202610202, pairs: 120 }, test: { seed: 202610203, pairs: 120 } } as const;

export function contrastive(split: keyof typeof AUGMENT, excluded: Set<string>, normalize: (s: string) => string): Item[] {
  const { seed, pairs } = AUGMENT[split], rng = random(seed), rows: Item[] = [];
  for (let pair = 0, attempts = 0; pair < pairs; attempts++) {
    if (attempts > pairs * 50) throw new Error("contrastive uniqueness exhausted");
    const catalog = rng.pick(cases), index = rng.int(0, catalog.names.length - 1), name = catalog.names[index];
    const zh = rng.chance(0.5), surface = zh ? catalog.mentioned[index] : name;
    const weight = rng.int(1, 80) * 2.5, reps = rng.int(2, 18), rpe = rng.pick([6, 7, 8, 9, 9.5]), unit = rng.pick(["kg", "lb"] as const);
    const bodyweight = /Pull-up|Push-up/.test(name), n = rng.int(2, 3), reason = reasons[pair % reasons.length];
    const count = reason === "rpe_scope" ? n : 1;
    // Held-out format: put reps before load and combine new punctuation/scope.
    // It shares concepts, never exact templates, with training/development.
    const held = split === "test";
    const load = `${weight}${unit}`, quantity = zh ? `${reps}次` : `${reps} reps`;
    const sets = count === 1 ? quantity : zh ? `${n}组每组${quantity}` : `${n} sets of ${reps}`;
    let positive = held ? `${surface} ${sets}${bodyweight ? (zh ? "，自重" : ", bodyweight") : (zh ? `，${load}` : ` with ${load}`)}`
      : `${zh ? "记录" : "log "}${surface} ${bodyweight ? (zh ? "自重" : "bodyweight ") : load + " "}${sets}`;
    if (count > 1) positive += zh ? `，每组RPE${rpe}` : `, each set rpe ${rpe}`;
    const positiveLabel: ParseLabel = { intent: "record", exercise: name, sets: Array.from({ length: count }, () =>
      ({ weight: bodyweight ? null : weight, unit: bodyweight ? null : unit, reps, rpe: count > 1 ? rpe : null })) };
    let negative: string;
    // Missing weight is different from explicitly unweighted: negative rows use
    // a numeric load even for a bodyweight exercise and ask for its unit/reps.
    switch (reason) {
      case "missing_unit": negative = held ? `${surface} ${weight}, ${quantity}` : `${surface} ${weight} ${quantity}`; break;
      case "missing_reps": negative = held ? `${surface} 这组重量${load}` : `${surface} ${load}`; break;
      case "plan_not_actual": negative = held ? `${positive}${zh ? "，这是下周的目标" : ", this is next week's target"}` : `${zh ? "计划" : "planning "}${positive}`; break;
      case "negation": negative = held ? `${positive}${zh ? "，但这组没完成" : ", but I did not finish the set"}` : `${zh ? "没有完成" : "did not finish "}${positive}`; break;
      case "uncertain_quantity": negative = held ? `${positive}${zh ? "，记不清了" : ", I cannot remember exactly"}` : `${zh ? "大概" : "maybe "}${positive}`; break;
      case "question": negative = held ? `${positive}${zh ? "这样行吗？" : ", is that okay?"}` : `${zh ? "可以" : "should I "}${positive}?`; break;
      case "rpe_scope": negative = positive.replace(/每组RPE|each set rpe/, zh ? "RPE" : "rpe"); break;
      case "unknown_exercise": negative = positive.replace(surface, zh ? "未列出的新动作" : "an unlisted exercise"); break;
    }
    if ([positive, negative].some(text => excluded.has(normalize(text)))) continue;
    const context = { exercises: [...catalog.names], selected: catalog.names[(index + 1) % catalog.names.length], done: 0, setCount: 5 };
    for (const [polarity, text, label] of [["positive", positive, positiveLabel], ["negative", negative, { intent: "clarify", reason }]] as const) {
      excluded.add(normalize(text));
      rows.push({ id: `v2-${split}-${pair}-${polarity}`, split, family: `contrast_${reason}_${polarity}`, language: zh ? "zh" : "en",
        template: `v2.${held ? "held" : "training"}.${zh ? "zh" : "en"}.${reason}.${polarity}`, text, context, label });
    }
    pair++;
  }
  return rows;
}
