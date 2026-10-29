import json
from unittest.mock import AsyncMock, patch

import pytest

from app.models.question import Question, QuestionType
from app.models.submission import Submission, SubmissionStatus
from app.services.grading_service import grade_submission


def _create_exam(client, teacher_token, title):
    headers = {"Authorization": f"Bearer {teacher_token}"}
    response = client.post(
        "/exams",
        json={"title": title, "duration_minutes": 60},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()["id"], headers


def test_student_question_responses_hide_objective_answer_keys(
    client, teacher_token, student_token
):
    exam_id, teacher_headers = _create_exam(client, teacher_token, "Objective Question Keys")
    response = client.post(
        "/questions",
        json={
            "exam_id": exam_id,
            "title": "Select the correct choices",
            "question_type": "multiple_choice",
            "mc_options": ["First", "Second", "Third"],
            "mc_correct_answers": ["A", "C"],
            "mc_allow_multiple": True,
            "show_result_to_student": False,
        },
        headers=teacher_headers,
    )
    assert response.status_code == 201
    question_id = response.json()["id"]
    assert response.json()["mc_correct_answers"] == ["A", "C"]
    assert response.json()["show_result_to_student"] is False

    student_headers = {"Authorization": f"Bearer {student_token}"}
    for student_response in (
        client.get(f"/questions?exam_id={exam_id}", headers=student_headers).json()[0],
        client.get(f"/questions/{question_id}", headers=student_headers).json(),
    ):
        assert student_response["mc_options"] == ["First", "Second", "Third"]
        assert student_response["mc_allow_multiple"] is True
        assert student_response["show_result_to_student"] is False
        assert "mc_correct_answers" not in student_response
        assert "short_answer" not in student_response

    teacher_response = client.get(
        f"/questions/{question_id}", headers=teacher_headers
    )
    assert teacher_response.json()["mc_correct_answers"] == ["A", "C"]

    short_question = client.post(
        "/questions",
        json={
            "exam_id": exam_id,
            "title": "Short response",
            "question_type": "short_answer",
            "short_answer": "private expected answer",
        },
        headers=teacher_headers,
    )
    assert short_question.status_code == 201
    student_short_question = client.get(
        f"/questions/{short_question.json()['id']}",
        headers=student_headers,
    )
    assert student_short_question.status_code == 200
    assert "short_answer" not in student_short_question.json()
    teacher_short_question = client.get(
        f"/questions/{short_question.json()['id']}",
        headers=teacher_headers,
    )
    assert teacher_short_question.json()["short_answer"] == "private expected answer"


def test_single_answer_multiple_choice_rejects_multiple_correct_options(
    client, teacher_token
):
    exam_id, headers = _create_exam(client, teacher_token, "Invalid Multiple Choice")
    response = client.post(
        "/questions",
        json={
            "exam_id": exam_id,
            "title": "Only one answer is allowed",
            "question_type": "multiple_choice",
            "mc_options": ["First", "Second", "Third"],
            "mc_correct_answers": ["A", "C"],
            "mc_allow_multiple": False,
        },
        headers=headers,
    )
    assert response.status_code == 422


def test_legacy_text_options_are_normalized(client, teacher_token):
    exam_id, headers = _create_exam(client, teacher_token, "Legacy Option Format")
    response = client.post(
        "/questions",
        json={
            "exam_id": exam_id,
            "title": "Legacy data shape",
            "question_type": "multiple_choice",
            "mc_options": "A) First\nB) Second",
            "mc_correct_answers": "A",
        },
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json()["mc_options"] == ["First", "Second"]
    assert response.json()["mc_correct_answers"] == ["A"]


def test_objective_question_accepts_submission_without_test_cases(
    client, teacher_token, student_token
):
    exam_id, teacher_headers = _create_exam(client, teacher_token, "Objective Submission")
    client.put(
        f"/exams/{exam_id}",
        json={"status": "published"},
        headers=teacher_headers,
    )
    started = client.put(
        f"/exams/{exam_id}",
        json={"status": "started"},
        headers=teacher_headers,
    )
    assert started.status_code == 200

    question = client.post(
        "/questions",
        json={
            "exam_id": exam_id,
            "title": "Short response",
            "question_type": "short_answer",
            "short_answer": "accepted",
        },
        headers=teacher_headers,
    )
    assert question.status_code == 201

    submission = client.post(
        "/submissions",
        json={
            "question_id": question.json()["id"],
            "language": "plaintext",
            "source_code": "",
        },
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert submission.status_code == 201
    assert submission.json()["language"] == "plaintext"
    assert submission.json()["status"] == "queued"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("question_type", "configured_values", "source_code", "expected_score"),
    [
        (
            QuestionType.multiple_choice,
            {
                "mc_options": json.dumps(["First", "Second", "Third"]),
                "mc_correct_answers": json.dumps(["A", "C"]),
                "mc_allow_multiple": True,
            },
            '["A","C"]',
            10.0,
        ),
        (
            QuestionType.multiple_choice,
            {
                "mc_options": json.dumps(["First", "Second", "Third"]),
                "mc_correct_answers": json.dumps(["A", "C"]),
                "mc_allow_multiple": True,
            },
            '["A","A","C"]',
            0.0,
        ),
        (
            QuestionType.short_answer,
            {"short_answer": "Accepted"},
            " accepted ",
            10.0,
        ),
    ],
)
async def test_objective_grading_needs_no_test_cases_or_piston(
    question_type, configured_values, source_code, expected_score
):
    with (
        patch("app.services.grading_service.SessionLocal") as session_factory,
        patch(
            "app.services.grading_service.publish_submission_event",
            new_callable=AsyncMock,
        ),
        patch("app.services.grading_service.PistonClient") as piston_class,
    ):
        db = session_factory.return_value
        question = Question(
            id=3,
            exam_id=1,
            question_type=question_type,
            max_score=10.0,
            **configured_values,
        )
        submission = Submission(
            id=7,
            student_id=2,
            question_id=3,
            language="plaintext",
            source_code=source_code,
            status=SubmissionStatus.running,
            max_score=10.0,
        )
        db.get.side_effect = lambda model, _pk: {
            Submission: submission,
            Question: question,
        }.get(model)

        await grade_submission(submission.id)

        assert submission.status == SubmissionStatus.completed
        assert submission.score == expected_score
        db.query.assert_not_called()
        piston_class.assert_not_called()
