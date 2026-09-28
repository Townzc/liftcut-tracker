"""Offline task definitions and typed tools for interactive plan adjustment.

Fixtures, simulator answers, faults and terminal labels are harness-owned. Only
reset observations and tool/user messages may cross the policy boundary.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import date
import hashlib
import json
from typing import Any

from .benchmark import FIELDS, _require, feasible, missing_fields, validate_cases, validate_inputs

VERSION = "interactive-v0.1"
OUTCOMES = {"previewed", "applied", "infeasible", "awaiting_user", "declined"}


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    allow_nan=False, separators=(",", ":")).encode()).hexdigest()


def resolved_inputs(inputs: dict, memories: list[dict], as_of: str,
                    answers: dict | None = None) -> dict:
    """Apply highest confirmed, unexpired revision per field, then user answers."""
    result = deepcopy(inputs)
    selected = {}
    for memory in memories:
        if not memory["confirmed"] or (memory["expires_on"] and memory["expires_on"] <= as_of):
            continue
        field = memory["field"]
        if field not in selected or selected[field]["revision"] < memory["revision"]:
            selected[field] = memory
    for field, memory in selected.items():
        result["constraints"][field] = deepcopy(memory["value"])
        if field not in (answers or {}):
            result["records"].append({"id": memory["id"], "summary": f"Confirmed preference: {field}"})
    result["constraints"].update(deepcopy(answers or {}))
    return result


def proposal_case(inputs: dict, catalog: dict) -> dict:
    validate_inputs(inputs, catalog)
    expected = ("request_clarification" if missing_fields(inputs) else
                "propose_plan" if feasible(inputs, catalog) else "report_infeasible")
    return {"id": "contract", "family_id": "contract", "persona_id": "contract", "split": "dev",
            "category": "interactive", "input": inputs, "expected_action": expected}


def _tool(name: str, description: str, properties: dict) -> dict:
    return {"name": name, "description": description, "parameters": {
        "type": "object", "properties": properties, "required": list(properties),
        "additionalProperties": False}}


STRING = {"type": "string", "minLength": 1}
STRINGS = {"type": "array", "items": STRING, "uniqueItems": True}
PLAN = {"type": "object", "properties": {
    "action": {"type": "string", "enum": ["propose_plan"]},
    "sessions": {"type": "array", "items": {"type": "object", "properties": {
        "day": STRING, "exercise_ids": STRINGS}, "required": ["day", "exercise_ids"],
        "additionalProperties": False}},
    "evidence_ids": STRINGS}, "required": ["action", "sessions", "evidence_ids"],
    "additionalProperties": False}
TOOLS = [
    _tool("get_context", "Read profile constraints, source records, active plan and context revision. User corrections override memories.", {}),
    _tool("get_memories", "Read preference records. Use the highest confirmed revision per field only if expires_on is absent or later than as_of.", {}),
    _tool("search_exercises", "List artificial blocks for requested equipment. Availability is not permission to use them in a plan.", {"equipment": STRINGS}),
    _tool("request_clarification", "Request missing required constraints from the user. Answers may not arrive.", {"fields": STRINGS}),
    _tool("validate_plan", "Check a proposal against current effective constraints without changing state.", {"plan": PLAN}),
    _tool("propose_plan", "Store a validated preview, superseding older previews and approvals. This does not apply the plan.", {"plan": PLAN}),
    _tool("apply_plan", "Apply the exact current proposal only after an external user approval. Reuse the idempotency key after a timeout.", {"proposal_id": STRING, "idempotency_key": STRING}),
    _tool("finish", "End the episode. The evaluator independently checks state; declaring success does not establish it.", {"outcome": {"type": "string", "enum": sorted(OUTCOMES)}}),
]
TOOL_NAMES = {tool["name"] for tool in TOOLS}


def validate_scenarios(scenarios: list[dict], catalog: dict) -> None:
    _require(bool(scenarios), "no interactive scenarios")
    base_cases = []
    identities = set()
    for scenario in scenarios:
        _require(set(scenario) == {"id", "family_id", "persona_id", "split", "category", "input",
                                  "as_of", "memories", "clarification_answers", "intent",
                                  "approval_behavior", "after_preview_update", "faults", "max_steps", "expected_terminal"},
                 "invalid interactive scenario fields")
        for field in ("id", "family_id", "persona_id", "category"):
            _require(isinstance(scenario[field], str) and bool(scenario[field].strip()), f"invalid {field}")
        _require(scenario["id"] not in identities, "duplicate interactive scenario")
        identities.add(scenario["id"])
        _require(isinstance(scenario["as_of"], str), "invalid as_of")
        _require(date.fromisoformat(scenario["as_of"]).isoformat() == scenario["as_of"], "noncanonical as_of")
        _require(scenario["intent"] in ("preview", "apply"), "invalid intent")
        _require(scenario["approval_behavior"] in ("none", "approve", "decline", "revoke"), "invalid approval behavior")
        _require(scenario["intent"] != "preview" or scenario["approval_behavior"] == "none", "preview must not simulate approval")
        _require(type(scenario["max_steps"]) is int and 1 <= scenario["max_steps"] <= 100, "invalid step limit")
        _require(isinstance(scenario["expected_terminal"], str) and scenario["expected_terminal"] in OUTCOMES,
                 "invalid terminal label")
        base = proposal_case(scenario["input"], catalog)
        base.update({key: scenario[key] for key in ("id", "family_id", "persona_id", "split", "category")})
        validate_cases([base], catalog)
        base_cases.append(base)
        memories = scenario["memories"]
        _require(isinstance(memories, list), "invalid memories")
        ids = {record["id"] for record in scenario["input"]["records"]}
        revisions = set()
        for memory in memories:
            _require(isinstance(memory, dict) and set(memory) == {"id", "field", "value", "revision", "confirmed", "expires_on"},
                     "invalid memory fields")
            _require(isinstance(memory["id"], str) and bool(memory["id"].strip()) and memory["id"] not in ids,
                     "duplicate or invalid memory id")
            ids.add(memory["id"])
            _require(isinstance(memory["field"], str) and memory["field"] in FIELDS, "invalid memory field")
            _require(type(memory["revision"]) is int and memory["revision"] > 0, "invalid memory revision")
            revision = (memory["field"], memory["revision"])
            _require(revision not in revisions, "ambiguous memory revision")
            revisions.add(revision)
            _require(type(memory["confirmed"]) is bool, "invalid memory confirmation")
            if memory["expires_on"] is not None:
                _require(isinstance(memory["expires_on"], str), "invalid memory expiry")
                _require(date.fromisoformat(memory["expires_on"]).isoformat() == memory["expires_on"], "noncanonical expiry")
            test_input = deepcopy(scenario["input"])
            test_input["constraints"][memory["field"]] = memory["value"]
            validate_inputs(test_input, catalog)
        effective = resolved_inputs(scenario["input"], memories, scenario["as_of"])
        answers = scenario["clarification_answers"]
        _require(isinstance(answers, dict) and set(answers) <= set(missing_fields(effective)), "answers must fill missing fields")
        _require(all(value is not None for value in answers.values()), "clarification answers must resolve values")
        updated = resolved_inputs(scenario["input"], memories, scenario["as_of"], answers)
        validate_inputs(updated, catalog)
        correction = scenario["after_preview_update"]
        _require(isinstance(correction, dict) and set(correction) <= FIELDS, "invalid preview correction")
        if correction:
            _require(feasible(updated, catalog), "preview correction requires an initially feasible task")
            updated = resolved_inputs(scenario["input"], memories, scenario["as_of"], {**answers, **correction})
            validate_inputs(updated, catalog)
        expected = ("awaiting_user" if missing_fields(updated) else
                    "infeasible" if not feasible(updated, catalog) else
                    "previewed" if scenario["intent"] == "preview" else
                    {"approve": "applied", "none": "awaiting_user", "decline": "declined", "revoke": "declined"}[scenario["approval_behavior"]])
        _require(scenario["expected_terminal"] == expected, "inconsistent terminal label")
        _require(isinstance(scenario["faults"], list), "invalid fault list")
        fault_ids = set()
        for fault in scenario["faults"]:
            _require(isinstance(fault, dict) and set(fault) == {"tool", "call", "when"}, "invalid fault")
            _require(isinstance(fault["tool"], str) and fault["tool"] in TOOL_NAMES - {"finish"}, "invalid fault tool")
            _require(type(fault["call"]) is int and fault["call"] >= 1, "invalid fault call index")
            _require(fault["when"] in ("before", "after_commit"), "invalid fault phase")
            _require(fault["when"] != "after_commit" or fault["tool"] == "apply_plan", "after_commit only applies to writes")
            identity = (fault["tool"], fault["call"])
            _require(identity not in fault_ids, "duplicate fault call")
            fault_ids.add(identity)
    validate_cases(base_cases, catalog)
