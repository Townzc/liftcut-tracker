"""Local Qwen tool-call serialization; strict parsing without repairing model text."""

import re
import time

from .benchmark import read_json
from .model_policy import Reply, encode
from .trajectories import normalize_messages


def parse_tool_text(text, request_number):
    text = text.strip()
    if text.endswith("<|im_end|>"):
        text = text[:-len("<|im_end|>")].strip()
    matches = list(re.finditer(r"<tool_call>\s*(.*?)\s*</tool_call>", text, re.DOTALL))
    if not matches or re.sub(r"<tool_call>\s*.*?\s*</tool_call>", "", text, flags=re.DOTALL).strip():
        raise ValueError("non-tool text or incomplete tool call")
    if len(matches) > 4:
        raise ValueError("too many tool calls")
    calls = []
    for index, match in enumerate(matches):
        item = read_json(match.group(1))
        if (not isinstance(item, dict) or set(item) != {"name", "arguments"}
                or not isinstance(item["name"], str) or not item["name"]
                or not isinstance(item["arguments"], dict)):
            raise ValueError("invalid Qwen tool object")
        calls.append({"id": f"qwen-{request_number}-{index}", "type": "function",
                      "function": {"name": item["name"], "arguments": encode(item["arguments"])}})
    return calls


class QwenTransport:
    def __init__(self, model, tokenizer, config, on_generation, max_context=4096):
        self.model, self.tokenizer, self.config = model, tokenizer, config
        self.on_generation, self.max_context = on_generation, max_context
        self.number = 0

    def complete(self, payload):
        import torch
        self.number += 1
        start = time.monotonic()
        ids = self.tokenizer.apply_chat_template(normalize_messages(payload["messages"]),
            tools=payload["tools"], tokenize=True, add_generation_prompt=True)
        if len(ids) + self.config.max_output_tokens > self.max_context:
            return Reply(None, None, "context_limit", time.monotonic() - start)
        input_ids = torch.tensor([ids], device="cuda")
        with torch.inference_mode():
            generated = self.model.generate(input_ids=input_ids, attention_mask=torch.ones_like(input_ids),
                max_new_tokens=self.config.max_output_tokens, do_sample=False, use_cache=True,
                pad_token_id=self.tokenizer.eos_token_id)
        output_ids = generated[0, len(ids):].tolist()
        raw = self.tokenizer.decode(output_ids, skip_special_tokens=False)
        ended = bool(output_ids) and output_ids[-1] == self.tokenizer.eos_token_id
        error = None
        try:
            calls = parse_tool_text(raw, self.number) if ended else []
        except ValueError as exc:
            calls, error = [], str(exc)
        # Invalid text is kept verbatim in content and fails the existing policy.
        message = {"role": "assistant", "content": None if calls else raw, "tool_calls": calls}
        body = {"model": self.config.model, "choices": [{"index": 0, "message": message,
                "finish_reason": "tool_calls" if calls else "stop" if ended else "length"}],
                "usage": {"prompt_tokens": len(ids), "completion_tokens": len(output_ids),
                          "total_tokens": len(ids) + len(output_ids)}}
        elapsed = time.monotonic() - start
        self.on_generation({"request_number": self.number, "raw_text": raw, "output_ids": output_ids,
                            "prompt_tokens": len(ids), "parse_error": error, "eos_reached": ended,
                            "elapsed_seconds": elapsed})
        return Reply(encode(body), 200, None, elapsed)
