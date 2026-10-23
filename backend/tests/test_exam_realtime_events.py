import uuid

from app.api import exams as exams_api


def _create_user(client, role: str) -> str:
    suffix = uuid.uuid4().hex[:12]
    username = f"rt_{role}_{suffix}"
    response = client.post(
        "/auth/register",
        json={
            "username": username,
            "password": "realtime-pass-123",
            "full_name": f"Realtime {role}",
            "role": role,
        },
    )
    assert response.status_code == 201
    response = client.post(
        "/auth/login",
        json={"username": username, "password": "realtime-pass-123"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def test_exam_status_transitions_emit_student_events_after_commit(client):
    teacher_token = _create_user(client, "teacher")
    student_token = _create_user(client, "student")
    teacher_headers = {"Authorization": f"Bearer {teacher_token}"}
    exam_response = client.post(
        "/exams",
        json={"title": "Realtime Lifecycle Exam"},
        headers=teacher_headers,
    )
    assert exam_response.status_code == 201
    exam_id = exam_response.json()["id"]

    with client.websocket_connect(f"/ws/realtime?token={student_token}") as websocket:
        assert websocket.receive_json()["type"] == "connection.ready"

        started = client.put(
            f"/exams/{exam_id}",
            json={"status": "started"},
            headers=teacher_headers,
        )
        assert started.status_code == 200
        assert started.json()["status"] == "started"
        start_event = websocket.receive_json()
        assert start_event["type"] == "exam.started"
        assert start_event["payload"] == {
            "exam_id": exam_id,
            "title": "Realtime Lifecycle Exam",
        }

        ended = client.put(
            f"/exams/{exam_id}",
            json={"status": "ended"},
            headers=teacher_headers,
        )
        assert ended.status_code == 200
        assert ended.json()["status"] == "ended"
        end_event = websocket.receive_json()
        assert end_event["type"] == "exam.ended"
        assert end_event["payload"] == {
            "exam_id": exam_id,
            "title": "Realtime Lifecycle Exam",
        }


def test_student_cannot_trigger_teacher_exam_events(client):
    teacher_token = _create_user(client, "teacher")
    student_token = _create_user(client, "student")
    exam_response = client.post(
        "/exams",
        json={"title": "Protected Exam"},
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    exam_id = exam_response.json()["id"]

    response = client.put(
        f"/exams/{exam_id}",
        json={"status": "started"},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert response.status_code == 403
    persisted = client.get(
        f"/exams/{exam_id}",
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    assert persisted.json()["status"] == "draft"


def test_realtime_failure_does_not_undo_exam_status_commit(client, monkeypatch):
    teacher_token = _create_user(client, "teacher")
    headers = {"Authorization": f"Bearer {teacher_token}"}
    exam_response = client.post(
        "/exams",
        json={"title": "Persist Despite Realtime Failure"},
        headers=headers,
    )
    exam_id = exam_response.json()["id"]

    async def fail_delivery(event, db):
        raise RuntimeError("simulated realtime outage")

    monkeypatch.setattr(exams_api, "publish_bridge_event", fail_delivery)
    response = client.put(
        f"/exams/{exam_id}",
        json={"status": "started"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["status"] == "started"
    persisted = client.get(f"/exams/{exam_id}", headers=headers)
    assert persisted.json()["status"] == "started"
