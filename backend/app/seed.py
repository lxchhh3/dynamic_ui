"""Idempotent seed: demo users, 10 gates, sample permissions.

Run: `python -m app.seed` from backend/ with the venv active.
"""

import asyncio

from sqlalchemy import select

from .db import async_session_factory, create_all
from .models import Gate, GatePermission, GateStatus, User, UserRole
from .security import hash_password

DEMO_USERS: list[dict] = [
    {"username": "admin", "password": "admin123", "role": UserRole.admin},
    {"username": "nova", "password": "nova123", "role": UserRole.admin},
    {"username": "IReallyRock", "password": "rockrock", "role": UserRole.user},
    {"username": "morgan", "password": "morgan123", "role": UserRole.user},
    {"username": "priya", "password": "priya123", "role": UserRole.user},
    {"username": "dex", "password": "dex123", "role": UserRole.user},
    {"username": "sam", "password": "sam123", "role": UserRole.user},
    {"username": "guest", "password": "guest", "role": UserRole.guest},
    {"username": "visitor01", "password": "visitor", "role": UserRole.guest},
]

DEMO_GATES: list[dict] = [
    {"id": 1, "label": "Main Entrance", "status": GateStatus.closed},
    {"id": 2, "label": "Loading Dock", "status": GateStatus.open},
    {"id": 3, "label": "R&D Wing", "status": GateStatus.locked},
    {"id": 4, "label": "Rooftop Access", "status": GateStatus.closed},
    {"id": 5, "label": "Archive Vault", "status": GateStatus.open},
    {"id": 6, "label": "Staff Corridor", "status": GateStatus.closed},
    {"id": 7, "label": "Security Checkpoint", "status": GateStatus.closed},
    {"id": 8, "label": "Server Room", "status": GateStatus.locked},
    {"id": 9, "label": "Executive Floor", "status": GateStatus.closed},
    {"id": 10, "label": "Reception", "status": GateStatus.open},
]

# Permissions — overlapping coverage so demos show varied access.
# admins (admin, nova) bypass permissions and aren't listed here.
DEMO_PERMS: list[tuple[str, int]] = [
    ("IReallyRock", 5),
    ("IReallyRock", 6),
    ("IReallyRock", 7),
    ("IReallyRock", 8),
    ("IReallyRock", 9),
    # morgan — R&D engineer
    ("morgan", 3),
    ("morgan", 8),
    # priya — engineer + main entrance
    ("priya", 1),
    ("priya", 3),
    ("priya", 8),
    # dex — facilities/entrances
    ("dex", 1),
    ("dex", 2),
    ("dex", 6),
    ("dex", 10),
    # sam — executive floor only
    ("sam", 9),
]


async def seed() -> None:
    await create_all()

    async with async_session_factory() as session:
        # Users
        for u in DEMO_USERS:
            existing = await session.scalar(select(User).where(User.username == u["username"]))
            if existing:
                continue
            session.add(
                User(
                    username=u["username"],
                    password_hash=hash_password(u["password"]),
                    role=u["role"],
                )
            )
        await session.commit()

        # Gates — use explicit IDs so Gate 9 etc. is referenceable
        for g in DEMO_GATES:
            existing = await session.get(Gate, g["id"])
            if existing:
                continue
            session.add(Gate(id=g["id"], label=g["label"], status=g["status"]))
        await session.commit()

        # Permissions
        users_by_name = {
            u.username: u
            for u in (await session.scalars(select(User))).all()
        }
        for username, gate_id in DEMO_PERMS:
            user = users_by_name.get(username)
            if not user:
                continue
            existing = await session.scalar(
                select(GatePermission).where(
                    GatePermission.user_id == user.id, GatePermission.gate_id == gate_id
                )
            )
            if existing:
                continue
            session.add(
                GatePermission(user_id=user.id, gate_id=gate_id, granted_by=None)
            )
        await session.commit()

    print("seed ok")
    print("  users      :", ", ".join(u["username"] for u in DEMO_USERS))
    print("  gates      :", len(DEMO_GATES))
    print("  perms      :", len(DEMO_PERMS), "rows across", len({p[0] for p in DEMO_PERMS}), "users")


if __name__ == "__main__":
    asyncio.run(seed())
