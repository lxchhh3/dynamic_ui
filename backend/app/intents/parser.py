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
    request_access = "request_access"
    list_requests = "list_requests"
    approve_request = "approve_request"
    deny_request = "deny_request"
    cancel_request = "cancel_request"
    help = "help"
    unknown = "unknown"


@dataclass
class Intent:
    kind: IntentKind
    gate_id: int | None = None
    target_username: str | None = None
    request_id: int | None = None
    reason: str | None = None
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
    # "approve request 12" / "approve req 12" / "approve #12"
    (
        IntentKind.approve_request,
        re.compile(r"\bapprove\s+(?:request\s+|req\s+)?#?(?P<req>\d+)\b", re.I),
    ),
    # "deny request 12" / "reject request 12"
    (
        IntentKind.deny_request,
        re.compile(
            r"\b(?:deny|reject)\s+(?:request\s+|req\s+)?#?(?P<req>\d+)\b", re.I
        ),
    ),
    # "cancel request 12" / "cancel my request 12"
    (
        IntentKind.cancel_request,
        re.compile(
            r"\bcancel\s+(?:my\s+)?(?:request\s+|req\s+)?#?(?P<req>\d+)\b", re.I
        ),
    ),
    # "list requests" / "my requests" / "pending requests" / "show requests"
    (
        IntentKind.list_requests,
        re.compile(
            r"\b(?:(?:list|show|view|see)\s+(?:my\s+|pending\s+|all\s+)?requests?"
            r"|(?:my|pending|all)\s+requests?)\b",
            re.I,
        ),
    ),
    # "request gate 7" / "request access to gate 7" /
    # "request gate 7 because <reason>" / "request gate 7 reason: <reason>"
    (
        IntentKind.request_access,
        re.compile(
            r"\brequest(?:\s+access\s+(?:to|for))?\s+gate\s+(?P<gate>\d+)"
            r"(?:\s*(?:because|for|reason\s*:?)\s*(?P<reason>.+))?",
            re.I,
        ),
    ),
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
    # ── Chinese (zh-CN) variants ──────────────────────────────────────
    # "号" / "号门" / "号大门" suffix is optional; gate digits are always ASCII.
    # Two orderings:
    #   verb-first: "打开4号门" / "解锁第8门"
    #   object-first ("把" pattern): "把4号门关上" / "请把6号门打开"
    # unlock MUST come before lock so "解锁" doesn't match the "锁" alternation.
    (
        IntentKind.unlock,
        re.compile(
            r"(?:解锁|开锁)\s*(?:第\s*)?(?P<gate>\d+)\s*号?\s*(?:大门|门)?"
            r"|(?:第\s*)?(?P<gate2>\d+)\s*号?\s*(?:大门|门)\s*(?:解锁|开锁)"
        ),
    ),
    (
        IntentKind.open,
        re.compile(
            r"(?:打开|开启|开)\s*(?:第\s*)?(?P<gate>\d+)\s*号?\s*(?:大门|门)?"
            r"|(?:第\s*)?(?P<gate2>\d+)\s*号?\s*(?:大门|门)\s*(?:打开|开启)"
        ),
    ),
    (
        IntentKind.close,
        re.compile(
            r"(?:关闭|关上|关)\s*(?:第\s*)?(?P<gate>\d+)\s*号?\s*(?:大门|门)?"
            r"|(?:第\s*)?(?P<gate2>\d+)\s*号?\s*(?:大门|门)\s*(?:关闭|关上|关掉)"
        ),
    ),
    (
        IntentKind.lock,
        re.compile(
            r"(?:锁定|锁住|上锁|锁)\s*(?:第\s*)?(?P<gate>\d+)\s*号?\s*(?:大门|门)?"
            r"|(?:第\s*)?(?P<gate2>\d+)\s*号?\s*(?:大门|门)\s*(?:锁定|锁住|上锁)"
        ),
    ),
    # "申请进入4号门" / "申请4号门" / "申请4号门 因为 ..."
    (
        IntentKind.request_access,
        re.compile(
            r"申请(?:进入|访问|开门)?\s*(?:第\s*)?(?P<gate>\d+)\s*号?\s*(?:大门|门)?"
            r"(?:\s*(?:因为|理由[:：]?)\s*(?P<reason>.+))?"
        ),
    ),
    # "批准请求4" / "批准4" / "通过请求4"
    (
        IntentKind.approve_request,
        re.compile(r"(?:批准|通过|同意)(?:请求)?\s*#?(?P<req>\d+)"),
    ),
    # "拒绝请求4" / "驳回请求4"
    (
        IntentKind.deny_request,
        re.compile(r"(?:拒绝|驳回)(?:请求)?\s*#?(?P<req>\d+)"),
    ),
    # "取消请求4" / "取消我的请求4"
    (
        IntentKind.cancel_request,
        re.compile(r"取消(?:我的)?(?:请求)?\s*#?(?P<req>\d+)"),
    ),
    # "查看请求" / "我的请求" / "待审请求"
    (
        IntentKind.list_requests,
        re.compile(r"(?:查看|列出|显示)(?:我的|待审|所有|全部)?\s*请求|我的请求|待审请求"),
    ),
    # "谁能进入4号门" / "4号门的访问列表"
    (
        IntentKind.query_access,
        re.compile(
            r"谁(?:能|可以)?(?:进入|访问)\s*(?:第\s*)?(?P<gate>\d+)\s*号?\s*(?:大门|门)?"
            r"|(?:第\s*)?(?P<gate2>\d+)\s*号?\s*(?:大门|门)?\s*的?访问(?:列表|名单|权限)"
        ),
    ),
    # "列出所有门" / "查看大门" / "显示门状态"
    (
        IntentKind.list_gates,
        re.compile(r"(?:列出|显示|查看|看看)\s*(?:所有|全部)?\s*(?:大门|门)(?:\s*状态)?"),
    ),
    (IntentKind.help, re.compile(r"帮助|怎么用|你能做什么")),
]


def parse(message: str) -> Intent:
    raw = message.strip()
    for kind, pattern in _PATTERNS:
        m = pattern.search(raw)
        if not m:
            continue
        groups = m.groupdict() if m.groupdict() else {}
        # Some Chinese alternates use a second named group as fallback.
        gate_str = groups.get("gate") or groups.get("gate2")
        gate_id = int(gate_str) if gate_str else None
        target = groups.get("user")
        request_id = int(groups["req"]) if groups.get("req") else None
        reason = (groups.get("reason") or "").strip() or None
        # The "open ... for X" path maps to grant — executor will grant then open.
        return Intent(
            kind=kind,
            gate_id=gate_id,
            target_username=target,
            request_id=request_id,
            reason=reason,
            raw=raw,
        )
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
        case IntentKind.request_access:
            tail = f" — {intent.reason}" if intent.reason else ""
            return f"Submitting access request for gate {intent.gate_id}{tail}."
        case IntentKind.list_requests:
            return "Looking up access requests."
        case IntentKind.approve_request:
            return f"Approving request {intent.request_id}."
        case IntentKind.deny_request:
            return f"Denying request {intent.request_id}."
        case IntentKind.cancel_request:
            return f"Cancelling request {intent.request_id}."
        case IntentKind.help:
            return (
                "You can say things like: "
                "\"open gate 5\", \"close gate 2\", \"lock gate 8\", "
                "\"grant IReallyRock access to gate 9\", "
                "\"who can access gate 3\", \"list gates\", "
                "\"request gate 4 because need night access\", "
                "\"my requests\", \"approve request 3\", \"deny request 4\"."
            )
        case _:
            return "Sorry, I didn't understand that."
