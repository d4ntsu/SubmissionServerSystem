from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.test_cases import router
from app.database import Base, get_db
from app.models.exam import Exam
from app.models.question import Question
from app.models.test_case import TestCase as Case
from app.models.user import User, UserRole
from app.services.dependencies import get_current_user


@pytest.fixture
def case_api():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(router)
    current_user = SimpleNamespace(role=UserRole.student)
    with Session(engine) as db:
        teacher = User(
            username="teacher",
            hashed_password="unused",
            full_name="Teacher",
            role=UserRole.teacher,
        )
        db.add(teacher)
        db.flush()
        exam = Exam(title="Java", teacher_id=teacher.id)
        db.add(exam)
        db.flush()
        question = Question(exam_id=exam.id, title="Add")
        db.add(question)
        db.flush()
        db.add_all(
            [
                Case(
                    question_id=question.id,
                    input_data="sample",
                    expected_output="sample answer",
                    is_hidden=0,
                    score_weight=1,
                ),
                Case(
                    question_id=question.id,
                    input_data="SECRET_INPUT",
                    expected_output="SECRET_EXPECTED",
                    is_hidden=1,
                    score_weight=1,
                ),
            ]
        )
        db.commit()
        question_id = question.id
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: current_user
        yield TestClient(app), current_user, question_id
    engine.dispose()


def test_student_api_does_not_return_hidden_cases(case_api):
    client, user, question_id = case_api
    response = client.get(f"/test-cases/question/{question_id}")
    assert response.status_code == 200
    assert [case["is_hidden"] for case in response.json()] == [0]
    assert "SECRET_INPUT" not in response.text
    assert "SECRET_EXPECTED" not in response.text


def test_teacher_api_can_return_hidden_cases(case_api):
    client, user, question_id = case_api
    user.role = UserRole.teacher
    response = client.get(f"/test-cases/question/{question_id}")
    assert response.status_code == 200
    assert len(response.json()) == 2
    assert "SECRET_EXPECTED" in response.text
