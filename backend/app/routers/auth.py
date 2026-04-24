from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..deps import CurrentUser, DbSession
from ..models import User, UserRole
from ..schemas import LoginIn, RegisterIn, TokenOut, UserOut
from ..security import create_jwt, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, session: DbSession) -> TokenOut:
    existing = await session.scalar(select(User).where(User.username == body.username))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "username already taken")
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=UserRole.user,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token = create_jwt(user.id, user.username, user.role.value)
    return TokenOut(token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, session: DbSession) -> TokenOut:
    user = await session.scalar(select(User).where(User.username == body.username))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    token = create_jwt(user.id, user.username, user.role.value)
    return TokenOut(token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
