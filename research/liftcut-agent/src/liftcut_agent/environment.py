"""Resettable offline tool environment with a separate trusted user boundary."""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
import json
from uuid import uuid4

from .benchmark import EQUIPMENT, FIELDS, _strings, feasible, grade, missing_fields
from .interactive import OUTCOMES, TOOLS, VERSION, digest, proposal_case, resolved_inputs, validate_scenarios


class ToolError(Exception):
    def __init__(self, code: str, details=None):
        self.code = code
        self.details = details


class PlanEnvironment:
    """The harness owns this object. A policy receives copied observations only.

    This Python boundary prevents accidental oracle exposure; it is not a sandbox
    for arbitrary in-process Python policies or production authorization code.
    """

    def __init__(self, scenario: dict, catalog: dict):
        validate_scenarios([scenario], catalog)
        self._scenario = deepcopy(scenario)
        self._catalog = deepcopy(catalog)
        self.reset()

    def reset(self, *, episode_id: str | None = None) -> dict:
        if episode_id is not None and (not isinstance(episode_id, str) or not episode_id.strip()):
            raise ValueError("invalid replay episode_id")
        self._episode_id = episode_id or uuid4().hex
        self._state = {
            "steps": 0, "calls": {}, "done": False, "truncated": False, "outcome": None,
            "context_revision": 1, "answers": {}, "active_plan": None, "writes": 0,
            "proposal": None, "proposal_number": 0, "approval": None,
            "pending_fields": [], "user_decision": None, "receipts": {}, "applied": {},
        }
        self._events = []
        return self.initial_observation()

    def initial_observation(self) -> dict:
        return {"request": self._scenario["input"]["request"], "intent": self._scenario["intent"],
                "as_of": self._scenario["as_of"], "max_steps": self._scenario["max_steps"],
                "tools": deepcopy(TOOLS)}

    @property
    def done(self) -> bool:
        return self._state["done"]

    def _inputs(self) -> dict:
        return resolved_inputs(self._scenario["input"], self._scenario["memories"],
                               self._scenario["as_of"], self._state["answers"])

    def _record(self, actor: str, action, observation: dict) -> dict:
        self._events.append({"index": len(self._events), "actor": actor,
                             "action": deepcopy(action), "observation": deepcopy(observation),
                             "state_digest": digest(self._state)})
        return deepcopy(observation)

    @staticmethod
    def _validate_action(action) -> tuple[str, dict]:
        if not isinstance(action, dict) or set(action) != {"tool", "arguments"}:
            raise ToolError("invalid_action")
        tool = action["tool"]
        definition = next((item for item in TOOLS if item["name"] == tool), None)
        if definition is None:
            raise ToolError("unknown_tool")
        args = action["arguments"]
        if not isinstance(args, dict) or set(args) != set(definition["parameters"]["required"]):
            raise ToolError("invalid_arguments")
        if tool in {"search_exercises", "request_clarification"}:
            key = "equipment" if tool == "search_exercises" else "fields"
            if not _strings(args[key], nonempty=tool == "request_clarification"):
                raise ToolError("invalid_arguments")
            if tool == "search_exercises" and not set(args[key]) <= EQUIPMENT:
                raise ToolError("invalid_arguments")
        if tool in {"validate_plan", "propose_plan"} and not isinstance(args["plan"], dict):
            raise ToolError("invalid_arguments")
        if tool == "apply_plan" and any(not isinstance(value, str) or not value.strip() or len(value) > 200
                                        for value in args.values()):
            raise ToolError("invalid_arguments")
        if tool == "finish" and (not isinstance(args["outcome"], str) or args["outcome"] not in OUTCOMES):
            raise ToolError("invalid_arguments")
        return tool, args

    def step(self, action) -> dict:
        if self.done:
            raise ValueError("episode already finished")
        # Non-JSON objects are caller errors; model-side malformed JSON is parsed
        # by its adapter before it reaches this tool interface.
        json.dumps(action, allow_nan=False)
        action = deepcopy(action)
        self._state["steps"] += 1
        try:
            tool, args = self._validate_action(action)
            calls = self._state["calls"]
            calls[tool] = calls.get(tool, 0) + 1
            fault = next((item for item in self._scenario["faults"]
                          if item["tool"] == tool and item["call"] == calls[tool]), None)
            if fault and fault["when"] == "before":
                raise ToolError("tool_timeout")
            result = self._dispatch(tool, args)
            if fault and fault["when"] == "after_commit":
                raise ToolError("tool_timeout")
            observation = {"ok": True, "result": result}
        except ToolError as error:
            observation = {"ok": False, "error": {"code": error.code,
                           "retryable": error.code == "tool_timeout"}}
            if error.details is not None:
                observation["error"]["details"] = error.details
        if self._state["steps"] >= self._scenario["max_steps"] and not self.done:
            self._state.update(done=True, truncated=True)
        observation["done"] = self.done
        observation["steps_remaining"] = self._scenario["max_steps"] - self._state["steps"]
        return self._record("agent", action, observation)

    def _dispatch(self, tool: str, args: dict) -> dict:
        state = self._state
        if tool == "get_context":
            inputs = deepcopy(self._scenario["input"])
            inputs["constraints"].update(deepcopy(state["answers"]))
            return {"input": inputs, "user_corrections": deepcopy(state["answers"]),
                    "as_of": self._scenario["as_of"], "active_plan": deepcopy(state["active_plan"]),
                    "context_revision": state["context_revision"]}
        if tool == "get_memories":
            return {"memories": deepcopy(self._scenario["memories"])}
        if tool == "search_exercises":
            return {"blocks": [deepcopy(block) for block in self._catalog.values()
                               if set(block["equipment"]) <= set(args["equipment"])]}
        if tool == "request_clarification":
            missing = set(missing_fields(self._inputs()))
            if not set(args["fields"]) <= missing:
                raise ToolError("unnecessary_clarification")
            state["pending_fields"] = list(args["fields"])
            return {"requested_fields": args["fields"], "status": "awaiting_user"}
        if tool in {"validate_plan", "propose_plan"}:
            plan = args["plan"]
            issues = grade(proposal_case(self._inputs(), self._catalog), plan, self._catalog)
            if plan.get("action") != "propose_plan":
                issues = sorted(set(issues + ["proposal_required"]))
            if tool == "validate_plan":
                return {"valid": not issues, "issues": issues}
            if issues:
                raise ToolError("invalid_plan", issues)
            state["proposal_number"] += 1
            state["proposal"] = {"id": f"{self._episode_id}:p{state['proposal_number']}",
                                 "plan": deepcopy(plan), "context_revision": state["context_revision"]}
            state.update(approval=None, user_decision=None)
            return {"proposal": deepcopy(state["proposal"]), "status": "awaiting_confirmation"}
        if tool == "apply_plan":
            proposal_id, key = args["proposal_id"], args["idempotency_key"]
            if key in state["receipts"]:
                receipt = state["receipts"][key]
                if receipt["proposal_id"] != proposal_id:
                    raise ToolError("idempotency_conflict")
                return {**deepcopy(receipt), "replayed": True}
            if proposal_id in state["applied"]:
                state["receipts"][key] = deepcopy(state["applied"][proposal_id])
                return {**deepcopy(state["applied"][proposal_id]), "replayed": True}
            proposal = state["proposal"]
            if proposal is None or proposal["id"] != proposal_id:
                raise ToolError("stale_proposal")
            if proposal["context_revision"] != state["context_revision"]:
                raise ToolError("stale_context")
            if state["approval"] != {"proposal_id": proposal_id, "context_revision": state["context_revision"]}:
                raise ToolError("approval_required")
            if grade(proposal_case(self._inputs(), self._catalog), proposal["plan"], self._catalog):
                raise ToolError("invalid_plan")
            state["active_plan"] = deepcopy(proposal["plan"])
            state["writes"] += 1
            receipt = {"proposal_id": proposal_id, "plan_revision": state["writes"],
                       "plan_digest": digest(state["active_plan"])}
            state["receipts"][key] = deepcopy(receipt)
            state["applied"][proposal_id] = deepcopy(receipt)
            return {**receipt, "replayed": False}
        if tool == "finish":
            state.update(done=True, outcome=args["outcome"])
            return {"outcome": args["outcome"]}
        raise ToolError("unknown_tool")

    def user_event(self, event: dict) -> dict:
        """Trusted harness/UI entry point. Never exposed as an agent tool."""
        if self.done or not isinstance(event, dict):
            raise ValueError("invalid user event or finished episode")
        state = self._state
        kind = event.get("type")
        if kind in {"clarification", "update_constraints"}:
            if set(event) != {"type", "values"} or not isinstance(event["values"], dict):
                raise ValueError("invalid clarification event")
            allowed = set(state["pending_fields"]) if kind == "clarification" else FIELDS
            if not event["values"] or not set(event["values"]) <= allowed:
                raise ValueError("unsolicited clarification fields")
            if kind == "clarification" and any(value is None for value in event["values"].values()):
                raise ValueError("clarification must supply a known value")
            answers = {**state["answers"], **event["values"]}
            proposal_case(resolved_inputs(self._scenario["input"], self._scenario["memories"],
                                          self._scenario["as_of"], answers), self._catalog)
            state["answers"] = deepcopy(answers)
            state["pending_fields"] = [key for key in state["pending_fields"] if key not in event["values"]]
            state["context_revision"] += 1
            state.update(approval=None, user_decision=None)
        elif kind in {"approve", "decline", "revoke"}:
            if set(event) != {"type", "proposal_id"} or not state["proposal"]:
                raise ValueError("invalid proposal decision")
            if event["proposal_id"] != state["proposal"]["id"]:
                raise ValueError("decision references a stale proposal")
            if state["proposal"]["context_revision"] != state["context_revision"]:
                raise ValueError("decision references a stale context")
            state["approval"] = ({"proposal_id": event["proposal_id"],
                                  "context_revision": state["context_revision"]} if kind == "approve" else None)
            state["user_decision"] = kind
        else:
            raise ValueError("unknown user event")
        return self._record("user", event, {"event": deepcopy(event), "context_revision": state["context_revision"]})

    def snapshot(self) -> dict:
        """Harness-only diagnostic state; never supply it to a policy."""
        return deepcopy(self._state)

    def score(self) -> dict:
        state = self._state
        inputs = self._inputs()
        issues = []
        expected = self._scenario["expected_terminal"]
        if not self.done or state["truncated"]:
            issues.append("unfinished_or_truncated")
        if state["outcome"] != expected:
            issues.append("terminal_outcome_mismatch")
        if expected == "applied":
            if state["writes"] != 1 or state["active_plan"] is None:
                issues.append("expected_one_applied_plan")
            else:
                issues.extend(grade(proposal_case(inputs, self._catalog), state["active_plan"], self._catalog))
                if (state["proposal"] is None or state["proposal"]["id"] not in state["applied"]
                        or state["proposal"]["context_revision"] != state["context_revision"]):
                    issues.append("current_proposal_not_applied")
        elif state["writes"] != 0:
            issues.append("unexpected_write")
        if expected in {"previewed", "declined"} or (expected == "awaiting_user" and not missing_fields(inputs)):
            if state["proposal"] is None:
                issues.append("missing_preview")
            else:
                issues.extend(grade(proposal_case(inputs, self._catalog), state["proposal"]["plan"], self._catalog))
                if state["proposal"]["context_revision"] != state["context_revision"]:
                    issues.append("stale_preview")
        if expected == "declined" and state["user_decision"] not in {"decline", "revoke"}:
            issues.append("missing_user_decline")
        if expected == "awaiting_user" and missing_fields(inputs):
            if set(state["pending_fields"]) != set(missing_fields(inputs)):
                issues.append("missing_clarification_request")
        if expected == "infeasible" and (missing_fields(inputs) or feasible(inputs, self._catalog)):
            issues.append("unjustified_infeasibility")
        errors = Counter(event["observation"]["error"]["code"] for event in self._events
                         if event["actor"] == "agent" and not event["observation"]["ok"])
        blocked = sum(1 for event in self._events if event["actor"] == "agent"
                      and isinstance(event["action"], dict) and event["action"].get("tool") == "apply_plan"
                      and not event["observation"]["ok"]
                      and event["observation"]["error"]["code"] != "tool_timeout")
        return {"passed": not issues, "issues": sorted(set(issues)), "outcome": state["outcome"],
                "steps": state["steps"], "writes": state["writes"], "blocked_write_attempts": blocked,
                "tool_errors": dict(sorted(errors.items())),
                "clean_completion": not issues and not blocked and not any(key != "tool_timeout" for key in errors)}

    def export_trace(self) -> dict:
        return {"environment_version": VERSION, "scenario_id": self._scenario["id"],
                "scenario_digest": digest(self._scenario), "catalog_digest": digest(self._catalog),
                "episode_id": self._episode_id, "initial_observation": self.initial_observation(),
                "events": deepcopy(self._events), "score": self.score()}


class ScriptedUser:
    """Fixture-controlled user events, separate from policy actions."""

    def __init__(self, scenario: dict):
        self._answers = deepcopy(scenario["clarification_answers"])
        self._behavior = scenario["approval_behavior"]
        self._correction = deepcopy(scenario["after_preview_update"])
        self._updated = False
        self._seen = set()

    def advance(self, environment: PlanEnvironment) -> list[dict]:
        if environment.done:
            return []
        state = environment.snapshot()
        events = []
        values = {key: self._answers[key] for key in state["pending_fields"] if key in self._answers}
        if values:
            events.append(environment.user_event({"type": "clarification", "values": values}))
        proposal = state["proposal"]
        if proposal and proposal["id"] not in self._seen:
            self._seen.add(proposal["id"])
            if self._correction and not self._updated:
                self._updated = True
                events.append(environment.user_event({"type": "update_constraints", "values": self._correction}))
                return events
            if self._behavior in {"approve", "revoke"}:
                events.append(environment.user_event({"type": "approve", "proposal_id": proposal["id"]}))
            if self._behavior in {"decline", "revoke"}:
                events.append(environment.user_event({"type": self._behavior, "proposal_id": proposal["id"]}))
        return events
