import { z } from "zod";

export const recordDate = z.iso.date();
const body = z.object({ kind: z.literal("body"), date: recordDate,
  weightKg: z.number().positive().max(500).nullable(), waistCm: z.number().positive().max(300).nullable(),
}).strict().refine(x => x.weightKg !== null || x.waistCm !== null, "Report at least one measurement");
const food = z.object({ kind: z.literal("food"), date: recordDate, foodName: z.string().trim().min(1).max(100),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  calories: z.number().min(0).max(10000).nullable(), protein: z.number().min(0).max(1000).nullable(),
}).strict();
export const preferenceKeySchema = z.enum(["goal", "schedule", "equipment", "diet", "injury", "units"]);
const exercise = z.object({kind:z.literal("exercise"),date:recordDate,exerciseName:z.string().trim().min(1).max(80),
  weightKg:z.number().min(0).max(1000).nullable(),reps:z.number().int().min(1).max(100).nullable(),
  sets:z.number().int().min(1).max(100).nullable(),rpe:z.number().min(1).max(10).nullable(),
}).strict().refine(x=>x.weightKg!==null||x.reps!==null,"Report an actual load or reps");
const preference = z.object({kind:z.literal("preference"),date:recordDate,key:preferenceKeySchema,value:z.string().trim().min(1).max(200)}).strict();
export const personalEntrySchema = z.discriminatedUnion("kind", [body, food, exercise, preference]);
export type PersonalEntry = z.infer<typeof personalEntrySchema>;
export const personalCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), id: z.uuid(), entry: personalEntrySchema,
    source: z.enum(["manual", "conversation"]), text: z.string().max(400), anchorDate: recordDate,
    modelProof:z.string().max(24000).optional() }).strict(),
  z.object({ action: z.literal("undo"), id: z.uuid(), recordId: z.uuid() }).strict(),
]);
export type PersonalCommand = z.infer<typeof personalCommandSchema>;
export type PersonalRecord = { id: string; entry: PersonalEntry; source: "manual" | "conversation";
  text: string; createdAt: string; undo: {id: string; createdAt: string} | null;
  model?:{provider:string;model:string;sourceTexts:string[];version:"coach-v1"} };

/** Only confirmed local facts cross the guest boundary. No executable commands/proofs. */
export const guestFactSchema=z.object({id:z.uuid(),entry:personalEntrySchema,source:z.enum(["manual","conversation"]),
  text:z.string().max(400),createdAt:z.iso.datetime(),undo:z.null()}).strict();
export const guestFactsSchema=z.array(guestFactSchema).max(500).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,"Duplicate fact ID");

/** Full-string grammar: no estimate, silent truncation, target-to-actual copy or partial numeric parsing. */
export function parsePersonalEntry(input: string, anchorDate: string): PersonalEntry | null {
  if (!recordDate.safeParse(anchorDate).success || input.length > 400) return null;
  let text = input.normalize("NFKC").trim().replace(/[。.!]+$/, "").trim();
  if (/[?？]|不要|别记|计划|目标|打算|如果|假设|明天|多少|什么|查看|查询|tomorrow|don't|do not|plan|goal|\b(?:if|what|how|show)\b/i.test(text)) return null;
  text = text.replace(/^(?:帮我)?(?:记下|记录|记一下|record|log)\s*[:：]?\s*/i, "");
  let date = anchorDate;
  const explicit = /^(\d{4}-\d{2}-\d{2})\s*/.exec(text);
  if (explicit) { date = explicit[1]; text = text.slice(explicit[0].length); }
  else if (/^(昨天|yesterday)\s*/i.test(text)) {
    const day = new Date(`${anchorDate}T12:00:00Z`); day.setUTCDate(day.getUTCDate() - 1); date = day.toISOString().slice(0,10);
    text = text.replace(/^(昨天|yesterday)\s*/i, "");
  } else text = text.replace(/^(今天|今日|today)\s*/i, "");
  const number = "(\\d+(?:\\.\\d+)?)";
  const weight = new RegExp(`^(?:体重|weight)\\s*${number}\\s*(?:公斤|千克|kg)(?:[ ,，]+(?:腰围|waist)\\s*${number}\\s*(?:厘米|cm))?$`, "i").exec(text);
  const waist = new RegExp(`^(?:腰围|waist)\\s*${number}\\s*(?:厘米|cm)$`, "i").exec(text);
  if (weight || waist) {
    const result = personalEntrySchema.safeParse({kind: "body", date, weightKg: weight ? Number(weight[1]) : null,
      waistCm: weight?.[2] ? Number(weight[2]) : waist ? Number(waist[1]) : null});
    return result.success ? result.data : null;
  }
  const meal = /^(早餐|午餐|晚餐|加餐|breakfast|lunch|dinner|snack)\s*[:：]?\s*(.+)$/i.exec(text);
  if (!meal) return null;
  const values = new RegExp(`^(.+?)(?:[,， ]+${number}\\s*(?:千卡|大卡|kcal))?(?:[,， ]+(?:蛋白质|protein)\\s*${number}\\s*(?:克|g))?$`, "i").exec(meal[2]);
  if (!values || /\d|千卡|大卡|kcal|蛋白质|protein|kg|[?？]/i.test(values[1])) return null;
  const meals: Record<string,string> = {早餐:"breakfast",午餐:"lunch",晚餐:"dinner",加餐:"snack"};
  const result = personalEntrySchema.safeParse({kind: "food",date,foodName:values[1].trim(),mealType:meals[meal[1]] ?? meal[1].toLowerCase(),
    calories:values[2] === undefined ? null : Number(values[2]),protein:values[3] === undefined ? null : Number(values[3])});
  return result.success ? result.data : null;
}

export function entryLines(entry: PersonalEntry, en: boolean): string[] {
  if(entry.kind==="preference")return [preferenceLabel(entry.key,en),entry.value];
  if(entry.kind==="exercise")return [entry.exerciseName,`${entry.weightKg??"—"} kg · ${entry.reps??"—"} ${en?"reps":"次"} · ${entry.sets??"—"} ${en?"sets":"组"}`,`RPE · ${entry.rpe??"—"}`];
  return entry.kind === "body" ? [
    `${en ? "Weight" : "体重"} · ${entry.weightKg ?? "—"} kg`, `${en ? "Waist" : "腰围"} · ${entry.waistCm ?? "—"} cm`,
  ] : [entry.foodName, `${en ? "Energy" : "热量"} · ${entry.calories ?? "—"} kcal`, `${en ? "Protein" : "蛋白质"} · ${entry.protein ?? "—"} g`];
}

export function preferenceLabel(key:z.infer<typeof preferenceKeySchema>,en:boolean){
  const labels={goal:["目标","Goal"],schedule:["训练安排","Schedule"],equipment:["器械与场地","Equipment"],diet:["饮食偏好","Diet"],injury:["身体注意事项","Physical considerations"],units:["计量单位","Units"]};
  return labels[key][en?1:0];
}
