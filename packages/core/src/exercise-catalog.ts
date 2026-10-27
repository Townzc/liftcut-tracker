// Independently curated names and coarse movement metadata; no imported media,
// coaching text, load conversion or claim of equivalent training effects.
export const EXERCISE_CATALOG_VERSION = "session-v1" as const;
export const equipmentIds = ["barbell","rack","dumbbells","kettlebell","bench","incline_bench","cable","bands","pullup_bar",
  "chest_press","shoulder_press","row_machine","pulldown","smith","leg_press","leg_curl","lying_leg_curl","calf_machine","preacher_bench","ankle_strap","band_anchor"] as const;
export type Equipment = typeof equipmentIds[number];
export type CatalogExercise = {id:string;zh:string;en:string;aliases:string[];pattern:string;body:string;equipment:Equipment[]};
type Entry = [id:string,zh:string,en:string,equipment:Equipment[],aliases?:string[]];
const group = (pattern:string,body:string,entries:Entry[]):CatalogExercise[] => entries.map(([id,zh,en,equipment,aliases=[]])=>({id,zh,en,equipment,aliases,pattern,body}));
export const exerciseCatalog:CatalogExercise[] = [
  ...group("horizontal_push","chest",[
    ["barbell-bench","杠铃卧推","Barbell bench press",["barbell","bench","rack"],["卧推","Bench press"]],
    ["dumbbell-bench","哑铃卧推","Dumbbell bench press",["dumbbells","bench"]],
    ["dumbbell-floor-press","哑铃地板卧推","Dumbbell floor press",["dumbbells"]],
    ["machine-chest-press","坐姿器械推胸","Machine chest press",["chest_press"],["器械推胸"]],
    ["pushup","俯卧撑","Push-up",[],["Push up","Pushup"]],
  ]),
  ...group("vertical_push","shoulders",[
    ["barbell-overhead","站姿杠铃推举","Standing barbell overhead press",["barbell","rack"],["杠铃推举"]],
    ["dumbbell-overhead","站姿哑铃推举","Standing dumbbell overhead press",["dumbbells"]],
    ["seated-dumbbell-press","坐姿哑铃推举","Seated dumbbell shoulder press",["dumbbells","bench"]],
    ["machine-shoulder-press","器械肩推","Machine shoulder press",["shoulder_press"]],
    ["kettlebell-press","单臂壶铃推举","Single-arm kettlebell press",["kettlebell"]],
  ]),
  ...group("horizontal_pull","back",[
    ["barbell-row","杠铃俯身划船","Barbell bent-over row",["barbell"],["俯身划船"]],
    ["dumbbell-row","单臂哑铃划船","Single-arm dumbbell row",["dumbbells","bench"]],
    ["cable-row","坐姿绳索划船","Seated cable row",["cable"]],
    ["machine-row","坐姿器械划船","Seated machine row",["row_machine"]],
    ["supported-dumbbell-row","胸托哑铃划船","Chest-supported dumbbell row",["dumbbells","incline_bench"]],
  ]),
  ...group("vertical_pull","back",[
    ["pullup","正握引体向上","Pull-up",["pullup_bar"],["引体向上"]],
    ["chinup","反握引体向上","Chin-up",["pullup_bar"]],
    ["lat-pulldown","正握高位下拉","Lat pulldown",["pulldown"],["高位下拉"]],
    ["reverse-pulldown","反握高位下拉","Reverse-grip lat pulldown",["pulldown"]],
    ["band-pullup","弹力带辅助引体向上","Band-assisted pull-up",["bands","pullup_bar"]],
  ]),
  ...group("squat","quadriceps",[
    ["barbell-squat","杠铃深蹲","Barbell back squat",["barbell","rack"],["Back squat"]],
    ["goblet-squat","哑铃高脚杯深蹲","Dumbbell goblet squat",["dumbbells"]],
    ["kettlebell-squat","壶铃高脚杯深蹲","Kettlebell goblet squat",["kettlebell"]],
    ["bodyweight-squat","自重深蹲","Bodyweight squat",[]],
    ["smith-squat","史密斯深蹲","Smith machine squat",["smith"]],
  ]),
  ...group("hip_hinge","posterior_chain",[
    ["barbell-rdl","杠铃罗马尼亚硬拉","Barbell Romanian deadlift",["barbell"],["罗马尼亚硬拉"]],
    ["dumbbell-rdl","哑铃罗马尼亚硬拉","Dumbbell Romanian deadlift",["dumbbells"]],
    ["kettlebell-rdl","壶铃罗马尼亚硬拉","Kettlebell Romanian deadlift",["kettlebell"]],
    ["barbell-deadlift","杠铃传统硬拉","Conventional barbell deadlift",["barbell"],["硬拉","Deadlift"]],
    ["kettlebell-deadlift","壶铃硬拉","Kettlebell deadlift",["kettlebell"]],
  ]),
  ...group("split_squat","quadriceps",[
    ["split-squat","自重分腿蹲","Bodyweight split squat",[]],
    ["dumbbell-split-squat","哑铃分腿蹲","Dumbbell split squat",["dumbbells"]],
    ["kettlebell-split-squat","壶铃分腿蹲","Kettlebell split squat",["kettlebell"]],
    ["barbell-split-squat","杠铃分腿蹲","Barbell split squat",["barbell","rack"]],
    ["smith-split-squat","史密斯分腿蹲","Smith machine split squat",["smith"]],
  ]),
  ...group("knee_flexion","hamstrings",[
    ["seated-leg-curl","坐姿腿弯举","Seated leg curl",["leg_curl"]],
    ["lying-leg-curl","俯卧腿弯举","Lying leg curl",["lying_leg_curl"]],
    ["single-leg-curl","单腿器械弯举","Single-leg machine curl",["leg_curl"]],
    ["band-leg-curl","弹力带腿弯举","Band leg curl",["bands","band_anchor"]],
    ["cable-leg-curl","绳索腿弯举","Cable leg curl",["cable","ankle_strap"]],
  ]),
  ...group("plantar_flexion","calves",[
    ["standing-calf","站姿自重提踵","Standing bodyweight calf raise",[]],
    ["single-calf","单腿自重提踵","Single-leg bodyweight calf raise",[]],
    ["dumbbell-calf","哑铃提踵","Dumbbell calf raise",["dumbbells"]],
    ["machine-calf","器械提踵","Machine calf raise",["calf_machine"]],
    ["leg-press-calf","腿举机提踵","Leg press calf raise",["leg_press"]],
  ]),
  ...group("elbow_flexion","biceps",[
    ["barbell-curl","杠铃弯举","Barbell curl",["barbell"]],
    ["dumbbell-curl","哑铃弯举","Dumbbell curl",["dumbbells"]],
    ["cable-curl","绳索弯举","Cable curl",["cable"]],
    ["band-curl","弹力带弯举","Band curl",["bands"]],
    ["preacher-curl","哑铃牧师凳弯举","Dumbbell preacher curl",["dumbbells","preacher_bench"]],
  ]),
  ...group("elbow_extension","triceps",[
    ["cable-pushdown","绳索下压","Cable triceps pushdown",["cable"],["三头下压"]],
    ["dumbbell-triceps","哑铃颈后臂屈伸","Dumbbell overhead triceps extension",["dumbbells"]],
    ["lying-triceps","仰卧哑铃臂屈伸","Lying dumbbell triceps extension",["dumbbells","bench"]],
    ["band-triceps","弹力带臂屈伸","Band triceps extension",["bands"]],
    ["cable-overhead-triceps","绳索颈后臂屈伸","Cable overhead triceps extension",["cable"]],
  ]),
  ...group("trunk_flexion","abdominals",[
    ["crunch","卷腹","Crunch",[]],
    ["reverse-crunch","反向卷腹","Reverse crunch",[]],
    ["dumbbell-crunch","哑铃负重卷腹","Dumbbell crunch",["dumbbells"]],
    ["cable-crunch","绳索卷腹","Cable crunch",["cable"]],
    ["band-crunch","弹力带卷腹","Band crunch",["bands","band_anchor"]],
  ]),
];
const normalize = (v:string) => v.normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");
export function identifyExercise(name:string,catalog=exerciseCatalog):CatalogExercise | null {
  const matches=catalog.filter(e=>[e.zh,e.en,...e.aliases].some(n=>normalize(n)===normalize(name)));
  return matches.length===1?matches[0]:null; // Never fuzzy-match an ambiguous/unknown name.
}
/**
 * The body region of a name, only when every catalog exercise it can mean agrees: its
 * exact matches, or, for a generic name ("深蹲", "划船"), every exercise whose name ends
 * with it ("杠铃深蹲", "单臂哑铃划船"). Names end with the movement, so "腿举" does not
 * mean "腿举机提踵", and "弯举" (arms and legs) stays unknown.
 */
export function bodyRegionOf(name:string,catalog=exerciseCatalog):string | null {
  const q=normalize(name),names=(e:CatalogExercise)=>[e.zh,e.en,...e.aliases].map(normalize);
  const agree=(list:CatalogExercise[])=>{const bodies=new Set(list.map(e=>e.body));return bodies.size===1?[...bodies][0]:null;};
  const exact=catalog.filter(e=>names(e).includes(q));
  return exact.length?agree(exact):q.length>=2?agree(catalog.filter(e=>names(e).some(n=>n.endsWith(q)))):null;
}
export function replacementCandidates(name:string,available:Equipment[]) {
  const source=identifyExercise(name);
  return !source?[]:exerciseCatalog.filter(e=>e.id!==source.id && e.pattern===source.pattern && e.body===source.body
    && e.equipment.every(x=>available.includes(x))).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
export function exerciseLabel(name:string,locale:string) {
  const e=identifyExercise(name);
  // Translation is not identification: a generic squat must not imply a barbell or a catalog ID.
  const generic=[{zh:"深蹲",en:"Squat"},{zh:"划船",en:"Row"},{zh:"弯举",en:"Curl"},
    {zh:"肩推",en:"Shoulder press"},{zh:"侧平举",en:"Lateral raise"},{zh:"飞鸟",en:"Fly"}]
    .find(x=>normalize(x.zh)===normalize(name)||normalize(x.en)===normalize(name));
  const label=e??generic;return label?(locale==="en"?label.en:label.zh):name;
}
