"""End-to-end behavior of the request-sheet executor flows."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base
from app.intents.executor import execute
from app.intents.parser import Intent, IntentKind
from app.models import (
    Gate,
    GatePermission,
    GateRequest,
    GateStatus,
    RequestStatus,
    User,
    UserRole,
)
from app.security import hash_password


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        yield s
    await engine.dispose()


async def _seed(session) -> tuple[User, User, Gate]:
    """Returns (admin, requester, gate)."""
    admin = User(username="nova", password_hash=hash_password("x"), role=UserRole.admin)
    user = User(
        username="ireallyrock", password_hash=hash_password("x"), role=UserRole.user
    )
    gate = Gate(id=4, label="Rooftop Access", status=GateStatus.closed)
    session.add_all([admin, user, gate])
    await session.commit()
    await session.refresh(admin)
    await session.refresh(user)
    return admin, user, gate


async def _drain(session, user, intent) -> list[dict]:
    return [b async for b in execute(session, user, intent, llm=None)]


# ---------- request_access ----------------------------------------------------


@pytest.mark.asyncio
async def test_request_access_creates_pending_request(session):
    _, user, gate = await _seed(session)
    intent = Intent(
        kind=IntentKind.request_access,
        gate_id=gate.id,
        reason="night inspections",
        raw="request gate 4 because night inspections",
    )
    blocks = await _drain(session, user, intent)

    types = [b["type"] for b in blocks]
    assert "RequestCard" in types
    assert blocks[-1]["type"] == "Toast"
    assert blocks[-1]["props"]["variant"] == "success"

    req = (await session.scalars(GateRequest.__table__.select())).first()
    assert req is not None
    # SQLAlchemy returns row tuples for raw selects; re-query via ORM.
    rows = list(
        (await session.scalars(__import__("sqlalchemy").select(GateRequest))).all()
    )
    assert len(rows) == 1
    r = rows[0]
    assert r.requester_id == user.id
    assert r.gate_id == gate.id
    assert r.status == RequestStatus.pending
    assert r.reason == "night inspections"


@pytest.mark.asyncio
async def test_request_access_blocked_when_already_permitted(session):
    _, user, gate = await _seed(session)
    session.add(GatePermission(user_id=user.id, gate_id=gate.id))
    await session.commit()

    intent = Intent(
        kind=IntentKind.request_access, gate_id=gate.id, raw="request gate 4"
    )
    blocks = await _drain(session, user, intent)

    assert blocks[-1]["type"] == "Toast"
    assert "already have access" in blocks[-1]["props"]["text"]
    # No RequestCard should be emitted.
    assert all(b["type"] != "RequestCard" for b in blocks)


@pytest.mark.asyncio
async def test_request_access_blocked_when_pending_exists(session):
    _, user, gate = await _seed(session)
    pending = GateRequest(
        requester_id=user.id,
        gate_id=gate.id,
        reason="first try",
        status=RequestStatus.pending,
    )
    session.add(pending)
    await session.commit()

    intent = Intent(
        kind=IntentKind.request_access, gate_id=gate.id, raw="request gate 4"
    )
    blocks = await _drain(session, user, intent)

    # Surfaces the existing card and a denial toast.
    assert blocks[0]["type"] == "RequestCard"
    assert blocks[-1]["props"]["variant"] == "denied"
    assert "already pending" in blocks[-1]["props"]["text"]


@pytest.mark.asyncio
async def test_guest_cannot_request_access(session):
    _, _, gate = await _seed(session)
    guest = User(username="visitor", password_hash=hash_password("x"), role=UserRole.guest)
    session.add(guest)
    await session.commit()
    await session.refresh(guest)

    intent = Intent(
        kind=IntentKind.request_access, gate_id=gate.id, raw="request gate 4"
    )
    blocks = await _drain(session, guest, intent)

    assert blocks[-1]["type"] == "Toast"
    assert blocks[-1]["props"]["variant"] == "denied"


# ---------- approve_request ---------------------------------------------------


@pytest.mark.asyncio
async def test_approve_request_grants_permission(session):
    admin, user, gate = await _seed(session)
    pending = GateRequest(
        requester_id=user.id,
        gate_id=gate.id,
        reason="reason",
        status=RequestStatus.pending,
    )
    session.add(pending)
    await session.commit()
    await session.refresh(pending)

    intent = Intent(
        kind=IntentKind.approve_request,
        request_id=pending.id,
        raw=f"approve request {pending.id}",
    )
    blocks = await _drain(session, admin, intent)

    assert blocks[-1]["type"] == "Toast"
    assert blocks[-1]["props"]["variant"] == "success"

    await session.refresh(pending)
    assert pending.status == RequestStatus.approved
    assert pending.decided_by == admin.id

    # Permission row should now exist.
    from sqlalchemy import select

    perm = await session.scalar(
        select(GatePermission).where(
            GatePermission.user_id == user.id,
            GatePermission.gate_id == gate.id,
        )
    )
    assert perm is not None
    assert perm.granted_by == admin.id


@pytest.mark.asyncio
async def test_non_admin_cannot_approve(session):
    _, user, gate = await _seed(session)
    pending = GateRequest(
        requester_id=user.id, gate_id=gate.id, status=RequestStatus.pending
    )
    session.add(pending)
    await session.commit()
    await session.refresh(pending)

    intent = Intent(
        kind=IntentKind.approve_request, request_id=pending.id, raw="approve 1"
    )
    blocks = await _drain(session, user, intent)
    assert blocks[-1]["props"]["variant"] == "denied"
    await session.refresh(pending)
    assert pending.status == RequestStatus.pending


# ---------- deny_request ------------------------------------------------------


@pytest.mark.asyncio
async def test_deny_request_marks_denied_no_permission(session):
    admin, user, gate = await _seed(session)
    pending = GateRequest(
        requester_id=user.id, gate_id=gate.id, status=RequestStatus.pending
    )
    session.add(pending)
    await session.commit()
    await session.refresh(pending)

    intent = Intent(
        kind=IntentKind.deny_request, request_id=pending.id, raw="deny request 1"
    )
    blocks = await _drain(session, admin, intent)
    assert blocks[-1]["props"]["variant"] == "denied"

    from sqlalchemy import select

    await session.refresh(pending)
    assert pending.status == RequestStatus.denied
    perm = await session.scalar(
        select(GatePermission).where(
            GatePermission.user_id == user.id,
            GatePermission.gate_id == gate.id,
        )
    )
    assert perm is None


# ---------- cancel_request ----------------------------------------------------


@pytest.mark.asyncio
async def test_owner_can_cancel_own_pending_request(session):
    _, user, gate = await _seed(session)
    pending = GateRequest(
        requester_id=user.id, gate_id=gate.id, status=RequestStatus.pending
    )
    session.add(pending)
    await session.commit()
    await session.refresh(pending)

    intent = Intent(
        kind=IntentKind.cancel_request, request_id=pending.id, raw="cancel request 1"
    )
    blocks = await _drain(session, user, intent)
    assert blocks[-1]["props"]["variant"] == "success"
    await session.refresh(pending)
    assert pending.status == RequestStatus.cancelled


# ---------- already-decided guard ---------------------------------------------


@pytest.mark.asyncio
async def test_cannot_re_decide_already_resolved(session):
    admin, user, gate = await _seed(session)
    decided = GateRequest(
        requester_id=user.id,
        gate_id=gate.id,
        status=RequestStatus.approved,
        decided_by=admin.id,
    )
    session.add(decided)
    await session.commit()
    await session.refresh(decided)

    intent = Intent(
        kind=IntentKind.deny_request, request_id=decided.id, raw="deny request 1"
    )
    blocks = await _drain(session, admin, intent)

    assert blocks[0]["type"] == "RequestCard"
    assert blocks[-1]["props"]["variant"] == "denied"
    await session.refresh(decided)
    assert decided.status == RequestStatus.approved  # unchanged


# ---------- list_requests -----------------------------------------------------


@pytest.mark.asyncio
async def test_list_requests_for_user_returns_only_their_own(session):
    _, user, gate = await _seed(session)
    other = User(username="other", password_hash=hash_password("x"), role=UserRole.user)
    session.add(other)
    await session.commit()
    await session.refresh(other)

    session.add_all(
        [
            GateRequest(requester_id=user.id, gate_id=gate.id, reason="mine"),
            GateRequest(requester_id=other.id, gate_id=gate.id, reason="theirs"),
        ]
    )
    await session.commit()

    intent = Intent(kind=IntentKind.list_requests, raw="my requests")
    blocks = await _drain(session, user, intent)

    rl = next(b for b in blocks if b["type"] == "RequestList")
    assert rl["props"]["scope"] == "mine"
    requests = rl["props"]["requests"]
    assert len(requests) == 1
    assert requests[0]["requester"] == "ireallyrock"


# ---------- denial → request-sheet auto-trigger -------------------------------


@pytest.mark.asyncio
async def test_open_without_permission_emits_request_form(session):
    """User tries to open a gate without perm → denied GateCard + RequestForm
    + 'fill the sheet' toast. No GateRequest is created (form does that on submit)."""
    _, user, gate = await _seed(session)

    intent = Intent(kind=IntentKind.open, gate_id=gate.id, raw="open gate 4")
    blocks = await _drain(session, user, intent)

    types = [b["type"] for b in blocks]
    assert "GateCard" in types
    assert "RequestForm" in types, f"expected RequestForm, got {types}"
    # Should NOT have created a request yet — the form submission does that.
    from sqlalchemy import select

    rows = list((await session.scalars(select(GateRequest))).all())
    assert rows == []

    rf = next(b for b in blocks if b["type"] == "RequestForm")
    assert rf["props"]["gateId"] == gate.id
    assert rf["props"]["gateLabel"] == gate.label

    # Toast nudges toward the sheet.
    assert blocks[-1]["type"] == "Toast"
    assert "request sheet" in blocks[-1]["props"]["text"].lower()


@pytest.mark.asyncio
async def test_open_without_permission_with_pending_request_still_shows_form(session):
    """Pending request no longer short-circuits the form — user fills a fresh sheet either way."""
    _, user, gate = await _seed(session)
    pending = GateRequest(
        requester_id=user.id,
        gate_id=gate.id,
        reason="prior request",
        status=RequestStatus.pending,
    )
    session.add(pending)
    await session.commit()
    await session.refresh(pending)

    intent = Intent(kind=IntentKind.open, gate_id=gate.id, raw="open gate 4")
    blocks = await _drain(session, user, intent)

    types = [b["type"] for b in blocks]
    assert "RequestForm" in types
    assert "RequestCard" not in types
    assert "request sheet" in blocks[-1]["props"]["text"].lower()


@pytest.mark.asyncio
async def test_locked_gate_offers_request_sheet(session):
    """Locked gate is admin-controlled — user fills a sheet to ask for an unlock/override."""
    _, user, gate = await _seed(session)
    session.add(GatePermission(user_id=user.id, gate_id=gate.id))
    gate.status = GateStatus.locked
    await session.commit()

    intent = Intent(kind=IntentKind.open, gate_id=gate.id, raw="open gate 4")
    blocks = await _drain(session, user, intent)
    types = [b["type"] for b in blocks]
    assert "RequestForm" in types
    assert blocks[-1]["props"]["variant"] == "denied"
    assert "locked" in blocks[-1]["props"]["text"].lower()


@pytest.mark.asyncio
async def test_list_requests_admin_sees_all(session):
    admin, user, gate = await _seed(session)
    session.add(GateRequest(requester_id=user.id, gate_id=gate.id, reason="x"))
    await session.commit()

    intent = Intent(kind=IntentKind.list_requests, raw="pending requests")
    blocks = await _drain(session, admin, intent)

    rl = next(b for b in blocks if b["type"] == "RequestList")
    assert rl["props"]["scope"] == "all-pending"
    assert len(rl["props"]["requests"]) == 1
