"""Replay-verified development decisions for testing an SFT data pipeline.

Positive episode selection is outcome filtering, not independent annotation.
Each row teaches only the final assistant decision; earlier turns are context.
"""

from collections import Counter
from copy import deepcopy
from pathlib import Path

from .benchmark import read_json, read_jsonl
from .interactive import digest
from .run_audit import audit_run

VERSION = "development-decisions-v0.1"


def normalize_messages(messages):
    result = deepcopy(messages)
    for message in result:
        for call in message.get("tool_calls", []):
            arguments = call["function"]["arguments"]
            if isinstance(arguments, str):
                call["function"]["arguments"] = read_json(arguments)
    return result


def export_decisions(run_dir: Path, scenarios, catalog, **hashes):
    audit = audit_run(run_dir, scenarios, catalog, **hashes)
    known = {scenario["id"]: scenario for scenario in scenarios}
    if any(known[identity]["split"] != "dev" for identity in audit["scenario_ids"]):
        raise ValueError("smoke exporter accepts development data only; never export held-out targets")
    episodes = read_jsonl(run_dir / "episodes.jsonl")
    rows, excluded, included, excluded_decisions = [], [], [], []
    for episode in episodes:
        score = episode["trace"]["score"]
        if not score["passed"] or episode["policy_failure"] is not None:
            excluded.append({"scenario_id": episode["scenario_id"], "policy_failure": episode["policy_failure"],
                             "issues": score["issues"]})
            continue
        scenario = known[episode["scenario_id"]]
        included.append(scenario["id"])
        agent_events = [event for event in episode["trace"]["events"] if event["actor"] == "agent"]
        cursor = 0
        for index, call in enumerate(episode["calls"]):
            if call["failure"] is not None:
                raise ValueError("successful episode contains a failed model response")
            raw = read_json(call["response"]["body"])["choices"][0]["message"]
            target = {"role": "assistant", "content": raw.get("content"), "tool_calls": raw["tool_calls"]}
            if raw.get("reasoning_content"):
                raise ValueError("reasoning targets need a separately reviewed export contract")
            observations = agent_events[cursor:cursor + len(raw["tool_calls"])]
            cursor += len(raw["tool_calls"])
            rejected = [event for event in observations if
                        (not event["observation"]["ok"] and event["observation"]["error"]["code"] != "tool_timeout")
                        or (event["action"]["tool"] == "validate_plan" and event["observation"]["ok"]
                            and not event["observation"]["result"]["valid"])]
            if rejected:
                # Keep mistakes in later contexts so repair can be learned, but
                # do not label a known-invalid decision as a positive target.
                excluded_decisions.append({"scenario_id": scenario["id"], "source_call_index": index,
                                           "reason": "tool_rejection_or_invalid_candidate"})
                continue
            messages = normalize_messages([*call["request"]["messages"], target])
            rows.append({"format_version": VERSION, "purpose": "development_pipeline_smoke_only",
                         "source_run_id": audit["run_id"], "source_episode_id": episode["trace"]["episode_id"],
                         "source_call_index": index, "source_response_sha256": digest(call["response"]),
                         "scenario_id": scenario["id"], "family_id": scenario["family_id"],
                         "persona_id": scenario["persona_id"], "split": scenario["split"],
                         "category": scenario["category"], "episode_tool_errors": score["tool_errors"],
                         "episode_clean_completion": score["clean_completion"],
                         "messages": messages, "tools": deepcopy(call["request"]["tools"]),
                         "assistant_target_index": len(messages) - 1, "loss_scope": "final_assistant_only"})
    summary = {"format_version": VERSION, "scope": "verified successful development decisions; not training or held-out evaluation",
               "source_run_id": audit["run_id"], "source_episodes_sha256": audit["episodes_sha256"],
               "source_model": audit["requested_model"], "source_mode": audit["mode"],
               "selected_episodes": len(episodes), "included_scenario_ids": included, "excluded": excluded,
               "excluded_decisions": excluded_decisions,
               "decision_rows": len(rows), "families": sorted({row["family_id"] for row in rows}),
               "decisions_by_category": dict(Counter(row["category"] for row in rows)),
               "recovery_episode_ids": [episode["scenario_id"] for episode in episodes
                   if episode["scenario_id"] in included and episode["trace"]["score"]["tool_errors"]],
               "rows_digest": digest(rows), "tokenizer_masks_verified": False,
               "training_readiness": "blocked_on_independent_labels_grouped_splits_and_model_specific_validation"}
    return summary, rows


def target_tokens(row, tokenizer, *, max_length=8192):
    """Create final-decision labels only after verifying the template prefix.

    Never truncate targets, assume token counts from string length, or supervise
    history/tool outputs. Reject templates where the generation prefix changes
    upon appending the target. Includes the target's terminal token(s).
    """
    messages = row["messages"]
    if (not messages or row["loss_scope"] != "final_assistant_only"
            or row["assistant_target_index"] != len(messages) - 1 or messages[-1]["role"] != "assistant"):
        raise ValueError("invalid final assistant target")
    prefix = tokenizer.apply_chat_template(messages[:-1], tools=row["tools"], tokenize=True, add_generation_prompt=True)
    full = tokenizer.apply_chat_template(messages, tools=row["tools"], tokenize=True, add_generation_prompt=False)
    if not isinstance(prefix, list) or not isinstance(full, list) or full[:len(prefix)] != prefix:
        raise ValueError("chat template is not prefix-stable for this decision")
    if len(full) <= len(prefix):
        raise ValueError("empty assistant supervision")
    if len(full) > max_length:
        raise ValueError("decision exceeds max_length; refusing silent truncation")
    return {"input_ids": full, "attention_mask": [1] * len(full),
            "labels": [-100] * len(prefix) + full[len(prefix):], "prompt_tokens": len(prefix),
            "target_tokens": len(full) - len(prefix)}
