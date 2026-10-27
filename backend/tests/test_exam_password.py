def _teacher_token(client, username="exam_pw_teacher"):
    client.post(
        "/auth/register",
        json={
            "username": username,
            "password": "pass123",
            "full_name": "Exam Password Teacher",
            "role": "teacher",
        },
    )
    response = client.post(
        "/auth/login", json={"username": username, "password": "pass123"}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def test_exam_password_lifecycle(client, student_token):
    teacher_token = _teacher_token(client)
    teacher_headers = {"Authorization": f"Bearer {teacher_token}"}
    student_headers = {"Authorization": f"Bearer {student_token}"}

    create = client.post(
        "/exams",
        json={
            "title": "Password Protected Exam",
            "duration_minutes": 60,
            "access_password": "secret-pass",
        },
        headers=teacher_headers,
    )
    assert create.status_code == 201
    exam = create.json()
    assert exam["has_password"] is True
    assert "access_password" not in exam
    assert "access_password_hash" not in exam

    wrong = client.post(
        f"/exams/{exam['id']}/verify-password",
        json={"password": "wrong-pass"},
        headers=student_headers,
    )
    assert wrong.status_code == 200
    assert wrong.json()["valid"] is False

    correct = client.post(
        f"/exams/{exam['id']}/verify-password",
        json={"password": "secret-pass"},
        headers=student_headers,
    )
    assert correct.status_code == 200
    assert correct.json()["valid"] is True

    cleared = client.put(
        f"/exams/{exam['id']}",
        json={"access_password": None},
        headers=teacher_headers,
    )
    assert cleared.status_code == 200
    assert cleared.json()["has_password"] is False

    unlocked = client.post(
        f"/exams/{exam['id']}/verify-password",
        json={"password": "anything"},
        headers=student_headers,
    )
    assert unlocked.status_code == 200
    assert unlocked.json()["valid"] is True


def test_exam_without_password_is_open(client, student_token):
    teacher_token = _teacher_token(client, username="exam_open_teacher")
    create = client.post(
        "/exams",
        json={"title": "Open Exam", "duration_minutes": 60},
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    assert create.status_code == 201
    assert create.json()["has_password"] is False

    response = client.post(
        f"/exams/{create.json()['id']}/verify-password",
        json={"password": "irrelevant"},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert response.status_code == 200
    assert response.json()["valid"] is True
