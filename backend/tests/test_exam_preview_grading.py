from unittest.mock import AsyncMock, patch

from app.database import SessionLocal
from app.models.submission import Submission
from app.services.piston_client import PistonExecutionResult, PistonStageResult


def _login(client, username, role):
    client.post(
        "/auth/register",
        json={
            "username": username,
            "password": "pass123",
            "full_name": username.replace("_", " ").title(),
            "role": role,
        },
    )
    response = client.post(
        "/auth/login", json={"username": username, "password": "pass123"}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _execution(stdout: str) -> PistonExecutionResult:
    return PistonExecutionResult(
        language="java",
        version="15.0.2",
        run=PistonStageResult(stdout=stdout, stderr="", output=stdout, code=0),
        compile=PistonStageResult(code=0, stdout="", stderr="", output=""),
    )


def test_teacher_can_grade_an_exam_without_creating_submissions(client):
    teacher_token = _login(client, "preview_grade_teacher", "teacher")
    teacher_headers = {"Authorization": f"Bearer {teacher_token}"}

    exam = client.post(
        "/exams",
        json={"title": "Preview Grading Exam", "duration_minutes": 60},
        headers=teacher_headers,
    )
    assert exam.status_code == 201
    exam_id = exam.json()["id"]

    question = client.post(
        "/questions",
        json={
            "exam_id": exam_id,
            "title": "Add Two Numbers",
            "max_score": 10.0,
            "allowed_languages": "java",
        },
        headers=teacher_headers,
    )
    assert question.status_code == 201
    question_id = question.json()["id"]

    visible_case = client.post(
        "/test-cases",
        json={
            "question_id": question_id,
            "input_data": "3 4",
            "expected_output": "7",
            "score_weight": 1.0,
            "is_hidden": 0,
        },
        headers=teacher_headers,
    )
    assert visible_case.status_code == 201

    hidden_case = client.post(
        "/test-cases",
        json={
            "question_id": question_id,
            "input_data": "10 5",
            "expected_output": "15",
            "score_weight": 1.0,
            "is_hidden": 1,
        },
        headers=teacher_headers,
    )
    assert hidden_case.status_code == 201

    with patch("app.services.grading_service.PistonClient") as piston_cls, patch(
        "app.services.grading_service.publish_submission_event",
        new_callable=AsyncMock,
    ) as publish_event:
        piston = piston_cls.return_value.__aenter__.return_value
        piston.execute.side_effect = [_execution("7\n"), _execution("99\n")]

        response = client.post(
            f"/exams/{exam_id}/grade",
            json={
                "answers": [
                    {
                        "question_id": question_id,
                        "language": "java",
                        "source_code": "class Main {}",
                    }
                ]
            },
            headers=teacher_headers,
        )

    assert response.status_code == 200
    body = response.json()
    assert body["exam_id"] == exam_id
    assert body["status"] == "completed"
    assert body["score"] == 5.0
    assert body["max_score"] == 10.0

    graded_question = body["questions"][0]
    assert graded_question["question_id"] == question_id
    assert graded_question["status"] == "completed"
    assert graded_question["score"] == 5.0
    assert graded_question["error_summary"] is None

    results = graded_question["test_results"]
    assert len(results) == 2
    assert results[0]["passed"] == 1
    assert results[0]["is_sample"] is True
    assert results[0]["input_data"] == "3 4"
    assert results[0]["expected_output"] == "7"
    assert results[0]["awarded_points"] == 5.0
    assert results[1]["passed"] == 0
    assert results[1]["is_sample"] is False
    assert results[1]["input_data"] == "10 5"
    assert results[1]["expected_output"] == "15"
    assert results[1]["awarded_points"] == 0.0
    assert "did not match" in results[1]["message"]

    publish_event.assert_not_awaited()

    db = SessionLocal()
    try:
        stored = (
            db.query(Submission)
            .filter(Submission.question_id == question_id)
            .count()
        )
        assert stored == 0
    finally:
        db.close()


def test_teacher_cannot_grade_another_teachers_exam(client):
    owner_token = _login(client, "preview_owner_teacher", "teacher")
    other_token = _login(client, "preview_other_teacher", "teacher")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    other_headers = {"Authorization": f"Bearer {other_token}"}

    exam = client.post(
        "/exams",
        json={"title": "Owned Preview Exam", "duration_minutes": 60},
        headers=owner_headers,
    )
    assert exam.status_code == 201
    exam_id = exam.json()["id"]

    question = client.post(
        "/questions",
        json={"exam_id": exam_id, "title": "Owned Question", "max_score": 5.0},
        headers=owner_headers,
    )
    assert question.status_code == 201
    question_id = question.json()["id"]

    response = client.post(
        f"/exams/{exam_id}/grade",
        json={
            "answers": [
                {
                    "question_id": question_id,
                    "language": "java",
                    "source_code": "class Main {}",
                }
            ]
        },
        headers=other_headers,
    )
    assert response.status_code == 403


def test_grade_rejects_questions_from_another_exam(client):
    teacher_token = _login(client, "preview_validation_teacher", "teacher")
    teacher_headers = {"Authorization": f"Bearer {teacher_token}"}

    first = client.post(
        "/exams",
        json={"title": "First Validation Exam", "duration_minutes": 60},
        headers=teacher_headers,
    )
    second = client.post(
        "/exams",
        json={"title": "Second Validation Exam", "duration_minutes": 60},
        headers=teacher_headers,
    )
    assert first.status_code == 201
    assert second.status_code == 201

    foreign_question = client.post(
        "/questions",
        json={
            "exam_id": second.json()["id"],
            "title": "Foreign Question",
            "max_score": 5.0,
        },
        headers=teacher_headers,
    )
    assert foreign_question.status_code == 201

    response = client.post(
        f"/exams/{first.json()['id']}/grade",
        json={
            "answers": [
                {
                    "question_id": foreign_question.json()["id"],
                    "language": "java",
                    "source_code": "class Main {}",
                }
            ]
        },
        headers=teacher_headers,
    )
    assert response.status_code == 400
    assert "do not belong to the exam" in response.json()["detail"]
