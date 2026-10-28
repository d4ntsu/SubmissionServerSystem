from datetime import datetime

from pydantic import BaseModel, Field

from app.models.question import QuestionType


class QuestionCreate(BaseModel):
    exam_id: int
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="")
    boilerplate: str = ""
    question_type: QuestionType = QuestionType.stdio
    max_score: float = Field(default=100.0, gt=0)
    allowed_languages: str = "java"
    class_name: str | None = Field(default=None, max_length=100)
    method_signature: str | None = Field(default=None, max_length=500)
    method_mode: str = Field(default="STATIC", pattern="^(STATIC|INSTANCE)$")


class QuestionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    boilerplate: str | None = None
    question_type: QuestionType | None = None
    max_score: float | None = Field(default=None, gt=0)
    allowed_languages: str | None = None
    class_name: str | None = Field(default=None, max_length=100)
    method_signature: str | None = Field(default=None, max_length=500)
    method_mode: str | None = Field(default=None, pattern="^(STATIC|INSTANCE)$")


class QuestionResponse(BaseModel):
    id: int
    exam_id: int
    title: str
    description: str
    boilerplate: str = ""
    question_type: QuestionType
    max_score: float
    allowed_languages: str
    class_name: str | None = None
    method_signature: str | None = None
    method_mode: str = "STATIC"
    created_at: datetime | None = None

    model_config = {"from_attributes": True}