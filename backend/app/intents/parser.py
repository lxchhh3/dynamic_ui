"""Rule-based intent parser.

*** This module is the LLM swap-in point. ***

In the target architecture, a local LLM on the backend interprets user input
and returns a structured Intent. For scenario 1 we ship a deterministic
regex recognizer over a small vocabulary so the rest of the pipeline
(authz, DB mutation, block emission) can be built and tested without the
LLM dependency.

When the LLM is wired in, replace `parse` with an async function that
prompts the model and parses its structured output into the same Intent
shape. Everything downstream (executor, block protocol) stays the same.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum


class IntentKind(str, Enum):
    open = "open"
    close = "close"
    lock = "lock"
    unlock = "unlock"
    grant = "grant"
    revoke = "revoke"
    query_access = "query_access"
    list_gates = "list_gates"
    help = "help"
    unknown = "unknown"


@dataclass
class Intent:
    kind: IntentKind
    gate_id: int | None = None
    target_username: str | None = None
    raw: str = ""


# Patterns are tried in order; first match wins. Patterns use \b for word
# boundaries and (?:...) for non-capturing groups so the numbered groups we
# do capture stay predictable.
_PATTERNS: list[tuple[IntentKind, re.Pattern[str]]] = [
    # "grant IReallyRock access to gate 9"
    (
        IntentKind.grant,
        re.compile(
            r"\bgrant\s+(?P<user>[A-Za-z0-9_]+)\s+(?:access\s+to\s+)?gate\s+(?P<gate>\d+)\b",
            re.I,
        ),
    ),
    # "revoke IReallyRock from gate 9" / "revoke IReallyRock's access to gate 9"
    (
        IntentKind.revoke,
        re.compile(
            r"\brevoke\s+(?P<user>[A-Za-z0-9_]+)(?:'s)?\s+"
            r"(?:access\s+(?:to|from)|from)\s+gate\s+(?P<gate>\d+)\b",
            re.I,
        ),
    ),
    # "open gate 9 for IReallyRock" — admin-style composite (grant + open).
    (
        IntentKind.grant,
        re.compile(
            r"\bopen\s+gate\s+(?P<gate>\d+)\s+for\s+(?P<user>[A-Za-z0-9_]+)\b",
            re.I,
        ),
    ),
    (IntentKind.open, re.compile(r"\bopen\s+gate\s+(?P<gate>\d+)\b", re.I)),
    (IntentKind.close, re.compile(r"\bclose\s+gate\s+(?P<gate>\d+)\b", re.I)),
    (
        IntentKind.lock,
        re.compile(r"\block(?:\s+down)?\s+gate\s+(?P<gate>\d+)\b", re.I),
    ),
    (IntentKind.unlock, re.compile(r"\bunlock\s+gate\s+(?P<gate>\d+)\b", re.I)),
    # "who can access gate 3" / "access list for gate 3" / "access gate 3"
    (
        IntentKind.query_access,
        re.compile(
            r"\b(?:who(?:\s+can)?\s+access|access\s+list\s+for|access\s+to)\s+gate\s+(?P<gate>\d+)\b",
            re.I,
        ),
    ),
    (
        IntentKind.list_gates,
        re.compile(r"\b(?:list|show|status(?:\s+of)?)\s+(?:all\s+)?gates?\b", re.I),
    ),
    (IntentKind.help, re.compile(r"\bhelp\b|\bwhat can (?:you|i) do\b", re.I)),
]


def parse(message: str) -> Intent:
    raw = message.strip()
    for kind, pattern in _PATTERNS:
        m = pattern.search(raw)
        if not m:
            continue
        groups = m.groupdict() if m.groupdict() else {}
        gate_id = int(groups["gate"]) if groups.get("gate") else None
        target = groups.get("user")
        # The "open ... for X" path maps to grant — executor will grant then open.
        return Intent(kind=kind, gate_id=gate_id, target_username=target, raw=raw)
    return Intent(kind=IntentKind.unknown, raw=raw)


def acknowledgement_text(intent: Intent) -> str:
    match intent.kind:
        case IntentKind.open:
            return f"Opening gate {intent.gate_id}."
        case IntentKind.close:
            return f"Closing gate {intent.gate_id}."
        case IntentKind.lock:
            return f"Locking gate {intent.gate_id}."
        case IntentKind.unlock:
            return f"Unlocking gate {intent.gate_id}."
        case IntentKind.grant:
            if intent.target_username and intent.gate_id:
                return (
                    f"Granting {intent.target_username} access to gate {intent.gate_id}"
                    + (" and opening it." if "open" in intent.raw.lower() else ".")
                )
            return "Granting access."
        case IntentKind.revoke:
            return f"Revoking {intent.target_username} from gate {intent.gate_id}."
        case IntentKind.query_access:
            return f"Looking up who can access gate {intent.gate_id}."
        case IntentKind.list_gates:
            return "Listing all gates."
        case IntentKind.help:
            return (
                "You can say things like: "
                "\"open gate 5\", \"close gate 2\", \"lock gate 8\", "
                "\"grant IReallyRock access to gate 9\", "
                "\"who can access gate 3\", \"list gates\"."
            )
        case _:
            return "Sorry, I didn't understand that."
