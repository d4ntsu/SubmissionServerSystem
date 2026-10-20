from datetime import datetime

from pydantic import BaseModel, Field

from app.models.exam import ExamStatus


class ExamCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int | None = None


class ExamUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int | None = None
    status: ExamStatus | None = None


class ExamResponse(BaseModel):
    id: int
    title: str
    description: str
    status: ExamStatus
    teacher_id: int
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}