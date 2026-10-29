import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.exam import Exam
from app.models.question import Question, QuestionType
from app.models.user import User, UserRole
from app.schemas.question import (
    QuestionCreate,
    QuestionResponse,
    QuestionUpdate,
    TeacherQuestionResponse,
    validate_objective_configuration,
)
from app.services.dependencies import get_current_user, require_role

router = APIRouter(prefix="/questions", tags=["questions"])


def _get_question_or_404(db: Session, question_id: int) -> Question:
    question = db.get(Question, question_id)
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    return question


def _require_exam_owner(db: Session, exam_id: int, teacher: User) -> Exam:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")
    if exam.teacher_id != teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")
    return exam


def _require_question_owner(db: Session, question: Question, teacher: User) -> None:
    _require_exam_owner(db, question.exam_id, teacher)


def _question_response(db: Session, question: Question, current_user: User):
    if current_user.role == UserRole.teacher:
        exam = db.get(Exam, question.exam_id)
        if exam and exam.teacher_id == current_user.id:
            return TeacherQuestionResponse.model_validate(question)
    return QuestionResponse.model_validate(question)


def _serialize_question_fields(update_data: dict) -> dict:
    for key in ("mc_options", "mc_correct_answers"):
        if key in update_data and update_data[key] is not None:
            update_data[key] = json.dumps(update_data[key])
    return update_data


@router.post("", response_model=TeacherQuestionResponse, status_code=status.HTTP_201_CREATED)
def create_question(
    data: QuestionCreate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    _require_exam_owner(db, data.exam_id, current_user)
    question = Question(**_serialize_question_fields(data.model_dump()))
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


@router.get("")
def list_questions(
    exam_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Question)
    if exam_id is not None:
        query = query.filter(Question.exam_id == exam_id)
    return [_question_response(db, question, current_user) for question in query.all()]


@router.get("/{question_id}")
def get_question(
    question_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _question_response(db, _get_question_or_404(db, question_id), current_user)


@router.put("/{question_id}", response_model=TeacherQuestionResponse)
def update_question(
    question_id: int,
    data: QuestionUpdate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    question = _get_question_or_404(db, question_id)
    _require_question_owner(db, question, current_user)
    update_data = data.model_dump(exclude_unset=True)
    if "boilerplate" in update_data and update_data["boilerplate"] is None:
        update_data["boilerplate"] = ""

    def existing_list(value: str | None, key: str) -> list[str] | None:
        if value is None:
            return None
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = value.splitlines() if key == "mc_options" else value.replace(";", ",").split(",")
        return parsed if isinstance(parsed, list) else [parsed]

    effective_type = update_data.get("question_type", question.question_type)
    try:
        validate_objective_configuration(
            effective_type,
            update_data.get("mc_options", existing_list(question.mc_options, "mc_options")),
            update_data.get(
                "mc_correct_answers",
                existing_list(question.mc_correct_answers, "mc_correct_answers"),
            ),
            update_data.get("mc_allow_multiple", question.mc_allow_multiple),
            update_data.get("short_answer", question.short_answer),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    for key, value in _serialize_question_fields(update_data).items():
        setattr(question, key, value)
    db.commit()
    db.refresh(question)
    return question


@router.delete("/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(
    question_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    question = _get_question_or_404(db, question_id)
    _require_question_owner(db, question, current_user)
    db.delete(question)
    db.commit()