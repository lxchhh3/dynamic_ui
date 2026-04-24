from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_session
from .models import User, UserRole
from .security import decode_jwt

DbSession = Annotated[AsyncSession, Depends(get_session)]


async def _resolve_user(
    authorization: str | None, session: AsyncSession, required: bool
) -> User | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        if required:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
        return None
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_jwt(token)
    if not payload:
        if required:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
        return None
    user = await session.get(User, int(payload["sub"]))
    if not user and required:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
    return user


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    session: DbSession = None,  # type: ignore[assignment]
) -> User:
    user = await _resolve_user(authorization, session, required=True)
    assert user is not None
    return user


async def get_current_user_optional(
    authorization: Annotated[str | None, Header()] = None,
    session: DbSession = None,  # type: ignore[assignment]
) -> User | None:
    return await _resolve_user(authorization, session, required=False)


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_current_user_optional)]


def require_roles(*roles: UserRole):
    async def _dep(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"requires one of: {', '.join(r.value for r in roles)}",
            )
        return user

    return _dep
