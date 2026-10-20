from datetime import datetime

from pydantic import BaseModel

from app.models.submission import SubmissionStatus


class SubmissionResponse(BaseModel):
    id: int
    student_id: int
    question_id: int
    language: str
    source_code: str
    status: SubmissionStatus
    score: float | None = None
    max_score: float
    judge0_submission_id: str | None = None
    submitted_at: datetime | None = None
    graded_at: datetime | None = None

    model_config = {"from_attributes": True}


class SubmissionTestResultResponse(BaseModel):
    id: int
    submission_id: int
    test_case_id: int
    passed: int
    stdout: str | None = None
    stderr: str | None = None
    compile_output: str | None = None
    exit_code: int | None = None
    time: float | None = None
    memory: float | None = None

    model_config = {"from_attributes": True}