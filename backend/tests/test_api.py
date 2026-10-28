class TestAuthEndpoints:
    def test_register(self, client):
        resp = client.post("/auth/register", json={
            "username": "fresh_user", "password": "pass123",
            "full_name": "Fresh User", "role": "student",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["username"] == "fresh_user"
        assert data["role"] == "student"

    def test_register_duplicate(self, client):
        resp = client.post("/auth/register", json={
            "username": "fresh_user", "password": "pass123",
            "full_name": "Fresh User", "role": "student",
        })
        assert resp.status_code == 400

    def test_login_success(self, client):
        resp = client.post("/auth/login", json={"username": "fresh_user", "password": "pass123"})
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    def test_login_bad_password(self, client):
        resp = client.post("/auth/login", json={"username": "fresh_user", "password": "wrong"})
        assert resp.status_code == 401

    def test_me(self, client, teacher_token):
        resp = client.get("/auth/me", headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 200
        assert resp.json()["role"] == "teacher"

    def test_me_no_token(self, client):
        resp = client.get("/auth/me")
        assert resp.status_code in (401, 403)


class TestExamEndpoints:
    def test_create_exam_as_teacher(self, client, teacher_token):
        resp = client.post("/exams", json={
            "title": "Test Exam", "duration_minutes": 60,
        }, headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 201
        assert resp.json()["title"] == "Test Exam"
        assert resp.json()["status"] == "draft"

    def test_create_exam_as_student_forbidden(self, client, student_token):
        resp = client.post("/exams", json={
            "title": "Should Fail",
        }, headers={"Authorization": f"Bearer {student_token}"})
        assert resp.status_code == 403

    def test_list_exams(self, client, teacher_token):
        resp = client.get("/exams", headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_get_exam_404(self, client, teacher_token):
        resp = client.get("/exams/9999", headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 404

    def test_update_exam(self, client, teacher_token):
        # create first
        resp = client.post("/exams", json={"title": "To Update"}, headers={"Authorization": f"Bearer {teacher_token}"})
        exam_id = resp.json()["id"]

        resp = client.put(f"/exams/{exam_id}", json={"title": "Updated"}, headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 200
        assert resp.json()["title"] == "Updated"

    def test_delete_exam(self, client, teacher_token):
        resp = client.post("/exams", json={"title": "To Delete"}, headers={"Authorization": f"Bearer {teacher_token}"})
        exam_id = resp.json()["id"]

        resp = client.delete(f"/exams/{exam_id}", headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 204


class TestQuestionEndpoints:
    def test_create_question(self, client, teacher_token):
        resp = client.post("/exams", json={"title": "For Questions"}, headers={"Authorization": f"Bearer {teacher_token}"})
        exam_id = resp.json()["id"]

        resp = client.post("/questions", json={
            "exam_id": exam_id,
            "title": "Q1",
            "question_type": "stdio",
            "boilerplate": "class Main {}",
        }, headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 201
        assert resp.json()["title"] == "Q1"
        assert resp.json()["boilerplate"] == "class Main {}"

    def test_update_question_boilerplate_persists(self, client, teacher_token):
        headers = {"Authorization": "Bearer " + teacher_token}
        exam = client.post(
            "/exams",
            json={"title": "Boilerplate Exam"},
            headers=headers,
        )
        question = client.post(
            "/questions",
            json={"exam_id": exam.json()["id"], "title": "Starter code"},
            headers=headers,
        )

        updated = client.put(
            f"/questions/{question.json()['id']}",
            json={"boilerplate": "public class Solution {}"},
            headers=headers,
        )
        fetched = client.get(
            f"/questions/{question.json()['id']}",
            headers=headers,
        )

        assert updated.status_code == 200
        assert updated.json()["boilerplate"] == "public class Solution {}"
        assert fetched.json()["boilerplate"] == "public class Solution {}"

    def test_create_java_method_question_persists_method_mode(self, client, teacher_token):
        headers = {"Authorization": "Bearer " + teacher_token}
        exam = client.post(
            "/exams",
            json={"title": "Java Method Exam"},
            headers=headers,
        )
        response = client.post(
            "/questions",
            json={
                "exam_id": exam.json()["id"],
                "title": "Custom method",
                "question_type": "java_class",
                "class_name": "Calculator",
                "method_signature": "add(int, int): int",
                "method_mode": "INSTANCE",
            },
            headers=headers,
        )

        assert response.status_code == 201
        assert response.json()["method_mode"] == "INSTANCE"
        assert response.json()["boilerplate"] == ""

    def test_list_by_exam(self, client, teacher_token):
        resp = client.get("/questions?exam_id=1", headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 200


class TestTestCaseEndpoints:
    def test_students_only_receive_sample_test_cases(self, client, teacher_token, student_token):
        auth_teacher = {"Authorization": "Bearer " + teacher_token}
        auth_student = {"Authorization": "Bearer " + student_token}
        exam = client.post(
            "/exams",
            json={"title": "Hidden Test Case Exam"},
            headers=auth_teacher,
        )
        question = client.post(
            "/questions",
            json={"exam_id": exam.json()["id"], "title": "Question"},
            headers=auth_teacher,
        )
        question_id = question.json()["id"]

        sample = client.post(
            "/test-cases",
            json={
                "question_id": question_id,
                "input_data": "visible",
                "expected_output": "sample answer",
                "is_hidden": 0,
            },
            headers=auth_teacher,
        )
        hidden = client.post(
            "/test-cases",
            json={
                "question_id": question_id,
                "input_data": "secret",
                "expected_output": "hidden answer",
                "is_hidden": 1,
            },
            headers=auth_teacher,
        )
        assert sample.status_code == hidden.status_code == 201

        student_cases = client.get(
            f"/test-cases/question/{question_id}",
            headers=auth_student,
        )
        teacher_cases = client.get(
            f"/test-cases/question/{question_id}",
            headers=auth_teacher,
        )

        assert [case["expected_output"] for case in student_cases.json()] == ["sample answer"]
        assert {case["expected_output"] for case in teacher_cases.json()} == {
            "sample answer",
            "hidden answer",
        }

    def test_create_test_case(self, client, teacher_token):
        resp = client.post("/test-cases", json={
            "question_id": 1, "input_data": "test", "expected_output": "tset",
        }, headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 201