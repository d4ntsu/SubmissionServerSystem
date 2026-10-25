from datetime import datetime

from pydantic import BaseModel, Field

from app.models.submission import SubmissionStatus


class SubmissionCreate(BaseModel):
    question_id: int
    language: str = Field(..., min_length=1, max_length=20)
    source_code: str = Field(..., min_length=1)


class SubmissionResponse(BaseModel):
    id: int
    student_id: int
    question_id: int
    language: str
    source_code: str
    status: SubmissionStatus
    score: float | None = None
    max_score: float
    error_summary: str | None = None
    submitted_at: datetime | None = None
    graded_at: datetime | None = None

    model_config = {"from_attributes": True}


class SubmissionTestResultResponse(BaseModel):
    id: int
    submission_id: int
    test_case_id: int
    is_sample: bool = False
    passed: int
    stdout: str | None = None
    stderr: str | None = None
    compile_output: str | None = None
    exit_code: int | None = None
    time: float | None = None
    memory: float | None = None
    input_data: str | None = None
    expected_output: str | None = None
    score_weight: float | None = None
    awarded_points: float | None = None
    message: str | None = None

    model_config = {"from_attributes": True}