"""Glue between the executor and the LLM client.

Contract:
- Caller passes `context` (short description of what happened) and
  `entity_snapshot` — a dict keyed by component name whose value is the
  DB-truth props for that component. Only components the caller *has data
  for* should appear in the snapshot.
- The LLM picks which component to render. If it picks a data-bearing
  component (GateCard/GateGrid/AccessList), we ignore its props and
  substitute the snapshot props. If it picks a text-bearing component
  (AssistantMessage/Alert), we sanitize the text and use it.
- Returns a single block dict, or None on any failure. None = caller falls
  back to the deterministic path.

LLM dual-mode output (tuned on the 5070Ti): structured JSON when the user
wants an action, prose text when conversational. We branch on whether the
response carries a `component` field.
"""

from __future__ import annotations

import logging
from typing import Any

from .client import LLMClient
from .registry import DATA_BEARING, FULL_REGISTRY, TEXT_BEARING

log = logging.getLogger(__name__)

_TEXT_CAP = 400


def _sanitize_text(text: str, warnings: list[dict[str, Any]]) -> str | None:
    text = text.strip()
    if not text:
        return None
    for w in warnings:
        code = w.get("code")
        if code in ("dangerous_substring", "system_prompt_echo"):
            return None
    if len(text) > _TEXT_CAP:
        text = text[:_TEXT_CAP].rstrip() + "…"
    return text


def _prose_from_any(resp: dict[str, Any]) -> str | None:
    """Last-ditch: pull a text body from common shapes (prose mode, loose LLMs)."""
    for key in ("text", "message", "raw", "content", "output"):
        val = resp.get(key)
        if isinstance(val, str) and val.strip():
            return val
    props = resp.get("props")
    if isinstance(props, dict):
        for key in ("text", "message"):
            val = props.get(key)
            if isinstance(val, str) and val.strip():
                return val
    return None


async def render_block(
    client: LLMClient,
    context: str,
    entity_snapshot: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    resp = await client.render(intent=context, registry=FULL_REGISTRY)
    if not resp:
        return None

    component = resp.get("component")
    props = resp.get("props") or {}
    warnings = resp.get("warnings") or []

    # Structured text-bearing components.
    if component in TEXT_BEARING and resp.get("valid") is not False:
        text = props.get("text")
        if isinstance(text, str):
            clean = _sanitize_text(text, warnings)
            if clean:
                return {"type": component, "props": {"text": clean}}

    # Data-bearing components — ignore LLM's props, substitute snapshot.
    if component in DATA_BEARING and resp.get("valid") is not False:
        snapshot_props = entity_snapshot.get(component)
        if snapshot_props:
            return {"type": component, "props": snapshot_props}
        log.info("llm picked %s but no snapshot available; falling back", component)

    # Prose fallback: component missing / unknown / rejected above, but a text
    # body is still present anywhere in the response.
    body = _prose_from_any(resp)
    if body:
        clean = _sanitize_text(body, warnings)
        if clean:
            return {"type": "AssistantMessage", "props": {"text": clean}}

    log.info(
        "llm response rejected: component=%r valid=%r keys=%r",
        component, resp.get("valid"), list(resp.keys()),
    )
    return None
