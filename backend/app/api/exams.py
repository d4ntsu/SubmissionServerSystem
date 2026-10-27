import logging
from datetime import timezone

import anyio
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.database import get_db
from app.models.announcement import Announcement
from app.models.exam import Exam, ExamParticipant, ExamStatus
from app.models.user import User, UserRole
from app.schemas.announcement import AnnouncementCreate, AnnouncementResponse
from app.schemas.exam import (
    ExamCreate,
    ExamPasswordVerify,
    ExamPasswordVerifyResponse,
    ExamResponse,
    ExamUpdate,
)
from app.services.dependencies import get_current_user, require_role

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/exams", tags=["exams"])


def _get_exam_or_404(db: Session, exam_id: int) -> Exam:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")
    return exam


def _emit_exam_event_best_effort(
    event_type: str,
    exam: Exam,
    request: Request,
    *,
    announcement: Announcement | None = None,
) -> None:
    """Queue an event through Java after commit without changing persisted results."""
    payload = {"exam_id": exam.id}
    if announcement is None:
        payload["title"] = exam.title
    else:
        created_at = announcement.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        payload.update({
            "announcement_id": announcement.id,
            "message": announcement.content,
            "created_at": created_at.isoformat().replace("+00:00", "Z"),
        })
    event = {
        "type": event_type,
        "recipient": f"exam:{exam.id}",
        "payload": payload,
    }
    try:
        queued = anyio.from_thread.run(request.app.state.realtime_bridge.send, event)
        if not queued:
            logger.warning("Realtime bridge did not queue %s for exam %s", event_type, exam.id)
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
        access_password_hash=(
            hash_password(data.access_password)
            if data.access_password and data.access_password.strip()
            else None
        ),
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
    request: Request,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if exam.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")
    previous_status = exam.status
    update_data = data.model_dump(exclude_unset=True)
    if "access_password" in update_data:
        new_password = update_data.pop("access_password")
        exam.access_password_hash = (
            hash_password(new_password)
            if new_password and new_password.strip()
            else None
        )
    for key, value in update_data.items():
        setattr(exam, key, value)
    db.commit()
    db.refresh(exam)

    if previous_status != exam.status:
        if exam.status == ExamStatus.started:
            _emit_exam_event_best_effort("exam.started", exam, request)
        elif exam.status == ExamStatus.ended:
            _emit_exam_event_best_effort("exam.ended", exam, request)
    return exam


@router.post("/{exam_id}/join", status_code=status.HTTP_204_NO_CONTENT)
def join_exam(
    exam_id: int,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if exam.status not in {ExamStatus.published, ExamStatus.started}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Exam is not available for participation",
        )
    participant_key = (exam.id, current_user.id)
    if db.get(ExamParticipant, participant_key) is None:
        db.add(ExamParticipant(exam_id=exam.id, student_id=current_user.id))
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{exam_id}/announcements",
    response_model=AnnouncementResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_announcement(
    exam_id: int,
    data: AnnouncementCreate,
    request: Request,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if exam.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")

    announcement = Announcement(
        exam_id=exam.id,
        teacher_id=current_user.id,
        content=data.content,
    )
    db.add(announcement)
    db.commit()
    db.refresh(announcement)
    _emit_exam_event_best_effort(
        "announcement.created",
        exam,
        request,
        announcement=announcement,
    )
    return announcement


@router.post("/{exam_id}/verify-password", response_model=ExamPasswordVerifyResponse)
def verify_exam_password(
    exam_id: int,
    data: ExamPasswordVerify,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if not exam.access_password_hash:
        return ExamPasswordVerifyResponse(valid=True)
    return ExamPasswordVerifyResponse(
        valid=verify_password(data.password, exam.access_password_hash)
    )


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
