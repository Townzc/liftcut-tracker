"""Materialize 30 authored synthetic dev seeds; no model-generated labels.

All timing costs and exercise IDs refer to toy blocks. These seeds are public dev
fixtures, not training examples, held-out evaluation, or health recommendations.
Run with --check in CI to detect drift from the checked-in UTF-8 JSONL.
"""

import argparse
import json
from pathlib import Path

DEFAULT = {
    "available_days": ["tue", "fri"], "sessions_per_week": 2,
    "equipment": ["bodyweight", "dumbbell"], "max_minutes": 30,
    "min_exercises": 2, "excluded_exercise_ids": [],
}

# category, request, explicit constraint overrides, expected decision
SEEDS = [
    ("schedule", "只安排周一和周五，两次训练。", {"available_days": ["mon", "fri"]}, "propose_plan"),
    ("schedule", "本周只安排周日一次。", {"available_days": ["sun"], "sessions_per_week": 1}, "propose_plan"),
    ("schedule", "周一、三、五各安排一次。", {"available_days": ["mon", "wed", "fri"], "sessions_per_week": 3}, "propose_plan"),
    ("schedule", "只在周末两天安排。", {"available_days": ["sat", "sun"]}, "propose_plan"),
    ("schedule", "工作日每天安排一次。", {"available_days": ["mon", "tue", "wed", "thu", "fri"], "sessions_per_week": 5}, "propose_plan"),
    ("equipment", "只能选择徒手模块。", {"equipment": ["bodyweight"]}, "propose_plan"),
    ("equipment", "只允许使用哑铃模块。", {"equipment": ["dumbbell"]}, "propose_plan"),
    ("equipment", "使用两个杠铃模块，预算为25分钟。", {"equipment": ["barbell"], "max_minutes": 25}, "propose_plan"),
    ("equipment", "仅使用器械模块，预算为28分钟。", {"equipment": ["machine"], "max_minutes": 28}, "propose_plan"),
    ("equipment", "徒手或哑铃都可以，但排除bodyweight-a和dumbbell-a。", {"excluded_exercise_ids": ["bodyweight-a", "dumbbell-a"]}, "propose_plan"),
    ("time_budget", "两个徒手模块必须在13分钟内。", {"equipment": ["bodyweight"], "max_minutes": 13}, "propose_plan"),
    ("time_budget", "两个哑铃模块必须在18分钟内。", {"equipment": ["dumbbell"], "max_minutes": 18}, "propose_plan"),
    ("time_budget", "任意可用模块，预算恰好13分钟。", {"max_minutes": 13}, "propose_plan"),
    ("time_budget", "每次至少三个徒手模块，23分钟预算。", {"equipment": ["bodyweight"], "min_exercises": 3, "max_minutes": 23}, "propose_plan"),
    ("time_budget", "排除最短徒手模块，预算15分钟。", {"excluded_exercise_ids": ["bodyweight-a"], "max_minutes": 15}, "propose_plan"),
    ("missing_information", "可安排的日期还没有提供，请先确认。", {"available_days": None}, "request_clarification"),
    ("missing_information", "每周训练次数还没有确定。", {"sessions_per_week": None}, "request_clarification"),
    ("missing_information", "可用器械还没有说明。", {"equipment": None}, "request_clarification"),
    ("missing_information", "每次时间预算还没有确定。", {"max_minutes": None}, "request_clarification"),
    ("missing_information", "请先确认器械和每次最少模块数。", {"equipment": None, "min_exercises": None}, "request_clarification"),
    ("infeasible", "只允许周二，但要求两个不同日期的训练。", {"available_days": ["tue"]}, "report_infeasible"),
    ("infeasible", "每次两个徒手模块，但只有12分钟。", {"equipment": ["bodyweight"], "max_minutes": 12}, "report_infeasible"),
    ("infeasible", "没有任何允许使用的模块类型，不能自行假定有器械。", {"equipment": []}, "report_infeasible"),
    ("infeasible", "仅允许徒手，但三个徒手模块全部排除。", {"equipment": ["bodyweight"], "excluded_exercise_ids": ["bodyweight-a", "bodyweight-b", "bodyweight-c"]}, "report_infeasible"),
    ("infeasible", "每次需要四个不同徒手模块，目录里只有三个。", {"equipment": ["bodyweight"], "min_exercises": 4}, "report_infeasible"),
    ("evidence_ids", "按给定约束预览，并引用提供的记录编号。", {}, "propose_plan"),
    ("evidence_ids", "有两条历史记录，可引用其中实际存在的记录。", {}, "propose_plan"),
    ("evidence_ids", "没有历史记录，仍按完整约束预览，不要编造引用。", {}, "propose_plan"),
    ("evidence_ids", "Reference an existing synthetic record; keep the given schedule.", {}, "propose_plan"),
    ("evidence_ids", "引用中文编号记录，保持两次训练的预览。", {}, "propose_plan"),
]


def build() -> str:
    lines = []
    for index, (category, request, overrides, action) in enumerate(SEEDS, 1):
        case_id = f"seed-{index:03d}"
        records = [{"id": f"record-{index:03d}", "summary": "Synthetic source record for ID validation only."}]
        if index == 27:
            records.append({"id": "record-027-b", "summary": "Second synthetic record; not a temporal-memory test."})
        if index == 28:
            records = []
        if index == 30:
            records = [{"id": "记录-030", "summary": "仅用于测试Unicode引用编号的合成记录。"}]
        case = {
            "id": case_id, "family_id": f"seed-family-{category}",
            "persona_id": f"synthetic-persona-{index:03d}", "split": "dev",
            "category": category,
            "input": {"request": request, "constraints": {**DEFAULT, **overrides}, "records": records},
            "expected_action": action,
        }
        lines.append(json.dumps(case, ensure_ascii=False, sort_keys=True))
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    destination = Path(__file__).with_name("dev-seeds.jsonl")
    rendered = build()
    if args.check:
        if destination.read_text(encoding="utf-8") != rendered:
            raise SystemExit("dev-seeds.jsonl differs from the authored seed definitions")
        print("30 authored development seeds match the checked-in JSONL")
    else:
        destination.write_text(rendered, encoding="utf-8", newline="\n")
        print(f"Wrote {len(SEEDS)} development seeds to {destination.name}")
