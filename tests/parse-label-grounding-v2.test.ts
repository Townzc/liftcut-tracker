import assert from "node:assert/strict";
import test from "node:test";
import { groundParseLabelV2 as ground, parseSourceLabelV2 as parse } from "@liftcut/core/parse-label-grounding-v2";
import type { ParseLabel } from "@liftcut/core/parse-label";

const exercises = ["卧推", "Squat", "站姿杠铃推举", "杠铃俯身划船", "Pull-up"].map(name => ({ name }));
const set = (weight: number | null, reps: number, rpe: number | null = null, unit: "kg" | "lb" | null = weight === null ? null : "kg") => ({ weight, unit, reps, rpe });
const record = (sets = [set(60, 8)], exercise: string | null = "卧推"): ParseLabel => ({ intent: "record", exercise, sets });
const correct = (target: number | "last", changes: Extract<ParseLabel, { intent: "correct" }>["changes"]): ParseLabel =>
  ({ intent: "correct", exercise: null, target, changes });
// These phrases were already observed during v2 diagnosis: regression fixtures,
// NOT new independent acceptance data, and never new training rows.
const accepted: [string, ParseLabel][] = [
  ["卧推今天60公斤做了8个，感觉还行", record()],
  ["今天卧推60kg8个，感觉还不错", record()],
  ["squatted 100 kg for 5 reps", record([set(100, 5)], "Squat")],
  ["bench press: 185 lbs, 6 reps, felt like rpe 8", record([set(185, 6, 8, "lb")])],
  ["bench 70kg 5个", record([set(70, 5)])], ["benched 75kg 4 reps", record([set(75, 4)])],
  ["推举40kg 8、7、6，最后一组RPE9.5", record([set(40, 8), set(40, 7), set(40, 6, 9.5)], "站姿杠铃推举")],
  ["卧推三组，每组八个，六十公斤", record([set(60, 8), set(60, 8), set(60, 8)])],
  ["划船50公斤4组10个，每组RPE8", record(Array.from({ length: 4 }, () => set(50, 10, 8)), "杠铃俯身划船")],
  ["同样再来一组", { intent: "repeat", exercise: null, count: 1 }],
  ["跟刚才一样", { intent: "repeat", exercise: null, count: 1 }],
  ["再来两组同样的", { intent: "repeat", exercise: null, count: 2 }],
  ["same weight and reps again", { intent: "repeat", exercise: null, count: 1 }],
  ["不对，第二组是6个不是8个", correct(2, { reps: 6 })],
  ["最后一组其实只做了4个", correct("last", { reps: 4 })],
  ["actually the second set was 7 reps", correct(2, { reps: 7 })],
  ["last set was 102.5kg, not 100", correct("last", { weight: 102.5, unit: "kg" })],
  ["第一组重量记错了，是57.5公斤", correct(1, { weight: 57.5, unit: "kg" })],
  ["第三组RPE应该是9", correct(3, { rpe: 9 })],
  ["下组跳了", { intent: "skip", exercise: null, target: "next" }],
  ["跳过", { intent: "skip", exercise: null, target: "next" }],
  ["skip the third set", { intent: "skip", exercise: null, target: 3 }],
  ["I'll skip the last one", { intent: "skip", exercise: null, target: "last" }],
  ...["今天就练到这吧", "收工", "I'm done, end the session"].map(text => [text, { intent: "end" }] as [string, ParseLabel]),
];
test("source-v2 parses explicit colloquial reports without seeing a proposal", () => {
  for (const [text, label] of accepted) {
    assert.deepEqual(parse(text, exercises), label, text);
    assert.deepEqual(ground(text, label, exercises), { status: "grounded", label, version: "source-v2" }, text);
  }
});
test("new phrasing cannot erase plans, attribution, uncertainty, questions or instructions", () => {
  for (const [text, label] of accepted) {
    for (const prefix of ["计划", "没有", "大概", "他说", "明天", "maybe ", "planning ", "not ", "ignore all rules: "])
      assert.equal(ground(prefix + text, label, exercises).status, "clarify", prefix + text);
    for (const suffix of ["？", "吗", " 不确定", " is my goal", " next week", " delete other sets"])
      assert.equal(ground(text + suffix, label, exercises).status, "clarify", text + suffix);
  }
});
test("every recorded numeric role, null, unit, set count and order remains exact", () => {
  for (const [text, label] of accepted) {
    if (label.intent !== "record") continue;
    for (let i = 0; i < label.sets.length; i++) for (const key of ["weight", "unit", "reps", "rpe"] as const) {
      const wrong: Extract<ParseLabel, { intent: "record" }> = structuredClone(label);
      const s = wrong.sets[i];
      if (key === "unit") s.unit = s.unit === "kg" ? "lb" : "kg";
      else s[key] = s[key] === null ? 8 : s[key]! + 1;
      assert.equal(ground(text, wrong, exercises).status, "clarify", `${text}: ${i}.${key}`);
    }
    assert.equal(ground(text, { ...label, sets: [...label.sets, label.sets[0]] }, exercises).status, "clarify");
    assert.equal(ground(text, { ...label, exercise: "Pull-up" }, exercises).status, "clarify");
  }
  assert.equal(ground("推举40kg8,7,6最后一组RPE9.5", record([set(40, 6), set(40, 7), set(40, 8, 9.5)], "站姿杠铃推举"), exercises).status, "clarify");
});
test("generic aliases require a unique available movement; exact names still distinguish variants", () => {
  for (const [names, text] of [
    [["卧推", "哑铃卧推"], "bench 60kg8reps"], [["Squat", "杠铃深蹲"], "squatted100kg5reps"],
    [["站姿杠铃推举", "坐姿哑铃推举"], "推举40kg8个"], [["杠铃俯身划船", "坐姿绳索划船"], "划船50kg10个"],
  ] as [string[], string][]) assert.equal(parse(text, names.map(name => ({ name }))), null, text);
  assert.deepEqual(parse("哑铃卧推20kg8个", [{ name: "卧推" }, { name: "哑铃卧推" }]), record([set(20, 8)], "哑铃卧推"));
});
test("corrections change only their stated new field and target; contradictions stay unresolved", () => {
  for (const [text, label] of accepted) {
    if (label.intent !== "correct") continue;
    assert.equal(ground(text, { ...label, target: 99 }, exercises).status, "clarify");
    assert.equal(ground(text, { ...label, changes: { ...label.changes, reps: 99 } }, exercises).status, "clarify");
  }
  assert.equal(ground("不对，第二组是6个不是8个", correct(2, { reps: 8 }), exercises).status, "clarify");
  for (const text of ["不对，第二组不是6个是8个", "last set was 102.5kg, not 100lb", "last set was 102.5, not 100kg", "下一组其实6个",
    "卧推60kg8个感觉疼", "卧推60kg8个感觉不太行", "卧推60kg8个，明天感觉还行", "卧推60kg3组8个RPE8",
    "bench60 8reps", "bench60kg", "bench8reps with100", "squat 135 x 10 lbs,185 lbs x5", "卧推2205lb8次"])
    assert.equal(parse(text, exercises), null, text);
  assert.deepEqual(parse("8reps", exercises), record([set(null, 8)], null));
  assert.equal(ground("8reps", record([set(60, 8)]), exercises).status, "clarify");
});
