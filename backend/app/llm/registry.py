"""Registry we expose to the LLM for the hybrid render path.

The LLM picks the primary block for a chat turn. Data-bearing props
(gate ids, statuses, user lists) are rebuilt from DB truth by the adapter —
so the prop schemas below exist so the LLM can validly *pick* the shape,
not so it can author the values.

One component per response (STATUS.md). Toast stays deterministic in the
executor; it is not exposed to the LLM.
"""

from __future__ import annotations

from typing import Any

FULL_REGISTRY: dict[str, Any] = {
    "components": [
        {
            "name": "AssistantMessage",
            "props": {
                "text": {"type": "string", "required": True},
            },
        },
        {
            "name": "Alert",
            "props": {
                "text": {"type": "string", "required": True},
            },
        },
        {
            "name": "GateCard",
            "props": {
                "id": {"type": "number", "required": True},
                "label": {"type": "string", "required": True},
                "status": {
                    "type": "string",
                    "enum": ["open", "closed", "locked"],
                    "required": True,
                },
                "animate": {
                    "type": "string",
                    "enum": ["opening", "closing", "locking", "unlocking", "denied"],
                },
            },
        },
        {
            "name": "GateGrid",
            "props": {
                "gates": {"type": "array", "required": True},
            },
        },
        {
            "name": "AccessList",
            "props": {
                "gateId": {"type": "number", "required": True},
                "gateLabel": {"type": "string", "required": True},
                "users": {"type": "array", "required": True},
            },
        },
    ],
}

DATA_BEARING: frozenset[str] = frozenset({"GateCard", "GateGrid", "AccessList"})
TEXT_BEARING: frozenset[str] = frozenset({"AssistantMessage", "Alert"})
