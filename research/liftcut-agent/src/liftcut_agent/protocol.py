"""Explicit protocol experiments; legacy config and response replay stay unchanged."""

from copy import deepcopy
from dataclasses import asdict, dataclass

from .environment import PlanEnvironment, ToolError
from .interactive import digest
from .model_policy import ModelConfig, ModelPolicy, PolicyFailure, PROMPT, encode, parse_action

VERSION = "model-policy-v0.2"
READ_TOOLS = frozenset({"get_context", "get_memories", "search_exercises", "validate_plan"})
MAX_READ_BATCH = 4
PENDING_INSTRUCTION = "For apply intent, after a valid preview, if no external approval or decline arrives, " \
    "finish awaiting_user. That means awaiting confirmation; previewed is only for preview intent.\n"


@dataclass(frozen=True)
class ProtocolConfig(ModelConfig):
    tool_protocol: str = "single"
    prompt_revision: str = "original"

    def __post_init__(self):
        super().__post_init__()
        if self.tool_protocol not in {"single", "read_batch"}:
            raise ValueError("unknown tool protocol")
        if self.prompt_revision not in {"original", "pending_approval_v1"}:
            raise ValueError("unknown prompt revision")

    def prompt(self):
        return PROMPT + (PENDING_INSTRUCTION if self.prompt_revision == "pending_approval_v1" else "")

    def manifest(self):
        return {"adapter_version": VERSION, "config": asdict(self), "prompt_sha256": digest(self.prompt()),
                "max_read_batch": MAX_READ_BATCH, "read_batch_tools": sorted(READ_TOOLS)}


def load_config(data):
    cls = ProtocolConfig if {"tool_protocol", "prompt_revision"}.intersection(data) else ModelConfig
    return cls(**data)


def parse_read_batch(data, seen_ids, steps_remaining):
    # Use the legacy strict parser for the envelope, every ID, JSON arguments and
    # assistant content. Validate the complete batch before executing any member.
    try:
        calls = data["choices"][0]["message"]["tool_calls"]
    except (KeyError, IndexError, TypeError):
        parse_action(data, set(seen_ids))  # raises the precise legacy failure
        raise PolicyFailure("invalid_response_envelope")
    if not isinstance(calls, list) or not calls:
        parse_action(data, set(seen_ids))
    if len(calls) > MAX_READ_BATCH:
        raise PolicyFailure("read_batch_size_limit")
    if len(calls) > steps_remaining:
        raise PolicyFailure("read_batch_exceeds_remaining_steps")
    identities = set(seen_ids)
    actions, assistant = [], None
    for call in calls:
        single = deepcopy(data)
        single["choices"][0]["message"]["tool_calls"] = [call]
        action, message = parse_action(single, identities)
        if len(calls) > 1:
            if action["tool"] not in READ_TOOLS:
                raise PolicyFailure("non_read_tool_in_batch")
            try:
                PlanEnvironment._validate_action(action)
            except ToolError:
                raise PolicyFailure("invalid_read_batch_arguments") from None
        actions.append(action)
        assistant = message
    assistant["tool_calls"] = deepcopy(calls)
    seen_ids.update(identities)
    return actions, assistant


class ProtocolPolicy(ModelPolicy):
    """Serialize accepted read batches with one environment step per raw tool call.

    No API request occurs until each call has its corresponding tool response.
    User events are delivered after the complete tool response block. Mutating,
    clarification and terminal tools can only be called alone.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pending = []
        self.current_id = None
        self.events = []
        self.decoded_actions = []

    def prompt(self):
        return self.config.prompt()

    def observe(self, observation):
        if not self.messages:
            super().observe(observation)
            return
        self.messages.append({"role": "tool", "tool_call_id": self.current_id,
                              "content": encode(observation["tool_result"])})
        self.events.extend(deepcopy(observation["user_events"]))
        if not self.pending and self.events:
            self.messages.append({"role": "user", "content": encode({"user_events": self.events})})
            self.events = []

    def act(self, observation):
        self.steps_remaining = observation.get("max_steps") if not self.messages else observation["tool_result"]["steps_remaining"]
        if self.pending:
            self.observe(observation)
            self.current_id, action = self.pending.pop(0)
            return deepcopy(action)
        return super().act(observation)

    def decode(self, data):
        if self.config.tool_protocol == "read_batch":
            actions, assistant = parse_read_batch(data, self.seen_ids, self.steps_remaining)
        else:
            action, assistant = parse_action(data, self.seen_ids)
            actions = [action]
        self.decoded_actions = deepcopy(actions)
        self.pending = [(call["id"], action) for call, action in zip(assistant["tool_calls"], actions)]
        self.current_id, action = self.pending.pop(0)
        return action, assistant

    def record_action(self, record, action):
        super().record_action(record, action)
        record["actions"] = deepcopy(self.decoded_actions)
