from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.question import Question
from app.models.submission import Submission, SubmissionTestResult
from app.models.user import User, UserRole
from app.schemas.submission import SubmissionResponse, SubmissionTestResultResponse
from app.services.dependencies import get_current_user, require_role

router = APIRouter(prefix="/results", tags=["results"])


def _sanitize_test_result(tr: SubmissionTestResult, is_student: bool) -> SubmissionTestResultResponse:
    """Return a test result, hiding hidden-test data from students."""
    data = SubmissionTestResultResponse.model_validate(tr)
    if is_student and tr.test_case and tr.test_case.is_hidden:
        data.stdout = None
        data.stderr = None
        data.compile_output = None
    return data


@router.get("/{submission_id}")
def get_submission_result(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    submission = db.get(Submission, submission_id)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    if current_user.role == UserRole.student and submission.student_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    is_student = current_user.role == UserRole.student
    return {
        "submission": SubmissionResponse.model_validate(submission),
        "test_results": [
            _sanitize_test_result(tr, is_student)
            for tr in submission.test_results
        ],
    }


@router.get("/exam/{exam_id}")
def get_exam_results(
    exam_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    submissions = (
        db.query(Submission)
        .join(Submission.question)
        .filter(Submission.question.has(exam_id=exam_id))
        .order_by(Submission.submitted_at.desc())
        .all()
    )
    return [
        {
            "submission": SubmissionResponse.model_validate(sub),
            "test_results": [
                SubmissionTestResultResponse.model_validate(tr)
                for tr in sub.test_results
            ],
        }
        for sub in submissions
    ]