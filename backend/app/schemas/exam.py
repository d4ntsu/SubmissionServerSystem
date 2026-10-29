from datetime import datetime

from pydantic import BaseModel, Field

from app.models.exam import ExamStatus
from app.schemas.submission import SubmissionTestResultResponse


class ExamCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int | None = None
    access_password: str | None = Field(default=None, max_length=128)


class ExamUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int | None = None
    status: ExamStatus | None = None
    access_password: str | None = Field(default=None, max_length=128)


class ExamResponse(BaseModel):
    id: int
    title: str
    description: str
    status: ExamStatus
    teacher_id: int
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int | None = None
    has_password: bool = False
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class ExamPasswordVerify(BaseModel):
    password: str = Field(..., max_length=128)


class ExamPasswordVerifyResponse(BaseModel):
    valid: bool


class ExamMonitorParticipantResponse(BaseModel):
    student_id: int
    student_name: str
    username: str
    client_ip: str | None = None
    status: str
    current_exam: str
    current_question: str | None = None
    submissions_count: int = 0
    online: bool = False
    last_seen_at: datetime | None = None
    latest_submission_status: str | None = None
    latest_score: float | None = None
    latest_max_score: float | None = None
    latest_submitted_at: datetime | None = None


class ExamGradeAnswer(BaseModel):
    question_id: int
    language: str = Field(..., min_length=1, max_length=20)
    source_code: str = ""


class ExamGradeRequest(BaseModel):
    answers: list[ExamGradeAnswer] = Field(..., min_length=1, max_length=200)


class ExamGradeQuestionResponse(BaseModel):
    question_id: int
    title: str
    status: str
    score: float | None = None
    max_score: float
    error_summary: str | None = None
    test_results: list[SubmissionTestResultResponse] = Field(default_factory=list)


class ExamGradeResponse(BaseModel):
    exam_id: int
    status: str
    score: float
    max_score: float
    questions: list[ExamGradeQuestionResponse]
