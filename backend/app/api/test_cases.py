from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.exam import Exam
from app.models.question import Question
from app.models.test_case import TestCase
from app.models.user import User, UserRole
from app.schemas.test_case import TestCaseCreate, TestCaseResponse
from app.services.dependencies import get_current_user, require_role

router = APIRouter(prefix="/test-cases", tags=["test_cases"])


def _require_question_owner(db: Session, question_id: int, teacher: User) -> Question:
    question = db.get(Question, question_id)
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    exam = db.get(Exam, question.exam_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")
    if exam.teacher_id != teacher.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")
    return question


@router.post("", response_model=TestCaseResponse, status_code=status.HTTP_201_CREATED)
def create_test_case(
    data: TestCaseCreate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    _require_question_owner(db, data.question_id, current_user)
    if not data.expected_output.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="expected_output is required; the grader cannot score a wrong answer without it",
        )

    test_case = TestCase(**data.model_dump())
    db.add(test_case)
    db.commit()
    db.refresh(test_case)
    return test_case


@router.get("/question/{question_id}", response_model=list[TestCaseResponse])
def list_test_cases(
    question_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    question = db.get(Question, question_id)
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    if current_user.role == UserRole.teacher:
        _require_question_owner(db, question_id, current_user)

    query = db.query(TestCase).filter(TestCase.question_id == question_id)
    if current_user.role != UserRole.teacher:
        query = query.filter(TestCase.is_hidden == 0)
    return query.all()


@router.delete("/{test_case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_test_case(
    test_case_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    test_case = db.get(TestCase, test_case_id)
    if not test_case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test case not found")
    _require_question_owner(db, test_case.question_id, current_user)
    db.delete(test_case)
    db.commit()