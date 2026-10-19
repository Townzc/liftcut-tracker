/** Pure rules-only drafts. No plan actuals, network, authorization or writes. */
export type ParseExercise = { id: string; name: string; aliases?: string[]; setCount: number };
export type ParseActual = { id: string; exerciseId: string; setIndex: number; revision: number;
  status: "done" | "skipped" | "voided"; weightKg: number | null; reps: number | null; rpe: number | null };
export type ParseContext = { exercises: ParseExercise[]; actuals: ParseActual[]; selectedExerciseId?: string };
export type ParsedSet = { setIndex: number; weightKg: number | null; reportedWeight: number | null;
  inputUnit: "kg" | "lb" | null; reps: number; rpe: number | null };
export type LogDraft =
  | { kind: "record"; exerciseId: string; explicit: boolean; sets: ParsedSet[] }
  | { kind: "correct"; exerciseId: string; recordId: string; revision: number; setIndex: number;
      changes: { reps: number }; explicit: true }
  | { kind: "skip"; exerciseId: string; setIndex: number; explicit: true }
  | { kind: "end"; explicit: false };
export type ParseResult = { status: "draft"; draft: LogDraft } | { status: "clarify"; reason: string };
const ask = (reason: string): ParseResult => ({ status: "clarify", reason });
const ready = (draft: LogDraft): ParseResult => ({ status: "draft", draft });
const integer = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;

function contextValid(c: ParseContext): boolean {
  const ids = new Set(c.exercises.map(e => e.id));
  if (ids.size !== c.exercises.length || c.exercises.some(e => !e.id || !e.name.trim() || !integer(e.setCount,100) || e.setCount < 1)) return false;
  const slots = new Set<string>(), records = new Set<string>();
  for (const r of c.actuals) {
    const e = c.exercises.find(e => e.id === r.exerciseId), slot = `${r.exerciseId}:${r.setIndex}`;
    if (!e || !r.id || records.has(r.id) || slots.has(slot) || !integer(r.setIndex,e.setCount) || r.setIndex < 1 || !integer(r.revision,1e9) || r.revision < 1
      || !["done","skipped","voided"].includes(r.status)
      || (r.weightKg !== null && (!Number.isFinite(r.weightKg) || r.weightKg < 0 || r.weightKg > 1000))
      || (r.reps !== null && !integer(r.reps,100))
      || (r.rpe !== null && (!Number.isFinite(r.rpe) || r.rpe < 1 || r.rpe > 10))) return false;
    slots.add(slot); records.add(r.id);
  }
  return !c.selectedExerciseId || ids.has(c.selectedExerciseId);
}

function resolveExercise(text: string, c: ParseContext) {
  const matches = c.exercises.flatMap(exercise => [exercise.name,...(exercise.aliases ?? [])]
    .map(name => name.normalize("NFKC").toLowerCase().trim()).filter(name => name && text.startsWith(name))
    .map(name => ({ exercise, length: name.length })));
  if (matches.length) {
    const max = Math.max(...matches.map(m => m.length));
    const best = matches.filter(m => m.length === max);
    if (new Set(best.map(m => m.exercise.id)).size !== 1) return null;
    return { exercise: best[0].exercise, text: text.slice(max).trim() };
  }
  const exercise = c.exercises.find(e => e.id === c.selectedExerciseId);
  return exercise ? { exercise, text } : null;
}

export function parseWorkoutLog(input: string, c: ParseContext): ParseResult {
  if (!contextValid(c)) return ask("invalid_context");
  if (!input.trim() || input.length > 400) return ask("input_length");
  let text = input.normalize("NFKC").toLowerCase().trim().replace(/[。.!]$/, "").trim();
  if (/^(练完了|结束训练|finish workout|end workout)$/.test(text)) return ready({kind:"end",explicit:false});
  // Planning, negation, uncertain quantities and questions are never reports.
  if (/(计划|目标|打算|准备|没有|没做|不是|不要|可能|大概|差不多|约|\b(?:not|plan|target|maybe|about)\b|[?？~])/.test(text)) return ask("not_unambiguous_actuals");
  if (/(同上|same as|same again|ditto)/.test(text)) return ask("repeat_needs_explicit_fields");
  const correct = /^(更正|改正|刚才|correct\b|change\b)\s*/.exec(text);
  const skip = /^(跳过|skip\b)\s*/.exec(text);
  const command = /^(?:帮我)?(?:记下|记录|log\b|record\b)\s*/.exec(text);
  const prefix = correct ?? skip ?? command;
  if (prefix) text = text.slice(prefix[0].length).trim().replace(/^[:：]\s*/, "");
  const resolved = resolveExercise(text,c);
  if (!resolved) return ask("exercise_not_unique");
  const {exercise} = resolved; text = resolved.text;
  const occupied = c.actuals.filter(r => r.exerciseId === exercise.id);
  const available = Array.from({length:exercise.setCount},(_,i)=>i+1).filter(i => !occupied.some(r => r.setIndex === i));
  if (correct) {
    // Corrections are patches: every omitted field stays untouched. Only the
    // deliberately supported reps grammar is accepted in this first slice.
    const m = /^(?:第\s*(\d+)\s*组|set\s+(\d+)|最后一组|last set)\s*(?:其实|改成|为|to|=)?\s*(\d+)\s*(?:次|个|reps?)$/.exec(text);
    if (!m || !integer(Number(m[3]),100)) return ask("correction_unsupported");
    const index = m[1] || m[2] ? Number(m[1] || m[2]) : Math.max(0,...occupied.filter(r=>r.status==="done").map(r=>r.setIndex));
    const targets = occupied.filter(r=>r.setIndex===index && r.status==="done");
    if (targets.length !== 1) return ask("correction_target_not_unique");
    const r = targets[0];
    return ready({kind:"correct",exerciseId:exercise.id,recordId:r.id,revision:r.revision,setIndex:r.setIndex,changes:{reps:Number(m[3])},explicit:true});
  }
  if (skip) {
    const m = /^(?:第\s*(\d+)\s*组|set\s+(\d+)|最后一组|last set|下一组|next set)?$/.exec(text);
    if (!m) return ask("skip_target_not_unique");
    const index = m[1] || m[2] ? Number(m[1] || m[2]) : /最后|last/.test(text) ? exercise.setCount : available[0];
    if (!available.includes(index)) return ask("set_unavailable");
    return ready({kind:"skip",exerciseId:exercise.id,setIndex:index,explicit:true});
  }
  let rpe: number | null = null, rpeScope = "";
  const rpeMatch = /(?:[,，]\s*)?(?:(最后一组|last set|每组|each set)\s*)?rpe\s*(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (rpeMatch) {
    rpe = Number(rpeMatch[2]);rpeScope = rpeMatch[1] ?? "";
    if (rpe < 1 || rpe > 10) return ask("out_of_range");
    text = text.slice(0,rpeMatch.index).trim().replace(/[,，]$/, "").trim();
  }
  let weight: number | null = null, unit: "kg" | "lb" | null = null;
  const wm = /^(\d+(?:\.\d+)?)\s*(kg|公斤|千克|lbs?|磅)\s*(?:[x×*]\s*)?/.exec(text);
  if (wm) {weight=Number(wm[1]);unit=/^(lb|磅)/.test(wm[2])?"lb":"kg";text=text.slice(wm[0].length).trim();}
  const weightKg = weight === null ? null : Math.round(weight*(unit==="lb"?0.45359237:1)*1e6)/1e6;
  if (weightKg !== null && weightKg > 1000) return ask("out_of_range");
  let reps: number[];
  const repeated = /^(\d+)\s*(?:组\s*(?:每组|[x×*])?\s*|sets?\s+of\s+)(\d+)\s*(?:次|个|reps?)$/.exec(text);
  if (repeated) {
    const count=Number(repeated[1]);
    if (!integer(count,16) || count < 1) return ask("out_of_range");
    reps = Array<number>(count).fill(Number(repeated[2]));
  } else {
    const rm = /^(\d+(?:\s*[,、/]\s*\d+)*)\s*(次|个|reps?)?$/.exec(text);
    if (!rm || (!wm && !rm[2])) return ask("unsupported_or_missing_unit");
    reps = rm[1].split(/[,、/]/).map(Number);
  }
  if (reps.length>16 || reps.some(n=>!integer(n,100))) return ask("out_of_range");
  if (reps.length>available.length) return ask("set_unavailable");
  if (rpe!==null && reps.length>1 && !rpeScope) return ask("rpe_scope_ambiguous");
  return ready({kind:"record",exerciseId:exercise.id,explicit:Boolean(command),sets:reps.map((n,i)=>({
    setIndex:available[i],weightKg,reportedWeight:weight,inputUnit:unit,reps:n,
    rpe:rpe===null?null:reps.length===1 || /每组|each set/.test(rpeScope) || i===reps.length-1?rpe:null,
  }))});
}
