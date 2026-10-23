import logging

import anyio
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.exam import Exam, ExamStatus
from app.models.user import User, UserRole
from app.realtime.manager import publish_bridge_event
from app.schemas.exam import ExamCreate, ExamResponse, ExamUpdate
from app.services.dependencies import get_current_user, require_role

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/exams", tags=["exams"])


def _get_exam_or_404(db: Session, exam_id: int) -> Exam:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")
    return exam


def _emit_exam_event_best_effort(event_type: str, exam: Exam, db: Session) -> None:
    """Emit after commit; realtime errors must not change the saved exam state."""
    event = {
        "type": event_type,
        "recipient": "role:student",
        "payload": {"exam_id": exam.id, "title": exam.title},
    }
    try:
        delivered = anyio.from_thread.run(publish_bridge_event, event, db)
        logger.debug("Emitted %s for exam %s to %s browser connections", event_type, exam.id, delivered)
    except Exception:
        logger.exception(
            "Realtime delivery failed for %s on exam %s after the database commit",
            event_type,
            exam.id,
        )


@router.post("", response_model=ExamResponse, status_code=status.HTTP_201_CREATED)
def create_exam(
    data: ExamCreate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    exam = Exam(
        title=data.title,
        description=data.description,
        teacher_id=current_user.id,
        start_time=data.start_time,
        end_time=data.end_time,
        duration_minutes=data.duration_minutes,
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam


@router.get("", response_model=list[ExamResponse])
def list_exams(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role == UserRole.teacher:
        return db.query(Exam).filter(Exam.teacher_id == current_user.id).all()
    return db.query(Exam).filter(Exam.status.in_([ExamStatus.published, ExamStatus.started])).all()


@router.get("/{exam_id}", response_model=ExamResponse)
def get_exam(
    exam_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _get_exam_or_404(db, exam_id)


@router.put("/{exam_id}", response_model=ExamResponse)
def update_exam(
    exam_id: int,
    data: ExamUpdate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if exam.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")
    previous_status = exam.status
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(exam, key, value)
    db.commit()
    db.refresh(exam)

    if previous_status != exam.status:
        if exam.status == ExamStatus.started:
            _emit_exam_event_best_effort("exam.started", exam, db)
        elif exam.status == ExamStatus.ended:
            _emit_exam_event_best_effort("exam.ended", exam, db)
    return exam


@router.delete("/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(
    exam_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if exam.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")
    db.delete(exam)
    db.commit()
