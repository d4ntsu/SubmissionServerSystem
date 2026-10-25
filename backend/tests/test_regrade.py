from app.database import SessionLocal
from app.models.submission import Submission, SubmissionStatus, SubmissionTestResult


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


def _create_started_exam(client, teacher_headers, title):
    exam = client.post(
        "/exams", json={"title": title, "duration_minutes": 60}, headers=teacher_headers
    )
    assert exam.status_code == 201
    exam_id = exam.json()["id"]
    for status_value in ("published", "started"):
        response = client.put(
            f"/exams/{exam_id}", json={"status": status_value}, headers=teacher_headers
        )
        assert response.status_code == 200
    return exam_id


def test_teacher_can_regrade_and_results_are_cleared(client, student_token):
    teacher_token = _login(client, "regrade_teacher", "teacher")
    teacher_headers = {"Authorization": f"Bearer {teacher_token}"}
    student_headers = {"Authorization": f"Bearer {student_token}"}

    exam_id = _create_started_exam(client, teacher_headers, "Regrade Exam")
    question = client.post(
        "/questions",
        json={
            "exam_id": exam_id,
            "title": "Print Hello",
            "max_score": 10.0,
            "allowed_languages": "java",
        },
        headers=teacher_headers,
    )
    assert question.status_code == 201
    question_id = question.json()["id"]

    test_case = client.post(
        "/test-cases",
        json={
            "question_id": question_id,
            "input_data": "",
            "expected_output": "Hello",
            "score_weight": 1.0,
        },
        headers=teacher_headers,
    )
    assert test_case.status_code == 201
    test_case_id = test_case.json()["id"]

    submission = client.post(
        "/submissions",
        json={
            "question_id": question_id,
            "language": "java",
            "source_code": "class Main {}",
        },
        headers=student_headers,
    )
    assert submission.status_code == 201
    submission_id = submission.json()["id"]

    student_attempt = client.post(
        f"/submissions/{submission_id}/regrade", headers=student_headers
    )
    assert student_attempt.status_code == 403

    other_teacher_token = _login(client, "regrade_other_teacher", "teacher")
    other_attempt = client.post(
        f"/submissions/{submission_id}/regrade",
        headers={"Authorization": f"Bearer {other_teacher_token}"},
    )
    assert other_attempt.status_code == 403

    db = SessionLocal()
    try:
        stored = db.get(Submission, submission_id)
        stored.status = SubmissionStatus.completed
        stored.score = 0.0
        stored.error_summary = "stale grading result"
        db.add(
            SubmissionTestResult(
                submission_id=submission_id,
                test_case_id=test_case_id,
                passed=0,
                stdout="wrong",
            )
        )
        db.commit()
    finally:
        db.close()

    regrade = client.post(
        f"/submissions/{submission_id}/regrade", headers=teacher_headers
    )
    assert regrade.status_code == 202
    body = regrade.json()
    assert body["status"] == "queued"
    assert body["score"] is None
    assert body["error_summary"] is None

    db = SessionLocal()
    try:
        assert (
            db.query(SubmissionTestResult)
            .filter(SubmissionTestResult.submission_id == submission_id)
            .count()
            == 0
        )
    finally:
        db.close()

    duplicate = client.post(
        f"/submissions/{submission_id}/regrade", headers=teacher_headers
    )
    assert duplicate.status_code == 409


def test_regrade_unknown_submission(client, teacher_token):
    response = client.post(
        "/submissions/999999/regrade",
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    assert response.status_code == 404


def test_test_case_requires_expected_answer(client, teacher_token):
    response = client.post(
        "/test-cases",
        json={
            "question_id": 1,
            "input_data": "5",
            "expected_output": "   ",
            "score_weight": 1.0,
        },
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    assert response.status_code == 422
