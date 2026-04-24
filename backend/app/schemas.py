from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from .models import GateStatus, UserRole


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    role: UserRole
    created_at: datetime


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_]+$")
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    token: str
    user: UserOut


class GateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: str
    status: GateStatus


class GateAccessOut(BaseModel):
    gate: GateOut
    users: list[UserOut]


class GrantIn(BaseModel):
    username: str
