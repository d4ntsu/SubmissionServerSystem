import pytest


class TestSubmissionEndpoints:
    def test_submit_code_as_student(self, client, student_token):
        # First create an exam, question, and test case via teacher
        teacher_resp = client.post("/auth/register", json={
            "username": "sub_teacher", "password": "pass123",
            "full_name": "Sub Teacher", "role": "teacher",
        })
        assert teacher_resp.status_code in (201, 400)
        login_resp = client.post("/auth/login", json={"username": "sub_teacher", "password": "pass123"})
        teacher_tok = login_resp.json()["access_token"]

        exam_resp = client.post("/exams", json={
            "title": "Submission Test Exam",
            "duration_minutes": 60,
        }, headers={"Authorization": f"Bearer {teacher_tok}"})
        assert exam_resp.status_code == 201
        exam_id = exam_resp.json()["id"]

        # Publish and start the exam
        client.put(f"/exams/{exam_id}", json={"status": "published"},
                   headers={"Authorization": f"Bearer {teacher_tok}"})
        client.put(f"/exams/{exam_id}", json={"status": "started"},
                   headers={"Authorization": f"Bearer {teacher_tok}"})

        q_resp = client.post("/questions", json={
            "exam_id": exam_id,
            "title": "Hello World",
            "description": "Print Hello",
            "max_score": 100.0,
            "allowed_languages": "java",
        }, headers={"Authorization": f"Bearer {teacher_tok}"})
        assert q_resp.status_code == 201
        question_id = q_resp.json()["id"]

        # Student submits
        resp = client.post("/submissions", json={
            "question_id": question_id,
            "language": "java",
            "source_code": "public class Main { public static void main(String[] args) { System.out.println(\"Hello\"); } }",
        }, headers={"Authorization": f"Bearer {student_token}"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "queued"
        assert data["language"] == "java"
        assert data["question_id"] == question_id

    def test_start_rebases_expired_exam_window(self, client, teacher_token, student_token):
        teacher_headers = {"Authorization": f"Bearer {teacher_token}"}
        student_headers = {"Authorization": f"Bearer {student_token}"}
        exam = client.post(
            "/exams",
            json={
                "title": "Expired Draft Window",
                "start_time": "2020-01-01T00:00:00Z",
                "end_time": "2020-01-01T01:00:00Z",
                "duration_minutes": 60,
            },
            headers=teacher_headers,
        )
        assert exam.status_code == 201
        exam_id = exam.json()["id"]
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
        assert started.json()["start_time"] > "2020-01-01T00:00:00"
        assert started.json()["end_time"] > started.json()["start_time"]

        question = client.post(
            "/questions",
            json={"exam_id": exam_id, "title": "Question"},
            headers=teacher_headers,
        )
        submission = client.post(
            "/submissions",
            json={
                "question_id": question.json()["id"],
                "language": "java",
                "source_code": "class Main {}",
            },
            headers=student_headers,
        )
        assert submission.status_code == 201

    def test_submit_to_nonexistent_question(self, client, student_token):
        resp = client.post("/submissions", json={
            "question_id": 99999,
            "language": "java",
            "source_code": "class Main {}",
        }, headers={"Authorization": f"Bearer {student_token}"})
        assert resp.status_code == 400

    def test_submit_with_unsupported_language(self, client, student_token):
        # Create exam + question with only java allowed
        teacher_resp = client.post("/auth/register", json={
            "username": "lang_teacher", "password": "pass123",
            "full_name": "Lang Teacher", "role": "teacher",
        })
        assert teacher_resp.status_code in (201, 400)
        login_resp = client.post("/auth/login", json={"username": "lang_teacher", "password": "pass123"})
        teacher_tok = login_resp.json()["access_token"]

        exam_resp = client.post("/exams", json={
            "title": "Lang Test Exam", "duration_minutes": 60,
        }, headers={"Authorization": f"Bearer {teacher_tok}"})
        exam_id = exam_resp.json()["id"]
        client.put(f"/exams/{exam_id}", json={"status": "published"},
                   headers={"Authorization": f"Bearer {teacher_tok}"})
        client.put(f"/exams/{exam_id}", json={"status": "started"},
                   headers={"Authorization": f"Bearer {teacher_tok}"})

        q_resp = client.post("/questions", json={
            "exam_id": exam_id,
            "title": "Java Only",
            "allowed_languages": "java",
        }, headers={"Authorization": f"Bearer {teacher_tok}"})
        question_id = q_resp.json()["id"]

        resp = client.post("/submissions", json={
            "question_id": question_id,
            "language": "python",
            "source_code": "print('hi')",
        }, headers={"Authorization": f"Bearer {student_token}"})
        assert resp.status_code == 400
        assert "not allowed" in resp.json()["detail"].lower()

    def test_teacher_cannot_submit(self, client, teacher_token):
        resp = client.post("/submissions", json={
            "question_id": 1,
            "language": "java",
            "source_code": "class Main {}",
        }, headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 400

    def test_get_own_submission(self, client, student_token):
        # Create exam + question + submission
        teacher_resp = client.post("/auth/register", json={
            "username": "view_teacher", "password": "pass123",
            "full_name": "View Teacher", "role": "teacher",
        })
        assert teacher_resp.status_code in (201, 400)
        login_resp = client.post("/auth/login", json={"username": "view_teacher", "password": "pass123"})
        teacher_tok = login_resp.json()["access_token"]

        exam_resp = client.post("/exams", json={
            "title": "View Test Exam", "duration_minutes": 60,
        }, headers={"Authorization": f"Bearer {teacher_tok}"})
        exam_id = exam_resp.json()["id"]
        client.put(f"/exams/{exam_id}", json={"status": "published"},
                   headers={"Authorization": f"Bearer {teacher_tok}"})
        client.put(f"/exams/{exam_id}", json={"status": "started"},
                   headers={"Authorization": f"Bearer {teacher_tok}"})

        q_resp = client.post("/questions", json={
            "exam_id": exam_id,
            "title": "View Q",
            "allowed_languages": "java",
        }, headers={"Authorization": f"Bearer {teacher_tok}"})
        question_id = q_resp.json()["id"]

        sub_resp = client.post("/submissions", json={
            "question_id": question_id,
            "language": "java",
            "source_code": "class Main {}",
        }, headers={"Authorization": f"Bearer {student_token}"})
        assert sub_resp.status_code == 201
        sub_id = sub_resp.json()["id"]

        # Student can view own submission
        resp = client.get(f"/submissions/{sub_id}",
                          headers={"Authorization": f"Bearer {student_token}"})
        assert resp.status_code == 200
        assert resp.json()["id"] == sub_id

    def test_student_cannot_view_other_submission(self, client, student_token):
        # Register a second student
        client.post("/auth/register", json={
            "username": "other_student", "password": "pass123",
            "full_name": "Other Student", "role": "student",
        })
        login_resp = client.post("/auth/login", json={"username": "other_student", "password": "pass123"})
        other_tok = login_resp.json()["access_token"]

        # Create exam + question + submission as first student
        teacher_resp = client.post("/auth/register", json={
            "username": "priv_teacher", "password": "pass123",
            "full_name": "Priv Teacher", "role": "teacher",
        })
        assert teacher_resp.status_code in (201, 400)
        login_resp = client.post("/auth/login", json={"username": "priv_teacher", "password": "pass123"})
        teacher_tok = login_resp.json()["access_token"]

        exam_resp = client.post("/exams", json={
            "title": "Privacy Exam", "duration_minutes": 60,
        }, headers={"Authorization": f"Bearer {teacher_tok}"})
        exam_id = exam_resp.json()["id"]
        client.put(f"/exams/{exam_id}", json={"status": "published"},
                   headers={"Authorization": f"Bearer {teacher_tok}"})
        client.put(f"/exams/{exam_id}", json={"status": "started"},
                   headers={"Authorization": f"Bearer {teacher_tok}"})

        q_resp = client.post("/questions", json={
            "exam_id": exam_id,
            "title": "Privacy Q",
            "allowed_languages": "java",
        }, headers={"Authorization": f"Bearer {teacher_tok}"})
        question_id = q_resp.json()["id"]

        sub_resp = client.post("/submissions", json={
            "question_id": question_id,
            "language": "java",
            "source_code": "class Main {}",
        }, headers={"Authorization": f"Bearer {student_token}"})
        sub_id = sub_resp.json()["id"]

        # Other student cannot view it
        resp = client.get(f"/submissions/{sub_id}",
                          headers={"Authorization": f"Bearer {other_tok}"})
        assert resp.status_code == 404

    def test_list_submissions_as_student(self, client, student_token):
        resp = client.get("/submissions",
                          headers={"Authorization": f"Bearer {student_token}"})
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_submissions_as_teacher(self, client, teacher_token):
        resp = client.get("/submissions",
                          headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)