from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import CurrentUser, DbSession, require_roles
from ..models import (
    AccessLog,
    ActionKind,
    ActionResult,
    Gate,
    GatePermission,
    GateStatus,
    User,
    UserRole,
)
from ..schemas import GateAccessOut, GateOut, GrantIn, UserOut

router = APIRouter(prefix="/api/gates", tags=["gates"])


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
    message: str | None = None,
) -> None:
    session.add(
        AccessLog(
            gate_id=gate_id, user_id=user_id, action=action, result=result, message=message
        )
    )


@router.get("", response_model=list[GateOut])
async def list_gates(session: DbSession) -> list[GateOut]:
    gates = (await session.scalars(select(Gate).order_by(Gate.id))).all()
    return [GateOut.model_validate(g) for g in gates]


async def _resolve_gate(session: AsyncSession, gate_id: int) -> Gate:
    gate = await session.get(Gate, gate_id)
    if not gate:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"gate {gate_id} not found")
    return gate


async def _authorize_action(
    session: AsyncSession, user: User, gate: Gate, action: ActionKind
) -> None:
    """Raise 403 on denial; log both outcomes. Caller commits."""
    reason: str | None = None

    if action in (ActionKind.lock, ActionKind.unlock, ActionKind.grant, ActionKind.revoke):
        if user.role != UserRole.admin:
            reason = f"{action.value} requires admin"
    elif action in (ActionKind.open, ActionKind.close):
        if user.role == UserRole.admin:
            reason = None
        elif user.role == UserRole.user:
            if gate.status == GateStatus.locked:
                reason = "gate is locked — admin override required"
            elif not await _has_permission(session, user.id, gate.id):
                reason = f"{user.username} lacks permission on gate {gate.id}"
        else:  # guest
            reason = "guests are read-only"

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
        raise HTTPException(status.HTTP_403_FORBIDDEN, reason)


async def _apply(
    session: AsyncSession, user: User, gate: Gate, action: ActionKind, new_status: GateStatus
) -> Gate:
    await _authorize_action(session, user, gate, action)
    gate.status = new_status
    await _log(
        session,
        gate_id=gate.id,
        user_id=user.id,
        action=action,
        result=ActionResult.success,
        message=f"{user.username} → {new_status.value}",
    )
    await session.commit()
    await session.refresh(gate)
    return gate


@router.post("/{gate_id}/open", response_model=GateOut)
async def open_gate(gate_id: int, user: CurrentUser, session: DbSession) -> GateOut:
    gate = await _resolve_gate(session, gate_id)
    gate = await _apply(session, user, gate, ActionKind.open, GateStatus.open)
    return GateOut.model_validate(gate)


@router.post("/{gate_id}/close", response_model=GateOut)
async def close_gate(gate_id: int, user: CurrentUser, session: DbSession) -> GateOut:
    gate = await _resolve_gate(session, gate_id)
    gate = await _apply(session, user, gate, ActionKind.close, GateStatus.closed)
    return GateOut.model_validate(gate)


@router.post("/{gate_id}/lock", response_model=GateOut)
async def lock_gate(gate_id: int, user: CurrentUser, session: DbSession) -> GateOut:
    gate = await _resolve_gate(session, gate_id)
    gate = await _apply(session, user, gate, ActionKind.lock, GateStatus.locked)
    return GateOut.model_validate(gate)


@router.post("/{gate_id}/unlock", response_model=GateOut)
async def unlock_gate(gate_id: int, user: CurrentUser, session: DbSession) -> GateOut:
    gate = await _resolve_gate(session, gate_id)
    gate = await _apply(session, user, gate, ActionKind.unlock, GateStatus.closed)
    return GateOut.model_validate(gate)


@router.get("/{gate_id}/access", response_model=GateAccessOut)
async def gate_access(
    gate_id: int,
    session: DbSession,
    _admin: User = Depends(require_roles(UserRole.admin)),
) -> GateAccessOut:
    gate = await _resolve_gate(session, gate_id)
    q = (
        select(User)
        .join(GatePermission, GatePermission.user_id == User.id)
        .where(GatePermission.gate_id == gate_id)
        .order_by(User.username)
    )
    users = (await session.scalars(q)).all()
    return GateAccessOut(
        gate=GateOut.model_validate(gate),
        users=[UserOut.model_validate(u) for u in users],
    )


@router.post("/{gate_id}/grant", status_code=status.HTTP_201_CREATED)
async def grant_access(
    gate_id: int,
    body: GrantIn,
    session: DbSession,
    admin: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    gate = await _resolve_gate(session, gate_id)
    target = await session.scalar(select(User).where(User.username == body.username))
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"user {body.username!r} not found")
    if target.role == UserRole.guest:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot grant access to guest accounts")
    existing = await session.scalar(
        select(GatePermission).where(
            GatePermission.user_id == target.id, GatePermission.gate_id == gate.id
        )
    )
    if existing:
        return {"granted": False, "reason": "already has access"}
    session.add(GatePermission(user_id=target.id, gate_id=gate.id, granted_by=admin.id))
    await _log(
        session,
        gate_id=gate.id,
        user_id=admin.id,
        action=ActionKind.grant,
        result=ActionResult.success,
        message=f"admin {admin.username} → {target.username}",
    )
    await session.commit()
    return {"granted": True, "user": target.username, "gate": gate.label}


@router.post("/{gate_id}/revoke", status_code=status.HTTP_200_OK)
async def revoke_access(
    gate_id: int,
    body: GrantIn,
    session: DbSession,
    admin: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    gate = await _resolve_gate(session, gate_id)
    target = await session.scalar(select(User).where(User.username == body.username))
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"user {body.username!r} not found")
    perm = await session.scalar(
        select(GatePermission).where(
            GatePermission.user_id == target.id, GatePermission.gate_id == gate.id
        )
    )
    if not perm:
        return {"revoked": False, "reason": "user had no permission"}
    await session.delete(perm)
    await _log(
        session,
        gate_id=gate.id,
        user_id=admin.id,
        action=ActionKind.revoke,
        result=ActionResult.success,
        message=f"admin {admin.username} ⊘ {target.username}",
    )
    await session.commit()
    return {"revoked": True, "user": target.username, "gate": gate.label}
