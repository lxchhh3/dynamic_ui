"""Takes a parsed Intent, checks auth, mutates DB, yields UI blocks.

Hybrid LLM flow per turn:
    1. deterministic DB work (auth + mutation/query)
    2. build an entity snapshot from DB rows
    3. one LLM call — it picks the primary block (prose, alert, or visual);
       data-bearing props are replaced with snapshot values
    4. yield the LLM block (or fall back to deterministic AssistantMessage +
       visual), then always yield a deterministic Toast
    5. denial paths skip the LLM entirely — safety-critical, never LLM-narrated
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..llm import LLMClient, render_block
from ..llm.profile import pick_autofill_fields
from ..profiles import MOCK_PROFILES, PROFILE_FIELDS
from ..models import (
    AccessLog,
    ActionKind,
    ActionResult,
    Gate,
    GatePermission,
    GateRequest,
    GateStatus,
    RequestStatus,
    User,
    UserRole,
)
from .parser import Intent, IntentKind, acknowledgement_text


# ---------- block factories ---------------------------------------------------


def _gate_dict(gate: Gate, animate: str | None = None) -> dict[str, Any]:
    d: dict[str, Any] = {"id": gate.id, "label": gate.label, "status": gate.status.value}
    if animate:
        d["animate"] = animate
    return d


def _msg(text: str) -> dict:
    return {"type": "AssistantMessage", "props": {"text": text}}


def _toast(variant: str, text: str) -> dict:
    return {"type": "Toast", "props": {"variant": variant, "text": text}}


def _gate_card(gate: Gate, animate: str | None = None) -> dict:
    return {"type": "GateCard", "props": _gate_dict(gate, animate=animate)}


def _gate_grid(gates: list[Gate]) -> dict:
    return {"type": "GateGrid", "props": {"gates": [_gate_dict(g) for g in gates]}}


def _access_list_props(gate: Gate, users: list[User]) -> dict[str, Any]:
    return {
        "gateId": gate.id,
        "gateLabel": gate.label,
        "users": [{"username": u.username, "role": u.role.value} for u in users],
    }


def _access_list(gate: Gate, users: list[User]) -> dict:
    return {"type": "AccessList", "props": _access_list_props(gate, users)}


def _request_dict(
    req: GateRequest, gate: Gate, requester: User, decider: User | None
) -> dict[str, Any]:
    return {
        "id": req.id,
        "gateId": gate.id,
        "gateLabel": gate.label,
        "requester": requester.username,
        "reason": req.reason,
        "status": req.status.value,
        "decidedBy": decider.username if decider else None,
        "decidedAt": req.decided_at.isoformat() if req.decided_at else None,
        "createdAt": req.created_at.isoformat() if req.created_at else None,
    }


def _request_card(
    req: GateRequest, gate: Gate, requester: User, decider: User | None
) -> dict:
    return {
        "type": "RequestCard",
        "props": _request_dict(req, gate, requester, decider),
    }


def _request_list(items: list[dict[str, Any]], scope: str) -> dict:
    return {"type": "RequestList", "props": {"scope": scope, "requests": items}}


def _request_form(gate: Gate) -> dict:
    return {
        "type": "RequestForm",
        "props": {"gateId": gate.id, "gateLabel": gate.label},
    }


async def _request_form_for_user(
    gate: Gate, user: User, llm: LLMClient | None
) -> dict:
    """Build a RequestForm block, attaching profile + LLM-picked autofill list.

    Falls back to a bare RequestForm (no profile, no autoFill) if there's no
    mock profile for the user, the LLM is disabled, or the picker call fails.
    """
    block = _request_form(gate)
    profile = MOCK_PROFILES.get(user.username, {})
    if not profile or llm is None:
        return block
    auto_fill = await pick_autofill_fields(
        llm,
        username=user.username,
        profile=profile,
        field_keys=PROFILE_FIELDS,
        request_context=f"requesting access to gate {gate.id} ({gate.label})",
    )
    block["props"]["profile"] = profile
    block["props"]["autoFill"] = auto_fill
    return block


# ---------- helpers -----------------------------------------------------------


async def _has_permission(session: AsyncSession, user_id: int, gate_id: int) -> bool:
    q = select(GatePermission).where(
        GatePermission.user_id == user_id, GatePermission.gate_id == gate_id
    )
    return (await session.scalar(q)) is not None


async def _log(
    session: AsyncSession,
    *,
    gate_id: int | None,
    user_id: int | None,
    action: ActionKind,
    result: ActionResult,
    message: str | None,
) -> None:
    session.add(
        AccessLog(
            gate_id=gate_id, user_id=user_id, action=action, result=result, message=message
        )
    )


async def _get_gate(session: AsyncSession, gate_id: int) -> Gate | None:
    return await session.get(Gate, gate_id)


def _authz_for_status_change(
    user: User, gate: Gate, action: ActionKind, has_perm: bool
) -> str | None:
    """Return denial reason or None if allowed."""
    if action in (ActionKind.lock, ActionKind.unlock):
        if user.role != UserRole.admin:
            return f"{action.value} requires admin"
        return None
    if action in (ActionKind.open, ActionKind.close):
        if user.role == UserRole.admin:
            return None
        if user.role == UserRole.user:
            if gate.status == GateStatus.locked:
                return "gate is locked — admin override required"
            if not has_perm:
                return f"{user.username} lacks permission on gate {gate.id}"
            return None
        return "guests are read-only"
    return None


# ---------- LLM bridge --------------------------------------------------------


async def _yield_primary(
    llm: LLMClient | None,
    context: str,
    snapshot: dict[str, dict[str, Any]],
    deterministic: list[dict],
) -> AsyncIterator[dict]:
    """Yield the LLM-picked block if available, else the deterministic sequence.

    `snapshot` maps component-name → DB-truth props. Only include entries for
    components the caller actually has data for. `deterministic` is the full
    fallback sequence (typically AssistantMessage + one visual) used when the
    LLM is disabled or fails.
    """
    if llm is not None:
        block = await render_block(llm, context, snapshot)
        if block is not None:
            yield block
            return
    for b in deterministic:
        yield b


# ---------- main entry --------------------------------------------------------


_NEW_STATUS: dict[ActionKind, GateStatus] = {
    ActionKind.open: GateStatus.open,
    ActionKind.close: GateStatus.closed,
    ActionKind.lock: GateStatus.locked,
    ActionKind.unlock: GateStatus.closed,
}

_ANIM: dict[ActionKind, str] = {
    ActionKind.open: "opening",
    ActionKind.close: "closing",
    ActionKind.lock: "locking",
    ActionKind.unlock: "unlocking",
}


def _context_for(intent: Intent, extra: str) -> str:
    # The wrapper has its own system prompt and is tuned for raw user input.
    # Pass the message through unchanged; `extra` is unused but kept on the
    # signature in case we need server-side context later.
    del extra
    return intent.raw


async def execute(
    session: AsyncSession, user: User, intent: Intent, llm: LLMClient | None = None
) -> AsyncIterator[dict]:
    """Yield Block dicts in stream order. Caller serializes each to SSE."""

    # --- help --------------------------------------------------------------
    if intent.kind == IntentKind.help:
        ctx = _context_for(intent, "The user asked for help.")
        async for b in _yield_primary(
            llm, ctx, {}, [_msg(acknowledgement_text(intent))]
        ):
            yield b
        yield _toast("success", "ask me to open/close/lock gates")
        return

    # --- unknown -----------------------------------------------------------
    if intent.kind == IntentKind.unknown:
        await _log(
            session,
            gate_id=None,
            user_id=user.id,
            action=ActionKind.query,
            result=ActionResult.error,
            message=f"unrecognized: {intent.raw[:180]}",
        )
        await session.commit()
        ctx = _context_for(intent, "Request not recognized as a gate action.")
        # Track whether the LLM returned a real conversational reply. If it
        # did, suppress the action-hint toast — pairing a friendly chat reply
        # with a red "I didn't catch a gate action" toast contradicts itself.
        had_chat_reply = False
        async for b in _yield_primary(
            llm, ctx, {}, [_msg(acknowledgement_text(intent))]
        ):
            yield b
            if b.get("type") == "AssistantMessage":
                text = b.get("props", {}).get("text", "")
                if text and text != acknowledgement_text(intent):
                    had_chat_reply = True
        if not had_chat_reply:
            yield _toast(
                "error", "I didn't catch a gate action in that message."
            )
        return

    # --- list gates --------------------------------------------------------
    if intent.kind == IntentKind.list_gates:
        gates = list((await session.scalars(select(Gate).order_by(Gate.id))).all())
        grid = _gate_grid(gates)
        ctx = _context_for(intent, f"Showing all {len(gates)} gates with current status.")
        snapshot = {"GateGrid": grid["props"]}
        async for b in _yield_primary(
            llm, ctx, snapshot, [_msg(acknowledgement_text(intent)), grid]
        ):
            yield b
        yield _toast("success", f"{len(gates)} gates")
        return

    # --- list requests -----------------------------------------------------
    if intent.kind == IntentKind.list_requests:
        is_admin = user.role == UserRole.admin
        scope = "all-pending" if is_admin else "mine"
        q = select(GateRequest)
        if is_admin:
            # Admin view: show pending first by default. The phrase decides whether
            # to include resolved ones. Default = all (so they can see history).
            q = q.order_by(GateRequest.status, GateRequest.created_at.desc())
        else:
            q = q.where(GateRequest.requester_id == user.id).order_by(
                GateRequest.created_at.desc()
            )
        reqs = list((await session.scalars(q)).all())

        # Bulk-load referenced gates and users so the row dicts are dense.
        gate_ids = {r.gate_id for r in reqs}
        user_ids = {r.requester_id for r in reqs} | {
            r.decided_by for r in reqs if r.decided_by
        }
        gates_by_id: dict[int, Gate] = {
            g.id: g
            for g in (
                await session.scalars(
                    select(Gate).where(Gate.id.in_(gate_ids))
                )
            ).all()
        } if gate_ids else {}
        users_by_id: dict[int, User] = {
            u.id: u
            for u in (
                await session.scalars(
                    select(User).where(User.id.in_(user_ids))
                )
            ).all()
        } if user_ids else {}

        items: list[dict[str, Any]] = []
        for r in reqs:
            g = gates_by_id.get(r.gate_id)
            requester = users_by_id.get(r.requester_id)
            decider = users_by_id.get(r.decided_by) if r.decided_by else None
            if not g or not requester:
                continue
            items.append(_request_dict(r, g, requester, decider))

        rl = _request_list(items, scope)
        ctx = _context_for(
            intent,
            f"Showing {len(items)} access request(s) for {user.username} "
            f"(scope: {scope}).",
        )
        snapshot = {"RequestList": rl["props"]}
        async for b in _yield_primary(
            llm, ctx, snapshot, [_msg(acknowledgement_text(intent)), rl]
        ):
            yield b
        if not items:
            yield _toast("success", "no requests")
        else:
            pending = sum(1 for it in items if it["status"] == "pending")
            yield _toast(
                "success",
                f"{len(items)} request{'s' if len(items) != 1 else ''}"
                + (f" · {pending} pending" if pending else ""),
            )
        return

    # --- approve / deny / cancel a request ---------------------------------
    if intent.kind in (
        IntentKind.approve_request,
        IntentKind.deny_request,
        IntentKind.cancel_request,
    ):
        if intent.request_id is None:
            yield _toast("error", "which request?")
            return
        async for b in _resolve_request(session, user, intent, llm):
            yield b
        return

    # All remaining intents reference a gate.
    if intent.gate_id is None:
        yield _toast("error", "which gate?")
        return

    gate = await _get_gate(session, intent.gate_id)
    if not gate:
        await _log(
            session,
            gate_id=None,
            user_id=user.id,
            action=ActionKind.query,
            result=ActionResult.error,
            message=f"no gate {intent.gate_id}",
        )
        await session.commit()
        yield _toast("error", f"no gate numbered {intent.gate_id}")
        return

    # --- request access ----------------------------------------------------
    if intent.kind == IntentKind.request_access:
        if user.role == UserRole.guest:
            await _log(
                session,
                gate_id=gate.id,
                user_id=user.id,
                action=ActionKind.request,
                result=ActionResult.denied,
                message="guests cannot request gate permissions",
            )
            await session.commit()
            yield _toast("denied", "guests can't request access")
            return
        if user.role == UserRole.admin:
            yield _toast("success", "admins already have access — no request needed")
            return
        # Already permitted?
        if await _has_permission(session, user.id, gate.id):
            yield _toast("success", f"you already have access to gate {gate.id}")
            return
        # Already pending?
        existing = await session.scalar(
            select(GateRequest).where(
                GateRequest.requester_id == user.id,
                GateRequest.gate_id == gate.id,
                GateRequest.status == RequestStatus.pending,
            )
        )
        if existing:
            requester = user
            req_card = _request_card(existing, gate, requester, None)
            yield req_card
            yield _toast("denied", f"already pending — request #{existing.id}")
            return

        req = GateRequest(
            requester_id=user.id,
            gate_id=gate.id,
            reason=intent.reason,
            status=RequestStatus.pending,
        )
        session.add(req)
        await _log(
            session,
            gate_id=gate.id,
            user_id=user.id,
            action=ActionKind.request,
            result=ActionResult.success,
            message=f"requested gate {gate.id}"
            + (f" — {intent.reason[:120]}" if intent.reason else ""),
        )
        await session.commit()
        await session.refresh(req)
        card = _request_card(req, gate, user, None)
        ctx = _context_for(
            intent,
            f"{user.username} submitted request #{req.id} for gate {gate.id} "
            f"({gate.label})"
            + (f" — reason: {intent.reason}" if intent.reason else "")
            + ".",
        )
        snapshot = {"RequestCard": card["props"]}
        async for b in _yield_primary(
            llm, ctx, snapshot, [_msg(acknowledgement_text(intent)), card]
        ):
            yield b
        yield _toast(
            "success", f"request #{req.id} submitted — pending admin review"
        )
        return

    # --- query access ------------------------------------------------------
    if intent.kind == IntentKind.query_access:
        if user.role != UserRole.admin:
            await _log(
                session,
                gate_id=gate.id,
                user_id=user.id,
                action=ActionKind.query,
                result=ActionResult.denied,
                message="access list requires admin",
            )
            await session.commit()
            yield _toast("denied", "only admins can view access lists")
            return
        q = (
            select(User)
            .join(GatePermission, GatePermission.user_id == User.id)
            .where(GatePermission.gate_id == gate.id)
            .order_by(User.username)
        )
        users = list((await session.scalars(q)).all())
        await _log(
            session,
            gate_id=gate.id,
            user_id=user.id,
            action=ActionKind.query,
            result=ActionResult.success,
            message=f"access list ({len(users)} users)",
        )
        await session.commit()
        al = _access_list(gate, users)
        ctx = _context_for(
            intent,
            f"Gate {gate.id} ({gate.label}) has {len(users)} users with access.",
        )
        snapshot = {"AccessList": al["props"]}
        async for b in _yield_primary(
            llm, ctx, snapshot, [_msg(acknowledgement_text(intent)), al]
        ):
            yield b
        yield _toast(
            "success", f"{len(users)} user{'s' if len(users) != 1 else ''} can access"
        )
        return

    # --- status change (open/close/lock/unlock) ----------------------------
    if intent.kind in (
        IntentKind.open,
        IntentKind.close,
        IntentKind.lock,
        IntentKind.unlock,
    ):
        action = ActionKind(intent.kind.value)
        has_perm = await _has_permission(session, user.id, gate.id)
        reason = _authz_for_status_change(user, gate, action, has_perm)
        if reason:
            await _log(
                session,
                gate_id=gate.id,
                user_id=user.id,
                action=action,
                result=ActionResult.denied,
                message=reason,
            )
            await session.commit()
            yield {"type": "GateCard", "props": {**_gate_dict(gate), "animate": "denied"}}

            # Surface the request sheet whenever a non-admin can't open/close —
            # whether the gate just lacks-perm (closed) or is admin-controlled
            # (locked). The user fills the sheet either way; no pending shortcut.
            if action in (ActionKind.open, ActionKind.close) and (
                "lacks permission" in reason or "locked" in reason
            ):
                yield await _request_form_for_user(gate, user, llm)
                if "locked" in reason:
                    yield _toast(
                        "denied",
                        "locked — fill the request sheet to ask an admin to unlock",
                    )
                else:
                    yield _toast(
                        "denied",
                        "no access — fill the request sheet below to ask an admin",
                    )
                return

            yield _toast("denied", reason)
            return

        gate.status = _NEW_STATUS[action]
        await _log(
            session,
            gate_id=gate.id,
            user_id=user.id,
            action=action,
            result=ActionResult.success,
            message=f"{user.username} → {gate.status.value}",
        )
        await session.commit()
        await session.refresh(gate)
        card = _gate_card(gate, animate=_ANIM[action])
        ctx = _context_for(
            intent,
            f"Gate {gate.id} ({gate.label}) is now {gate.status.value} "
            f"(animation: {_ANIM[action]}).",
        )
        snapshot = {"GateCard": card["props"]}
        async for b in _yield_primary(
            llm, ctx, snapshot, [_msg(acknowledgement_text(intent)), card]
        ):
            yield b
        yield _toast("success", f"gate {gate.id} {gate.status.value}")
        return

    # --- grant -------------------------------------------------------------
    if intent.kind == IntentKind.grant:
        if user.role != UserRole.admin:
            await _log(
                session,
                gate_id=gate.id,
                user_id=user.id,
                action=ActionKind.grant,
                result=ActionResult.denied,
                message="grant requires admin",
            )
            await session.commit()
            yield _toast("denied", "only admins can grant access")
            return
        if not intent.target_username:
            yield _toast("error", "grant needs a username")
            return
        target = await session.scalar(
            select(User).where(User.username == intent.target_username)
        )
        if not target:
            await _log(
                session,
                gate_id=gate.id,
                user_id=user.id,
                action=ActionKind.grant,
                result=ActionResult.error,
                message=f"no user {intent.target_username}",
            )
            await session.commit()
            yield _toast("error", f"no user named {intent.target_username!r}")
            return
        if target.role == UserRole.guest:
            yield _toast("denied", "guests can't hold gate permissions")
            return

        existing = await session.scalar(
            select(GatePermission).where(
                GatePermission.user_id == target.id, GatePermission.gate_id == gate.id
            )
        )
        if not existing:
            session.add(
                GatePermission(user_id=target.id, gate_id=gate.id, granted_by=user.id)
            )
            await _log(
                session,
                gate_id=gate.id,
                user_id=user.id,
                action=ActionKind.grant,
                result=ActionResult.success,
                message=f"admin {user.username} → {target.username}",
            )
            await session.commit()

        # Composite: "open gate N for X" — after granting, also open.
        composite_open = "open" in intent.raw.lower() and "for" in intent.raw.lower()
        if composite_open:
            gate.status = GateStatus.open
            await _log(
                session,
                gate_id=gate.id,
                user_id=user.id,
                action=ActionKind.open,
                result=ActionResult.success,
                message=f"{user.username} opened for {target.username}",
            )
            await session.commit()
            await session.refresh(gate)
            card = _gate_card(gate, animate="opening")
            ctx = _context_for(
                intent,
                f"Granted {target.username} access to gate {gate.id} "
                f"({gate.label}) and opened it.",
            )
            snapshot = {"GateCard": card["props"]}
            async for b in _yield_primary(
                llm, ctx, snapshot, [_msg(acknowledgement_text(intent)), card]
            ):
                yield b
            yield _toast(
                "success", f"{target.username} granted + gate {gate.id} open"
            )
        else:
            q = (
                select(User)
                .join(GatePermission, GatePermission.user_id == User.id)
                .where(GatePermission.gate_id == gate.id)
                .order_by(User.username)
            )
            users = list((await session.scalars(q)).all())
            al = _access_list(gate, users)
            ctx = _context_for(
                intent,
                f"Granted {target.username} access to gate {gate.id} "
                f"({gate.label}); {len(users)} users now have access.",
            )
            snapshot = {"AccessList": al["props"]}
            async for b in _yield_primary(
                llm, ctx, snapshot, [_msg(acknowledgement_text(intent)), al]
            ):
                yield b
            yield _toast("success", f"{target.username} can now access gate {gate.id}")
        return

    # --- revoke ------------------------------------------------------------
    if intent.kind == IntentKind.revoke:
        if user.role != UserRole.admin:
            await _log(
                session,
                gate_id=gate.id,
                user_id=user.id,
                action=ActionKind.revoke,
                result=ActionResult.denied,
                message="revoke requires admin",
            )
            await session.commit()
            yield _toast("denied", "only admins can revoke access")
            return
        if not intent.target_username:
            yield _toast("error", "revoke needs a username")
            return
        target = await session.scalar(
            select(User).where(User.username == intent.target_username)
        )
        if not target:
            yield _toast("error", f"no user named {intent.target_username!r}")
            return
        perm = await session.scalar(
            select(GatePermission).where(
                GatePermission.user_id == target.id, GatePermission.gate_id == gate.id
            )
        )
        if perm:
            await session.delete(perm)
            await _log(
                session,
                gate_id=gate.id,
                user_id=user.id,
                action=ActionKind.revoke,
                result=ActionResult.success,
                message=f"admin {user.username} ⊘ {target.username}",
            )
            await session.commit()
            # Refresh access list for the admin's context.
            q = (
                select(User)
                .join(GatePermission, GatePermission.user_id == User.id)
                .where(GatePermission.gate_id == gate.id)
                .order_by(User.username)
            )
            users = list((await session.scalars(q)).all())
            al = _access_list(gate, users)
            ctx = _context_for(
                intent,
                f"Revoked {target.username} from gate {gate.id} ({gate.label}); "
                f"{len(users)} users remain.",
            )
            snapshot = {"AccessList": al["props"]}
            async for b in _yield_primary(
                llm, ctx, snapshot, [_msg(acknowledgement_text(intent)), al]
            ):
                yield b
            yield _toast("success", f"{target.username} revoked from gate {gate.id}")
        else:
            yield _toast("denied", f"{target.username} had no access to gate {gate.id}")
        return

    yield _toast("error", "unhandled intent")


# ---------- request resolution -----------------------------------------------


async def _resolve_request(
    session: AsyncSession,
    user: User,
    intent: Intent,
    llm: LLMClient | None,
) -> AsyncIterator[dict]:
    """Approve / deny / cancel a GateRequest by id."""
    assert intent.request_id is not None
    req = await session.get(GateRequest, intent.request_id)
    if not req:
        yield _toast("error", f"no request #{intent.request_id}")
        return

    gate = await _get_gate(session, req.gate_id)
    requester = await session.get(User, req.requester_id)
    if not gate or not requester:
        yield _toast("error", "request references a missing gate or user")
        return

    is_admin = user.role == UserRole.admin
    is_owner = req.requester_id == user.id

    # Authz per intent kind.
    if intent.kind == IntentKind.cancel_request:
        if not is_owner and not is_admin:
            yield _toast("denied", "only the requester or an admin can cancel")
            return
        action = ActionKind.cancel
        new_status = RequestStatus.cancelled
    elif intent.kind == IntentKind.approve_request:
        if not is_admin:
            yield _toast("denied", "only admins can approve requests")
            return
        action = ActionKind.approve
        new_status = RequestStatus.approved
    elif intent.kind == IntentKind.deny_request:
        if not is_admin:
            yield _toast("denied", "only admins can deny requests")
            return
        action = ActionKind.deny
        new_status = RequestStatus.denied
    else:  # pragma: no cover — caller filters this
        yield _toast("error", "unhandled request action")
        return

    if req.status != RequestStatus.pending:
        # Surface the existing card so the user sees its current state.
        decider = (
            await session.get(User, req.decided_by) if req.decided_by else None
        )
        yield _request_card(req, gate, requester, decider)
        yield _toast(
            "denied",
            f"request #{req.id} is already {req.status.value} — no change",
        )
        return

    # Apply the decision.
    req.status = new_status
    req.decided_by = user.id
    req.decided_at = datetime.now(timezone.utc)

    # Approve auto-grants the permission (idempotent).
    if new_status == RequestStatus.approved:
        existing_perm = await session.scalar(
            select(GatePermission).where(
                GatePermission.user_id == requester.id,
                GatePermission.gate_id == gate.id,
            )
        )
        if not existing_perm:
            session.add(
                GatePermission(
                    user_id=requester.id, gate_id=gate.id, granted_by=user.id
                )
            )

    await _log(
        session,
        gate_id=gate.id,
        user_id=user.id,
        action=action,
        result=ActionResult.success,
        message=f"request #{req.id} {new_status.value} by {user.username}",
    )
    await session.commit()
    await session.refresh(req)

    decider = await session.get(User, user.id)
    card = _request_card(req, gate, requester, decider)
    verb = {
        RequestStatus.approved: "approved",
        RequestStatus.denied: "denied",
        RequestStatus.cancelled: "cancelled",
    }[new_status]
    extra = (
        " (permission granted)" if new_status == RequestStatus.approved else ""
    )
    ctx = _context_for(
        intent,
        f"Request #{req.id} for gate {gate.id} ({gate.label}) by "
        f"{requester.username} was {verb} by {user.username}{extra}.",
    )
    snapshot = {"RequestCard": card["props"]}
    async for b in _yield_primary(
        llm, ctx, snapshot, [_msg(acknowledgement_text(intent)), card]
    ):
        yield b
    yield _toast(
        "success" if new_status != RequestStatus.denied else "denied",
        f"request #{req.id} {verb}{extra}",
    )
