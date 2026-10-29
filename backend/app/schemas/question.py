import json
import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.question import QuestionType


def _normalize_options(value: object) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            decoded = value.splitlines()
        if isinstance(decoded, list):
            value = decoded
        elif isinstance(decoded, str):
            value = decoded.splitlines()
        else:
            raise ValueError("Multiple-choice options must be a list of strings")
    if not isinstance(value, list) or not all(isinstance(option, str) for option in value):
        raise ValueError("Multiple-choice options must be a list of strings")

    options = [
        re.sub(r"^\s*[A-Z][.)]\s*", "", option, flags=re.IGNORECASE).strip()
        for option in value
    ]
    return options


def _normalize_correct_answers(value: object) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            decoded = value.replace(";", ",").split(",")
        if isinstance(decoded, list):
            value = decoded
        elif isinstance(decoded, str):
            value = decoded.replace(";", ",").split(",")
        else:
            raise ValueError("Multiple-choice correct answers must be a list of option letters")
    if not isinstance(value, list) or not all(isinstance(answer, str) for answer in value):
        raise ValueError("Multiple-choice correct answers must be a list of option letters")
    return [answer.strip().upper() for answer in value if answer.strip()]


def validate_objective_configuration(
    question_type: QuestionType,
    mc_options: list[str] | None,
    mc_correct_answers: list[str] | None,
    mc_allow_multiple: bool,
    short_answer: str | None,
) -> None:
    if question_type == QuestionType.multiple_choice:
        options = mc_options or []
        answers = mc_correct_answers or []
        if len(options) < 2 or any(not option for option in options):
            raise ValueError("Multiple-choice questions need at least two non-empty options")
        if len(options) > 26:
            raise ValueError("Multiple-choice questions can have at most 26 options")
        if len(answers) != len(set(answers)):
            raise ValueError("Correct answer letters must not be duplicated")
        valid_letters = {chr(ord("A") + index) for index in range(len(options))}
        if not answers or any(answer not in valid_letters for answer in answers):
            raise ValueError("Correct answers must reference configured options")
        if not mc_allow_multiple and len(answers) != 1:
            raise ValueError("Single-answer questions must have exactly one correct option")
    elif question_type == QuestionType.short_answer and not (short_answer or "").strip():
        raise ValueError("Short-answer questions need an expected answer")


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
    mc_options: list[str] | None = Field(default=None, description="Options for multiple-choice questions")
    mc_correct_answers: list[str] | None = Field(default=None, description="Correct option letters")
    mc_allow_multiple: bool = False
    short_answer: str | None = Field(default=None, description="Expected answer for short answer questions")
    show_result_to_student: bool = True

    @field_validator("mc_options", mode="before")
    @classmethod
    def normalize_options(cls, value: object) -> list[str] | None:
        return _normalize_options(value)

    @field_validator("mc_correct_answers", mode="before")
    @classmethod
    def normalize_correct_answers(cls, value: object) -> list[str] | None:
        return _normalize_correct_answers(value)

    @model_validator(mode="after")
    def validate_objective_question(self):
        validate_objective_configuration(
            self.question_type,
            self.mc_options,
            self.mc_correct_answers,
            self.mc_allow_multiple,
            self.short_answer,
        )
        return self


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
    mc_options: list[str] | None = Field(default=None, description="Options for multiple-choice questions")
    mc_correct_answers: list[str] | None = Field(default=None, description="Correct option letters")
    mc_allow_multiple: bool | None = None
    short_answer: str | None = Field(default=None, description="Expected answer for short answer questions")
    show_result_to_student: bool | None = None

    @field_validator("mc_options", mode="before")
    @classmethod
    def normalize_options(cls, value: object) -> list[str] | None:
        return _normalize_options(value)

    @field_validator("mc_correct_answers", mode="before")
    @classmethod
    def normalize_correct_answers(cls, value: object) -> list[str] | None:
        return _normalize_correct_answers(value)


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
    mc_options: list[str] | None = None
    mc_allow_multiple: bool = False
    show_result_to_student: bool = True
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("mc_options", mode="before")
    @classmethod
    def normalize_options(cls, value: object) -> list[str] | None:
        return _normalize_options(value)


class TeacherQuestionResponse(QuestionResponse):
    mc_correct_answers: list[str] | None = None
    short_answer: str | None = None

    @field_validator("mc_correct_answers", mode="before")
    @classmethod
    def normalize_correct_answers(cls, value: object) -> list[str] | None:
        return _normalize_correct_answers(value)