import type { Item } from "./synth";

/**
 * The parser's input and output format, shared by the cloud baseline and the
 * on-device fine-tune so both are measured on exactly the same task. The model
 * sees the session's exercise names and the sentence, never plan targets.
 */
export const PROMPT_VERSION = 1;
export const SYSTEM_PROMPT = `You turn one gym log sentence into JSON. Reply with one JSON object only.
Shapes:
{"intent":"record","exercise":E,"sets":[{"weight":W,"unit":U,"reps":R,"rpe":P}]}
{"intent":"repeat","exercise":E,"count":N}
{"intent":"correct","exercise":E,"target":T,"changes":{only the changed fields of weight, unit, reps, rpe}}
{"intent":"skip","exercise":E,"target":T}
{"intent":"end"}
{"intent":"clarify","reason":C}
Rules:
- Use only values the sentence states. Unknown is null. Never fill in plan targets or guesses.
- E is an exercise name copied exactly from the list, or null when the sentence names none.
- W and U come together; U is "kg" (kg, 公斤, 千克, kilos) or "lb" (lb, 磅, pounds). RPE goes in 0.5 steps.
- T is a set number or "last"; a skip may also use "next".
- Clarify when quantities are uncertain (uncertain_quantity), planned rather than done (plan_not_actual), negated or failed (negation), a question (question), reps are missing (missing_reps), a weight has no unit (missing_unit), the unit is 斤 (unsupported_unit), one RPE covers several sets without saying which (rpe_scope), the exercise is not in the list (unknown_exercise), or a value is impossible (out_of_range).`;
/**
 * The fine-tuned model learns the format from data and receives one short line
 * instead of the full instructions. Fewer prompt tokens do not establish a phone
 * first-token latency improvement; that requires a native-device measurement.
 */
export const SFT_SYSTEM_PROMPT = "Parse the gym log sentence into LiftCut label v1 JSON.";
export const userMessage = (item: Pick<Item, "text" | "context">) => JSON.stringify({ exercises: item.context.exercises, sentence: item.text });
/** The training target: the label exactly as stored, so key order is stable. */
export const assistantMessage = (item: Pick<Item, "label">) => JSON.stringify(item.label);
