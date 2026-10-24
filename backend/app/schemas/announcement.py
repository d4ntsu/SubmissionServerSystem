from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class AnnouncementCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)

    @field_validator("content", mode="before")
    @classmethod
    def trim_and_reject_blank_content(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


class AnnouncementResponse(BaseModel):
    announcement_id: int = Field(validation_alias="id", serialization_alias="announcement_id")
    exam_id: int
    teacher_id: int
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}
