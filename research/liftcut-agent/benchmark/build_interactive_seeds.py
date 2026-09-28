"""Author synthetic interactive development fixtures; no model or personal data."""

import argparse
from copy import deepcopy
import json
from pathlib import Path

DEFAULT = {
    "available_days": ["tue", "fri"], "sessions_per_week": 2,
    "equipment": ["bodyweight", "dumbbell"], "max_minutes": 30,
    "min_exercises": 2, "excluded_exercise_ids": [],
}


def memory(identity, equipment, revision, *, confirmed=True, expires_on=None):
    return {"id": identity, "field": "equipment", "value": equipment, "revision": revision,
            "confirmed": confirmed, "expires_on": expires_on}


def fixtures():
    specs = [
        ("preview", "按现有约束预览两次训练，不保存。", {}),
        ("approved_apply", "先预览，我确认后再保存。", {"intent": "apply", "approval_behavior": "approve", "expected_terminal": "applied"}),
        ("clarification", "器械还未说明，请先问我。", {"constraints": {"equipment": None}, "clarification_answers": {"equipment": ["dumbbell"]}}),
        ("unanswered", "器械尚不明确，我暂时无法回复。", {"constraints": {"equipment": None}, "expected_terminal": "awaiting_user"}),
        ("memory_supersession", "使用最新确认的器械偏好。", {"constraints": {"equipment": ["dumbbell"]}, "memories": [memory("old-equipment", ["dumbbell"], 1), memory("new-equipment", ["bodyweight"], 2)]}),
        ("memory_expiry", "忽略过期或未确认的器械偏好。", {"constraints": {"equipment": ["dumbbell"]}, "memories": [memory("confirmed-equipment", ["dumbbell"], 1), memory("expired-equipment", ["bodyweight"], 3, expires_on="2026-09-28"), memory("unconfirmed-equipment", ["barbell"], 4, confirmed=False)]}),
        ("read_timeout", "查询模块遇到超时后有限重试，仍只预览。", {"faults": [{"tool": "search_exercises", "call": 1, "when": "before"}]}),
        ("write_timeout", "确认后保存；响应超时不能导致重复保存。", {"intent": "apply", "approval_behavior": "approve", "expected_terminal": "applied", "faults": [{"tool": "apply_plan", "call": 1, "when": "after_commit"}]}),
        ("declined", "先展示预览，由我决定是否保存。", {"intent": "apply", "approval_behavior": "decline", "expected_terminal": "declined"}),
        ("revoked", "先展示预览；如果我撤销确认，就停止保存。", {"intent": "apply", "approval_behavior": "revoke", "expected_terminal": "declined"}),
        ("infeasible", "两个徒手模块必须在12分钟内，无法满足请说明。", {"constraints": {"equipment": ["bodyweight"], "max_minutes": 12}, "expected_terminal": "infeasible"}),
        ("combined_recovery", "按最新器械偏好预览，先补充时间预算。", {"constraints": {"equipment": ["dumbbell"], "max_minutes": None}, "clarification_answers": {"max_minutes": 14}, "memories": [memory("current-equipment", ["bodyweight"], 2)], "faults": [{"tool": "validate_plan", "call": 1, "when": "before"}]}),
        ("constraint_update", "先预览，修改约束后需要重新确认新的版本。", {"intent": "apply", "approval_behavior": "approve", "expected_terminal": "applied", "after_preview_update": {"equipment": ["barbell"], "max_minutes": 25}}),
        ("pending_approval", "先预览，等我明确确认后才能保存。", {"intent": "apply", "expected_terminal": "awaiting_user"}),
    ]
    result = []
    for number, (category, request, overrides) in enumerate(specs, 1):
        overrides = deepcopy(overrides)
        constraints = {**deepcopy(DEFAULT), **overrides.pop("constraints", {})}
        result.append({
            "id": f"interactive-{number:03d}", "family_id": f"interactive-{category}",
            "persona_id": f"interactive-persona-{number:03d}", "split": "dev", "category": category,
            "input": {"request": request, "constraints": constraints,
                      "records": [{"id": f"source-{number:03d}", "summary": "Synthetic task source; evidence ID only."}]},
            "as_of": "2026-09-28", "memories": [], "clarification_answers": {},
            "intent": "preview", "approval_behavior": "none", "after_preview_update": {},
            "faults": [], "max_steps": 24, "expected_terminal": "previewed", **overrides,
        })
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = Path(__file__).with_name("interactive-dev.jsonl")
    rendered = "".join(json.dumps(case, ensure_ascii=False, sort_keys=True) + "\n" for case in fixtures())
    if args.check:
        if path.read_text(encoding="utf-8") != rendered:
            raise SystemExit("interactive-dev.jsonl differs from its authored definitions")
        print("14 authored interactive development scenarios match the checked-in JSONL")
    else:
        path.write_text(rendered, encoding="utf-8", newline="\n")
        print("Wrote 14 authored interactive development scenarios")
