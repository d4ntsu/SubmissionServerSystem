from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_validator

from app.models.user import UserRole


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=4, max_length=100)
    full_name: str = Field(..., min_length=1, max_length=100)
    role: UserRole


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    full_name: str
    role: UserRole
    is_online: int = 0
    last_seen_at: datetime | None = None
    created_at: datetime | None = None

    @field_validator("last_seen_at", mode="after")
    @classmethod
    def assume_utc_for_sqlite_timestamp(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    model_config = {"from_attributes": True}
