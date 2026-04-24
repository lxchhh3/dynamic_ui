"""End-to-end check: the executor wires the LLM into unknown-intent turns.

If this test ever starts returning 'Sorry, I didn't understand that' despite
`llm` being non-None, the regression is in executor._yield_primary / adapter.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.intents.executor import execute
from app.intents.parser import Intent, IntentKind
from app.models import ActionKind, ActionResult, GateStatus, User, UserRole


def _fake_user() -> User:
    u = MagicMock(spec=User)
    u.id = 1
    u.username = "IReallyRock"
    u.role = UserRole.user
    return u


class _FakeSession:
    """Minimum AsyncSession surface the executor touches in an unknown-intent
    turn: add(), commit(), and a no-op scalars() wouldn't be called here."""

    def __init__(self) -> None:
        self.added: list[Any] = []
        self.commits = 0

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        self.commits += 1


async def _drain(intent: Intent, llm: Any) -> list[dict]:
    session = _FakeSession()
    user = _fake_user()
    return [b async for b in execute(session, user, intent, llm=llm)]


@pytest.mark.asyncio
async def test_unknown_intent_with_llm_yields_llm_prose_not_sorry():
    """An LLM that returns plain text (the prose-mode shape client.py wraps
    as {'text': ...}) should produce an AssistantMessage with that text — the
    'Sorry' deterministic fallback should NOT appear."""
    llm = MagicMock()
    llm.render = AsyncMock(return_value={"text": "Hi! I'm the gate assistant, how can I help?"})

    intent = Intent(kind=IntentKind.unknown, raw="hi there, how are you?")
    blocks = await _drain(intent, llm)

    # First block must be the LLM prose, not 'Sorry…'.
    assert blocks, "executor yielded nothing"
    first = blocks[0]
    assert first["type"] == "AssistantMessage", f"expected AssistantMessage, got {first!r}"
    assert "Sorry" not in first["props"]["text"], (
        f"deterministic fallback leaked through: {first['props']['text']!r}"
    )
    assert "gate assistant" in first["props"]["text"]


@pytest.mark.asyncio
async def test_unknown_intent_with_llm_down_falls_back_to_sorry():
    """When the LLM client returns None (tunnel down / failure), the
    deterministic 'Sorry' message should appear — this is the intended fallback."""
    llm = MagicMock()
    llm.render = AsyncMock(return_value=None)

    intent = Intent(kind=IntentKind.unknown, raw="gibberish blorp")
    blocks = await _drain(intent, llm)

    assert blocks[0]["type"] == "AssistantMessage"
    assert "Sorry" in blocks[0]["props"]["text"]


@pytest.mark.asyncio
async def test_unknown_intent_no_llm_configured_falls_back_to_sorry():
    """llm=None mimics LLM_RENDER_URL unset — deterministic path."""
    intent = Intent(kind=IntentKind.unknown, raw="gibberish blorp")
    blocks = await _drain(intent, None)

    assert blocks[0]["type"] == "AssistantMessage"
    assert "Sorry" in blocks[0]["props"]["text"]
