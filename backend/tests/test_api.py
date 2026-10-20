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
            "exam_id": exam_id, "title": "Q1", "question_type": "stdio",
        }, headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 201
        assert resp.json()["title"] == "Q1"

    def test_list_by_exam(self, client, teacher_token):
        resp = client.get("/questions?exam_id=1", headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 200


class TestTestCaseEndpoints:
    def test_create_test_case(self, client, teacher_token):
        resp = client.post("/test-cases", json={
            "question_id": 1, "input_data": "test", "expected_output": "tset",
        }, headers={"Authorization": f"Bearer {teacher_token}"})
        assert resp.status_code == 201