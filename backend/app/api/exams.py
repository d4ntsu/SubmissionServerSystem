from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.database import get_db
from app.models.exam import Exam, ExamStatus
from app.models.user import User, UserRole
from app.schemas.exam import (
    ExamCreate,
    ExamPasswordVerify,
    ExamPasswordVerifyResponse,
    ExamResponse,
    ExamUpdate,
)
from app.services.dependencies import get_current_user, require_role

router = APIRouter(prefix="/exams", tags=["exams"])


def _get_exam_or_404(db: Session, exam_id: int) -> Exam:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")
    return exam


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
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if exam.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")
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
    return exam


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