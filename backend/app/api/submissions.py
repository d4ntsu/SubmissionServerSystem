from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.submission import SubmissionCreate, SubmissionResponse
from app.services.dependencies import get_current_user
from app.services.submission_service import (
    SubmissionValidationError,
    create_submission,
    get_submission,
    list_submissions,
)

router = APIRouter(prefix="/submissions", tags=["submissions"])


@router.post("", response_model=SubmissionResponse, status_code=status.HTTP_201_CREATED)
def submit_code(
    data: SubmissionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        submission = create_submission(
            db,
            student=current_user,
            question_id=data.question_id,
            language=data.language,
            source_code=data.source_code,
        )
    except SubmissionValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return submission


@router.get("/{submission_id}", response_model=SubmissionResponse)
def get_one_submission(
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    submission = get_submission(db, submission_id, current_user)
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    return submission


@router.get("", response_model=list[SubmissionResponse])
def list_all_submissions(
    exam_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_submissions(db, current_user, exam_id=exam_id)