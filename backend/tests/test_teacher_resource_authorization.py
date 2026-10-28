def _login(client, username, role):
    registration = client.post(
        "/auth/register",
        json={
            "username": username,
            "password": "pass123",
            "full_name": username,
            "role": role,
        },
    )
    assert registration.status_code in (201, 400)
    response = client.post(
        "/auth/login",
        json={"username": username, "password": "pass123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_exam_and_question(client, teacher_headers, title):
    exam_response = client.post(
        "/exams",
        json={"title": title, "duration_minutes": 60},
        headers=teacher_headers,
    )
    assert exam_response.status_code == 201
    exam_id = exam_response.json()["id"]

    question_response = client.post(
        "/questions",
        json={"exam_id": exam_id, "title": f"{title} question"},
        headers=teacher_headers,
    )
    assert question_response.status_code == 201
    return exam_id, question_response.json()["id"]


def test_teacher_can_only_manage_questions_and_test_cases_for_owned_exams(
    client, teacher_token, student_token
):
    owner_headers = {"Authorization": f"Bearer {teacher_token}"}
    other_teacher_headers = _login(client, "authz_other_teacher", "teacher")
    student_headers = {"Authorization": f"Bearer {student_token}"}
    exam_id, question_id = _create_exam_and_question(client, owner_headers, "Owned exam")

    test_case_response = client.post(
        "/test-cases",
        json={"question_id": question_id, "input_data": "1", "expected_output": "1"},
        headers=owner_headers,
    )
    assert test_case_response.status_code == 201
    test_case_id = test_case_response.json()["id"]

    create_question = client.post(
        "/questions",
        json={"exam_id": exam_id, "title": "Unauthorized question"},
        headers=other_teacher_headers,
    )
    update_question = client.put(
        f"/questions/{question_id}",
        json={"title": "Unauthorized edit"},
        headers=other_teacher_headers,
    )
    delete_question = client.delete(
        f"/questions/{question_id}", headers=other_teacher_headers
    )
    create_test_case = client.post(
        "/test-cases",
        json={"question_id": question_id, "expected_output": "1"},
        headers=other_teacher_headers,
    )
    delete_test_case = client.delete(
        f"/test-cases/{test_case_id}", headers=other_teacher_headers
    )

    assert create_question.status_code == 403
    assert update_question.status_code == 403
    assert delete_question.status_code == 403
    assert create_test_case.status_code == 403
    assert delete_test_case.status_code == 403

    student_attempt = client.put(
        f"/questions/{question_id}",
        json={"title": "Student edit"},
        headers=student_headers,
    )
    assert student_attempt.status_code == 403


def test_teacher_submission_and_result_reads_are_limited_to_owned_exams(
    client, teacher_token, student_token
):
    owner_headers = {"Authorization": f"Bearer {teacher_token}"}
    other_teacher_headers = _login(client, "authz_results_teacher", "teacher")
    student_headers = {"Authorization": f"Bearer {student_token}"}
    exam_id, question_id = _create_exam_and_question(
        client, owner_headers, "Submission ownership exam"
    )
    for status in ("published", "started"):
        response = client.put(
            f"/exams/{exam_id}",
            json={"status": status},
            headers=owner_headers,
        )
        assert response.status_code == 200

    submission_response = client.post(
        "/submissions",
        json={
            "question_id": question_id,
            "language": "java",
            "source_code": "class Main {}",
        },
        headers=student_headers,
    )
    assert submission_response.status_code == 201
    submission_id = submission_response.json()["id"]

    assert client.get("/submissions", headers=other_teacher_headers).json() == []
    assert client.get(
        f"/submissions/{submission_id}", headers=other_teacher_headers
    ).status_code == 404
    assert client.get(
        f"/results/{submission_id}", headers=other_teacher_headers
    ).status_code == 404
    assert client.get(
        f"/results/exam/{exam_id}", headers=other_teacher_headers
    ).status_code == 404

    assert client.get(
        f"/submissions/{submission_id}", headers=owner_headers
    ).status_code == 200
    assert client.get(
        f"/results/{submission_id}", headers=owner_headers
    ).status_code == 200
    assert client.get(
        f"/results/exam/{exam_id}", headers=owner_headers
    ).status_code == 200
