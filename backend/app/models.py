from datetime import datetime
from enum import Enum

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class UserRole(str, Enum):
    guest = "guest"
    user = "user"
    admin = "admin"


class GateStatus(str, Enum):
    open = "open"
    closed = "closed"
    locked = "locked"


class ActionKind(str, Enum):
    open = "open"
    close = "close"
    lock = "lock"
    unlock = "unlock"
    grant = "grant"
    revoke = "revoke"
    query = "query"


class ActionResult(str, Enum):
    success = "success"
    denied = "denied"
    error = "error"


# Stored as VARCHAR + CHECK — avoids Postgres enum-migration pain.
_UserRoleT = SAEnum(UserRole, name="user_role", native_enum=False, length=16)
_GateStatusT = SAEnum(GateStatus, name="gate_status", native_enum=False, length=16)
_ActionKindT = SAEnum(ActionKind, name="action_kind", native_enum=False, length=16)
_ActionResultT = SAEnum(ActionResult, name="action_result", native_enum=False, length=16)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[UserRole] = mapped_column(_UserRoleT, default=UserRole.user)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Gate(Base):
    __tablename__ = "gates"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(80))
    status: Mapped[GateStatus] = mapped_column(_GateStatusT, default=GateStatus.closed)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GatePermission(Base):
    __tablename__ = "gate_permissions"
    __table_args__ = (UniqueConstraint("user_id", "gate_id", name="uq_perm_user_gate"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    gate_id: Mapped[int] = mapped_column(ForeignKey("gates.id", ondelete="CASCADE"), index=True)
    granted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AccessLog(Base):
    __tablename__ = "access_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    gate_id: Mapped[int | None] = mapped_column(ForeignKey("gates.id", ondelete="SET NULL"))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[ActionKind] = mapped_column(_ActionKindT)
    result: Mapped[ActionResult] = mapped_column(_ActionResultT)
    message: Mapped[str | None] = mapped_column(String(240))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class ChatLog(Base):
    __tablename__ = "chat_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    input_text: Mapped[str] = mapped_column(String(500))
    intent_kind: Mapped[str] = mapped_column(String(32))
    outcome: Mapped[str] = mapped_column(String(16))
    response_summary: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
