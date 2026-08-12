export type DemoLocale = "zh" | "en";
export type ExerciseFocus = "all" | "upper" | "lower" | "core";

type LocalizedText = Record<DemoLocale, string>;

export interface BeginnerExercise {
  id: string;
  sourceName: string;
  name: LocalizedText;
  focus: Exclude<ExerciseFocus, "all">;
  target: LocalizedText;
  equipment: LocalizedText;
  dose: LocalizedText;
  cue: LocalizedText;
  easier: LocalizedText;
  steps: Record<DemoLocale, string[]>;
}

export const EXERCISE_DATASET_SOURCE =
  "https://github.com/hasaneyldrm/exercises-dataset";

export const beginnerExercises: BeginnerExercise[] = [
  {
    id: "0659",
    sourceName: "push-up (wall)",
    name: { zh: "墙壁俯卧撑", en: "Wall push-up" },
    focus: "upper",
    target: { zh: "胸、肩、手臂", en: "Chest, shoulders, arms" },
    equipment: { zh: "墙面", en: "Wall" },
    dose: { zh: "2 组 × 6–10 次", en: "2 sets × 6–10 reps" },
    cue: { zh: "从头到脚保持一条直线，肘部斜向后。", en: "Keep a straight line head to heel; angle elbows back." },
    easier: { zh: "站得更靠近墙面。", en: "Stand closer to the wall." },
    steps: {
      zh: [
        "面向墙壁站立，距离约一臂。",
        "双手放在与肩同高的位置，略宽于肩。",
        "双脚向后移动，收紧核心，让身体保持一条直线。",
        "弯曲肘部，让胸部有控制地靠近墙面。",
        "推回起始位置，动作全程保持稳定。",
      ],
      en: [
        "Stand facing a wall, about an arm's length away.",
        "Place your hands at shoulder height, slightly wider than shoulder width.",
        "Step back and brace your core so your body stays in a straight line.",
        "Bend your elbows and lower your chest toward the wall with control.",
        "Push back to the start while keeping your body steady.",
      ],
    },
  },
  {
    id: "0493",
    sourceName: "incline push-up",
    name: { zh: "上斜俯卧撑", en: "Incline push-up" },
    focus: "upper",
    target: { zh: "胸、肩、手臂", en: "Chest, shoulders, arms" },
    equipment: { zh: "稳固桌面或训练凳", en: "Stable bench or counter" },
    dose: { zh: "2 组 × 6–10 次", en: "2 sets × 6–10 reps" },
    cue: { zh: "支撑物必须稳固，胸口朝支撑物靠近。", en: "Use a stable surface and bring your chest toward it." },
    easier: { zh: "选择更高的支撑面。", en: "Choose a higher support." },
    steps: {
      zh: [
        "双手放在稳固的高位支撑面，略宽于肩。",
        "双腿向后伸展，从头到脚跟保持一条直线。",
        "弯曲肘部，让胸部有控制地靠近支撑面。",
        "在最低点短暂停顿，再伸直手臂推回。",
        "保持腹部收紧，不要塌腰或耸肩。",
      ],
      en: [
        "Place your hands on a stable raised surface, slightly wider than shoulder width.",
        "Extend your legs so your body forms a straight line head to heel.",
        "Bend your elbows and lower your chest toward the surface with control.",
        "Pause briefly, then straighten your arms to push back.",
        "Keep your core braced without sagging or shrugging.",
      ],
    },
  },
  {
    id: "3132",
    sourceName: "potty squat with support",
    name: { zh: "扶椅深蹲", en: "Supported squat" },
    focus: "lower",
    target: { zh: "臀腿", en: "Glutes and legs" },
    equipment: { zh: "稳固椅背或墙面", en: "Stable chair or wall" },
    dose: { zh: "2 组 × 6–10 次", en: "2 sets × 6–10 reps" },
    cue: { zh: "膝盖跟随脚尖方向，臀部向后坐。", en: "Track knees with toes and sit the hips back." },
    easier: { zh: "缩小下蹲幅度。", en: "Use a shallower range." },
    steps: {
      zh: [
        "双脚与肩同宽，脚尖稍微向外。",
        "轻扶稳固的椅背或墙面保持平衡。",
        "弯曲膝盖，同时让臀部向后移动。",
        "保持胸口打开、背部自然挺直。",
        "脚掌均匀发力，站回起始位置。",
      ],
      en: [
        "Stand with feet shoulder width apart and toes slightly turned out.",
        "Lightly hold a stable chair or wall for balance.",
        "Bend your knees while sending your hips back.",
        "Keep your chest up and your back naturally long.",
        "Press evenly through your feet to stand back up.",
      ],
    },
  },
  {
    id: "3013",
    sourceName: "low glute bridge on floor",
    name: { zh: "臀桥", en: "Glute bridge" },
    focus: "lower",
    target: { zh: "臀部、腿后侧", en: "Glutes and hamstrings" },
    equipment: { zh: "瑜伽垫（可选）", en: "Mat (optional)" },
    dose: { zh: "2 组 × 8–12 次", en: "2 sets × 8–12 reps" },
    cue: { zh: "抬起来自臀部发力，不要用腰部过度后仰。", en: "Lift with the glutes without over-arching the lower back." },
    easier: { zh: "减小抬起高度。", en: "Reduce the lift height." },
    steps: {
      zh: [
        "仰卧，膝盖弯曲，双脚平放在地面。",
        "双臂放在身体两侧，手掌向下。",
        "收紧核心与臀部，缓慢抬起髋部。",
        "身体从肩膀到膝盖接近一条直线时停顿。",
        "有控制地放下髋部，再重复动作。",
      ],
      en: [
        "Lie on your back with knees bent and feet flat.",
        "Place your arms by your sides with palms down.",
        "Brace your core and glutes, then slowly lift your hips.",
        "Pause when your shoulders, hips, and knees are nearly aligned.",
        "Lower your hips with control and repeat.",
      ],
    },
  },
  {
    id: "0276",
    sourceName: "dead bug",
    name: { zh: "死虫式", en: "Dead bug" },
    focus: "core",
    target: { zh: "核心稳定", en: "Core stability" },
    equipment: { zh: "瑜伽垫（可选）", en: "Mat (optional)" },
    dose: { zh: "每侧 2 组 × 5–8 次", en: "2 sets × 5–8 each side" },
    cue: { zh: "腰背保持贴地，只伸到仍能稳定的位置。", en: "Keep your lower back grounded; extend only as far as you can control." },
    easier: { zh: "只移动一条腿，双臂保持不动。", en: "Move one leg while keeping both arms still." },
    steps: {
      zh: [
        "仰卧，双臂伸向天花板。",
        "抬起双腿，让髋部和膝盖都约为 90 度。",
        "轻轻收紧腹部，让腰背贴近地面。",
        "缓慢放低右臂和左腿，保持身体稳定。",
        "回到起始位置，再换另一侧。",
      ],
      en: [
        "Lie on your back with both arms reaching toward the ceiling.",
        "Lift your legs so hips and knees are near 90 degrees.",
        "Gently brace your core and keep your lower back grounded.",
        "Slowly lower your right arm and left leg while staying stable.",
        "Return to the start and repeat on the other side.",
      ],
    },
  },
  {
    id: "1490",
    sourceName: "standing calf raise (on a staircase)",
    name: { zh: "站姿提踵", en: "Standing calf raise" },
    focus: "lower",
    target: { zh: "小腿", en: "Calves" },
    equipment: { zh: "墙面或稳固支撑", en: "Wall or stable support" },
    dose: { zh: "2 组 × 8–12 次", en: "2 sets × 8–12 reps" },
    cue: { zh: "先在平地练习，动作慢而稳定。", en: "Start on level ground and move slowly with control." },
    easier: { zh: "双手扶墙并缩小幅度。", en: "Use two-hand support and a smaller range." },
    steps: {
      zh: [
        "在平地站稳，双脚约与髋同宽。",
        "必要时扶住墙面或稳固支撑物。",
        "缓慢抬起脚后跟，把重量移向前脚掌。",
        "在最高点短暂停顿，保持身体直立。",
        "有控制地放下脚后跟。",
      ],
      en: [
        "Stand securely on level ground with feet about hip width apart.",
        "Hold a wall or stable support if needed.",
        "Slowly raise your heels and shift weight onto the balls of your feet.",
        "Pause briefly at the top while staying upright.",
        "Lower your heels with control.",
      ],
    },
  },
];

export function filterBeginnerExercises(
  exercises: BeginnerExercise[],
  query: string,
  focus: ExerciseFocus,
): BeginnerExercise[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return exercises.filter((exercise) => {
    if (focus !== "all" && exercise.focus !== focus) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const searchable = [
      exercise.sourceName,
      exercise.name.zh,
      exercise.name.en,
      exercise.target.zh,
      exercise.target.en,
      exercise.equipment.zh,
      exercise.equipment.en,
    ]
      .join(" ")
      .toLocaleLowerCase();

    return searchable.includes(normalizedQuery);
  });
}
