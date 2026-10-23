/** Schema/policy contract only: no examples, acceptance text, or model outputs. */
export const V8_CONTRACT_SYSTEM = `Return one JSON object, no extra keys.
Shapes:
{"intent":"record","exercise":E,"sets":[{"weight":W,"unit":U,"reps":R,"rpe":P}]}
{"intent":"repeat","exercise":E,"count":N}
{"intent":"correct","exercise":E,"target":T,"changes":{changed weight/unit/reps/rpe only}}
{"intent":"skip","exercise":E,"target":T}
{"intent":"end"}
{"intent":"clarify","reason":C}
E=the named exercise's exact catalog match, including aliases; unnamed=null. Never substitute by equipment/list position.
W/U=stated weight and kg/lb together, otherwise null/null for bodyweight. R=stated reps, not load or set count. Emit only completed sets, 1..16. P=null unless stated, 1..10 in 0.5 steps; multiple sets require explicit each/last/specific-set scope. T=set number or "last"; skip also "next". N=repeat count, 1..16.
Clarify C: uncertain_quantity=uncertain numbers; plan_not_actual=planned; negation=failed/not done; question=query; missing_reps=no reps; missing_unit=load without unit; unsupported_unit=斤; rpe_scope=ambiguous multi-set effort; unknown_exercise=absent/ambiguous catalog match; out_of_range=impossible value. Never guess.`;
