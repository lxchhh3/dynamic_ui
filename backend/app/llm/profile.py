"""LLM-driven RequestForm autofill picker.

Given a user profile and a list of form-field keys, ask the LLM which
fields it can confidently pre-fill from the profile alone. Returns a
subset of `field_keys` (or `[]` on any failure — caller falls back to
no auto-fill).

The wrapper exposes a single /render endpoint tuned for component
picking; here we abuse its chat-prose mode by sending a natural-language
prompt and parsing a JSON array out of the response. If the wrapper
replies with prose instead, we fall back to keyword-matching the field
names in the text.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from .client import LLMClient
from .registry import FULL_REGISTRY

log = logging.getLogger(__name__)

# Phrased to land in the wrapper's chat-prose path: ask for a one-line text
# answer that happens to be a JSON array. The wrapper-tuned model reliably
# returns the array as the AssistantMessage `text`.
_PROMPT_TEMPLATE = (
    "Background: user {username} just got denied on a gate access request "
    "({context}) and is being shown a 7-field request form. Their stored "
    "profile is:\n{profile_block}\n"
    "Form field keys: {field_keys_csv}. Question — which of these field keys "
    "can you reliably pre-fill straight from the profile (no fabrication)? "
    'Reply via AssistantMessage with text equal to ONLY a JSON array, '
    'e.g. ["name","employeeId"]. No explanation, no other prose.'
)


async def pick_autofill_fields(
    client: LLMClient,
    *,
    username: str,
    profile: dict[str, str],
    field_keys: list[str],
    request_context: str,
) -> list[str]:
    if not profile:
        return []

    profile_block = "\n".join(f"  - {k}: {v}" for k, v in profile.items())
    intent = _PROMPT_TEMPLATE.format(
        username=username,
        context=request_context,
        profile_block=profile_block,
        field_keys_csv=", ".join(field_keys),
    )

    try:
        resp = await client.render(intent=intent, registry=FULL_REGISTRY)
    except Exception as exc:  # noqa: BLE001 — defensive; never block the form
        log.warning("autofill picker render call failed: %s", exc)
        return []

    if not resp:
        return []

    text = _extract_text(resp)
    if not text:
        return []

    picks = _parse_json_array(text, field_keys)
    if picks:
        return picks
    # Fallback: keyword match the field keys in prose.
    return [k for k in field_keys if re.search(rf"\b{re.escape(k)}\b", text, re.I)]


def _extract_text(resp: dict[str, Any]) -> str:
    for key in ("text", "message", "raw", "content", "output"):
        v = resp.get(key)
        if isinstance(v, str) and v.strip():
            return v
    props = resp.get("props")
    if isinstance(props, dict):
        for key in ("text", "message"):
            v = props.get(key)
            if isinstance(v, str) and v.strip():
                return v
    return ""


def _parse_json_array(text: str, field_keys: list[str]) -> list[str]:
    """Find the first [...] in `text`, JSON-parse it, intersect with field_keys."""
    m = re.search(r"\[[^\[\]]*\]", text)
    if not m:
        return []
    try:
        parsed = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    allowed = set(field_keys)
    return [p for p in parsed if isinstance(p, str) and p in allowed]
