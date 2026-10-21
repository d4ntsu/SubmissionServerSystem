from datetime import datetime

from pydantic import BaseModel, Field

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
    created_at: datetime | None = None

    model_config = {"from_attributes": True}