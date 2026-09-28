"""Bounded HTTP transport and an explicitly synthetic protocol smoke double."""

from copy import deepcopy
import http.client
import ipaddress
import json
import socket
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .model_policy import ModelConfig, Reply, encode
from .workflow import FixedWorkflow


def endpoint_url(base_url: str) -> str:
    parsed = urlsplit(base_url)
    if (not parsed.hostname or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment or any(char.isspace() for char in base_url)):
        raise ValueError("endpoint must not contain credentials, query, fragment or whitespace")
    local = parsed.hostname == "localhost"
    try:
        local = local or ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        pass
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
        raise ValueError("HTTPS required except for explicit loopback endpoints")
    parsed.port  # validate malformed ports before any request
    return base_url.rstrip("/") + "/chat/completions"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HttpTransport:
    """No HTTP/SDK retries, no redirects; credentials never enter request artifacts."""

    def __init__(self, base_url: str, api_key: str, config: ModelConfig):
        self.url = endpoint_url(base_url)
        if (not isinstance(api_key, str) or not api_key or not api_key.isascii()
                or any(ord(char) < 33 or ord(char) > 126 for char in api_key)):
            raise ValueError("a nonempty API key environment variable is required")
        self._key = api_key
        self.config = config
        self._opener = build_opener(NoRedirect())

    def complete(self, payload: dict) -> Reply:
        start = time.monotonic()
        request = Request(self.url, data=encode(payload).encode("utf-8"), method="POST",
                          headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._key}"})
        try:
            try:
                response = self._opener.open(request, timeout=self.config.timeout_seconds)
            except HTTPError as error:
                response = error
            with response:
                body = response.read(self.config.max_response_bytes + 1)
                too_large = len(body) > self.config.max_response_bytes
                text = body[:self.config.max_response_bytes].decode("utf-8", errors="replace")
                # Also redact if an error page echoes a JSON-escaped credential.
                for secret in (self._key, json.dumps(self._key)[1:-1]):
                    text = text.replace(secret, "[REDACTED]")
                return Reply(text, response.code, "response_size_limit" if too_large else None,
                             time.monotonic() - start)
        except (TimeoutError, socket.timeout):
            return Reply(None, None, "transport_timeout", time.monotonic() - start)
        except URLError as error:
            code = "transport_timeout" if isinstance(error.reason, (TimeoutError, socket.timeout)) else "transport_error"
            return Reply(None, None, code, time.monotonic() - start)
        except (OSError, http.client.HTTPException):
            return Reply(None, None, "transport_error", time.monotonic() - start)


class MockWorkflowTransport:
    """Uses only the wire messages to wrap the fixed workflow in mock API replies.

    Its usage counters and latency are synthetic. It is not a model baseline.
    """

    def __init__(self):
        self.workflow = FixedWorkflow()
        self.number = 0

    def complete(self, payload: dict) -> Reply:
        self.number += 1
        messages = payload["messages"]
        if self.number == 1:
            observation = json.loads(messages[-1]["content"])
            observation["tools"] = [deepcopy(tool["function"]) for tool in payload["tools"]]
        else:
            user_events = json.loads(messages[-1]["content"])["user_events"] if messages[-1]["role"] == "user" else []
            tool = messages[-2] if user_events else messages[-1]
            observation = {"tool_result": json.loads(tool["content"]), "user_events": user_events}
        action = self.workflow.act(observation)
        data = {"id": f"mock-{self.number}", "model": "mock-workflow", "choices": [{
            "index": 0, "finish_reason": "tool_calls", "message": {"role": "assistant", "content": None,
            "tool_calls": [{"id": f"mock-call-{self.number}", "type": "function", "function": {
                "name": action["tool"], "arguments": encode(action["arguments"])}}]}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}}
        return Reply(encode(data))
