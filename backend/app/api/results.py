from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.question import Question
from app.models.submission import Submission, SubmissionTestResult
from app.models.user import User, UserRole
from app.schemas.submission import SubmissionResponse, SubmissionTestResultResponse
from app.services.dependencies import get_current_user, require_role

router = APIRouter(prefix="/results", tags=["results"])


def _sanitize_test_result(
    tr: SubmissionTestResult,
    is_student: bool,
    submission: Submission,
    total_weight: float,
) -> SubmissionTestResultResponse:
    """Return a test result with expected/actual data, hiding hidden tests from students."""
    data = SubmissionTestResultResponse.model_validate(tr)
    test_case = tr.test_case
    is_hidden = bool(test_case and test_case.is_hidden)
    data.is_sample = not is_hidden

    if test_case:
        weight = test_case.score_weight or 0.0
        data.score_weight = weight
        data.awarded_points = (
            round((weight / total_weight) * submission.max_score, 2)
            if tr.passed == 1 and total_weight
            else 0.0
        )
        data.input_data = test_case.input_data
        data.expected_output = test_case.expected_output
        if tr.passed != 1:
            data.message = (
                "No expected answer is configured for this test case."
                if not (test_case.expected_output or "").strip()
                else "The produced output did not match the expected answer."
            )

    if is_student and is_hidden:
        data.stdout = None
        data.stderr = None
        data.compile_output = None
        data.input_data = None
        data.expected_output = None
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
    total_weight = sum(
        (tr.test_case.score_weight or 0) for tr in submission.test_results if tr.test_case
    )
    return {
        "submission": SubmissionResponse.model_validate(submission),
        "test_results": [
            _sanitize_test_result(tr, is_student, submission, total_weight)
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
                _sanitize_test_result(
                    tr,
                    False,
                    sub,
                    sum(
                        (item.test_case.score_weight or 0)
                        for item in sub.test_results
                        if item.test_case
                    ),
                )
                for tr in sub.test_results
            ],
        }
        for sub in submissions
    ]