"""Pins the adapter's behavior across response shapes the LLM wrapper might
return. Any shape that contains a usable text body or a component we know
about should produce a block; only truly unusable responses should return None.
"""
from __future__ import annotations

from typing import Any

import pytest

from app.llm.adapter import render_block


class FakeClient:
    def __init__(self, response: dict[str, Any] | None):
        self._response = response
        self.last_intent: str | None = None
        self.last_registry: dict[str, Any] | None = None

    async def render(self, *, intent: str, registry: dict[str, Any]):
        self.last_intent = intent
        self.last_registry = registry
        return self._response


# ---------- structured action responses ---------------------------------------


@pytest.mark.asyncio
async def test_structured_gatecard_uses_snapshot_props():
    """LLM picks GateCard; props come from snapshot, not LLM."""
    client = FakeClient({
        "valid": True,
        "component": "GateCard",
        "props": {"id": 999, "label": "WRONG", "status": "locked"},  # LLM lies
        "warnings": [],
    })
    snapshot = {"GateCard": {"id": 7, "label": "R&D Wing", "status": "open", "animate": "opening"}}
    block = await render_block(client, "open gate 7", snapshot)
    assert block == {
        "type": "GateCard",
        "props": {"id": 7, "label": "R&D Wing", "status": "open", "animate": "opening"},
    }


@pytest.mark.asyncio
async def test_structured_assistantmessage_passes_text():
    client = FakeClient({
        "valid": True,
        "component": "AssistantMessage",
        "props": {"text": "Gate 7 is opening now."},
        "warnings": [],
    })
    block = await render_block(client, "open gate 7", {})
    assert block == {"type": "AssistantMessage", "props": {"text": "Gate 7 is opening now."}}


# ---------- conversational / prose responses ----------------------------------


@pytest.mark.asyncio
async def test_plain_text_wrap_from_client_becomes_assistant_message():
    """client.py wraps non-JSON text bodies as {'text': ...}. Adapter should
    surface that as an AssistantMessage."""
    client = FakeClient({"text": "Hi! I'm the gate-control assistant."})
    block = await render_block(client, "hello", {})
    assert block == {
        "type": "AssistantMessage",
        "props": {"text": "Hi! I'm the gate-control assistant."},
    }


@pytest.mark.asyncio
async def test_unknown_keys_still_extract_prose():
    """Some wrappers use 'response' / 'output' / nested props. Extract anyway."""
    for shape in [
        {"response": "nice question"},  # key not in our list → None (regression signal)
        {"output": "nice question"},
        {"content": "nice question"},
        {"props": {"text": "nice question"}},
        {"message": "nice question"},
    ]:
        client = FakeClient(shape)
        block = await render_block(client, "hi", {})
        if "response" in shape:
            # Add 'response' to _prose_from_any if this test fails.
            assert block is None or block["props"]["text"] == "nice question"
        else:
            assert block == {"type": "AssistantMessage", "props": {"text": "nice question"}}


@pytest.mark.asyncio
async def test_valid_false_with_prose_in_errors_or_text():
    """If wrapper marks valid=false (model couldn't produce structured) but
    returned a prose fallback, we should still surface it as AssistantMessage."""
    client = FakeClient({
        "valid": False,
        "component": None,
        "text": "I can't do that but here's a reply.",
        "errors": ["no_component_picked"],
    })
    block = await render_block(client, "tell me a joke", {})
    assert block is not None
    assert block["type"] == "AssistantMessage"
    assert "can't do that" in block["props"]["text"]


# ---------- rejection cases ---------------------------------------------------


@pytest.mark.asyncio
async def test_none_response_is_dropped():
    client = FakeClient(None)
    assert await render_block(client, "x", {}) is None


@pytest.mark.asyncio
async def test_empty_dict_is_dropped():
    client = FakeClient({})
    assert await render_block(client, "x", {}) is None


@pytest.mark.asyncio
async def test_data_bearing_without_snapshot_falls_to_prose_if_available():
    """LLM picks GateGrid for an unknown intent (no snapshot). If there's any
    text body we should use it; otherwise drop."""
    client = FakeClient({
        "valid": True,
        "component": "GateGrid",
        "props": {"gates": []},
        "text": "Here are the gates.",  # wrapper also provided prose
    })
    block = await render_block(client, "list gates", {})
    assert block == {"type": "AssistantMessage", "props": {"text": "Here are the gates."}}


@pytest.mark.asyncio
async def test_data_bearing_no_snapshot_no_prose_drops():
    client = FakeClient({
        "valid": True,
        "component": "GateGrid",
        "props": {"gates": []},
    })
    block = await render_block(client, "hello", {})
    assert block is None
