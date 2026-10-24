import uuid
import time
from contextlib import ExitStack

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.exam import Exam
from app.models.user import User


@pytest.fixture
def acceptance_client(monkeypatch):
    from app.workers import grading_worker

    monkeypatch.setattr(grading_worker, "_recover_stuck_submissions", lambda: None)
    monkeypatch.setattr(grading_worker, "_claim_next_submission", lambda: None)
    with TestClient(app) as test_client:
        class InProcessJavaBridge:
            async def send(self, event):
                db = SessionLocal()
                try:
                    await app.state.realtime_manager.publish_bridge_event(event, db)
                finally:
                    db.close()
                return True

        monkeypatch.setattr(app.state, "realtime_bridge", InProcessJavaBridge())
        yield test_client


def _register_and_login(client, role: str) -> tuple[str, int]:
    username = f"accept_{role}_{uuid.uuid4().hex[:12]}"
    password = "acceptance-test-pass"
    registered = client.post(
        "/auth/register",
        json={
            "username": username,
            "password": password,
            "full_name": f"Acceptance {role}",
            "role": role,
        },
    )
    assert registered.status_code == 201, registered.text
    login = client.post("/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    profile = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert profile.status_code == 200, profile.text
    return token, profile.json()["id"]


def _wait_until_offline(client: TestClient, token: str, timeout_seconds: float = 1.0):
    deadline = time.monotonic() + timeout_seconds
    while True:
        profile = client.get(
            "/auth/me", headers={"Authorization": f"Bearer {token}"}
        ).json()
        if profile["is_online"] == 0:
            return profile
        if time.monotonic() >= deadline:
            pytest.fail("WebSocket disconnect was not reflected as offline in time")
        time.sleep(0.01)


def test_complete_realtime_acceptance_workflow(acceptance_client):
    client = acceptance_client
    created_user_ids: list[int] = []
    exam_id: int | None = None
    try:
        teacher_token, teacher_id = _register_and_login(client, "teacher")
        student_token, student_id = _register_and_login(client, "student")
        created_user_ids.extend([teacher_id, student_id])
        teacher_headers = {"Authorization": f"Bearer {teacher_token}"}
        student_headers = {"Authorization": f"Bearer {student_token}"}

        created_exam = client.post(
            "/exams",
            headers=teacher_headers,
            json={"title": "Realtime Acceptance Exam"},
        )
        assert created_exam.status_code == 201, created_exam.text
        exam_id = created_exam.json()["id"]
        published = client.put(
            f"/exams/{exam_id}",
            headers=teacher_headers,
            json={"status": "published"},
        )
        assert published.status_code == 200
        assert client.post(
            f"/exams/{exam_id}/join", headers=student_headers
        ).status_code == 204

        denied = client.put(
            f"/exams/{exam_id}",
            headers=student_headers,
            json={"status": "started"},
        )
        assert denied.status_code == 403

        ws_path = f"/ws/realtime?token={student_token}"
        with client.websocket_connect(ws_path) as first_tab:
            first_ready = first_tab.receive_json()
            assert first_ready["type"] == "connection.ready"
            assert first_ready["role"] == "student"
            assert first_ready["connection_count"] == 1

            with client.websocket_connect(ws_path) as second_tab:
                second_ready = second_tab.receive_json()
                assert second_ready["connection_count"] == 2

                first_tab.send_json({"type": "client.heartbeat", "request_id": str(uuid.uuid4())})
                heartbeat = first_tab.receive_json()
                assert heartbeat["type"] == "client.heartbeat"
                assert heartbeat["payload"] == {"alive": True}

                first_tab.send_json({
                    "type": "exam.started",
                    "payload": {"exam_id": exam_id},
                })
                rejected = first_tab.receive_json()
                assert rejected["type"] == "server.error"
                assert rejected["code"] == "unsupported_client_event"

                started = client.put(
                    f"/exams/{exam_id}",
                    headers=teacher_headers,
                    json={"status": "started"},
                )
                assert started.status_code == 200
                assert started.json()["status"] == "started"
                for socket in (first_tab, second_tab):
                    event = socket.receive_json()
                    assert event["type"] == "exam.started"
                    assert event["payload"] == {
                        "exam_id": exam_id,
                        "title": "Realtime Acceptance Exam",
                    }
                persisted = client.get(f"/exams/{exam_id}", headers=teacher_headers)
                assert persisted.json()["status"] == "started"

                ended = client.put(
                    f"/exams/{exam_id}",
                    headers=teacher_headers,
                    json={"status": "ended"},
                )
                assert ended.status_code == 200
                assert ended.json()["status"] == "ended"
                for socket in (first_tab, second_tab):
                    event = socket.receive_json()
                    assert event["type"] == "exam.ended"
                    assert event["payload"]["exam_id"] == exam_id

            still_online = client.get("/auth/me", headers=student_headers)
            assert still_online.json()["is_online"] == 1

        offline = _wait_until_offline(client, student_token)
        assert offline["is_online"] == 0
    finally:
        db = SessionLocal()
        try:
            if exam_id is not None:
                db.query(Exam).filter(Exam.id == exam_id).delete(synchronize_session=False)
            if created_user_ids:
                db.query(User).filter(User.id.in_(created_user_ids)).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()

        if created_user_ids:
            # Ensure this end-to-end test leaves no connection state in the app singleton.
            manager = app.state.realtime_manager
            assert all(manager._connections.get(user_id) is None for user_id in created_user_ids)


def test_five_browser_clients_receive_exam_events_and_heartbeat(acceptance_client):
    client = acceptance_client
    created_user_ids: list[int] = []
    exam_id: int | None = None
    try:
        teacher_token, teacher_id = _register_and_login(client, "teacher")
        created_user_ids.append(teacher_id)
        teacher_headers = {"Authorization": f"Bearer {teacher_token}"}
        student_credentials = [_register_and_login(client, "student") for _ in range(5)]
        student_tokens = [token for token, user_id in student_credentials]
        created_user_ids.extend(user_id for token, user_id in student_credentials)

        created_exam = client.post(
            "/exams",
            headers=teacher_headers,
            json={"title": "Five Client Realtime Exam"},
        )
        assert created_exam.status_code == 201, created_exam.text
        exam_id = created_exam.json()["id"]
        published = client.put(
            f"/exams/{exam_id}",
            headers=teacher_headers,
            json={"status": "published"},
        )
        assert published.status_code == 200
        for token in student_tokens:
            joined = client.post(
                f"/exams/{exam_id}/join",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert joined.status_code == 204

        with ExitStack() as sockets_context:
            sockets = [
                sockets_context.enter_context(
                    client.websocket_connect(f"/ws/realtime?token={token}")
                )
                for token in student_tokens
            ]
            for socket, (_, user_id) in zip(sockets, student_credentials):
                ready = socket.receive_json()
                assert ready["type"] == "connection.ready"
                assert ready["user_id"] == user_id

            for _ in range(2):
                for socket in sockets:
                    socket.send_json({"type": "client.heartbeat", "request_id": str(uuid.uuid4())})
                for socket in sockets:
                    assert socket.receive_json()["payload"] == {"alive": True}

            started = client.put(
                f"/exams/{exam_id}",
                headers=teacher_headers,
                json={"status": "started"},
            )
            assert started.status_code == 200
            for socket in sockets:
                event = socket.receive_json()
                assert event["type"] == "exam.started"
                assert event["payload"]["exam_id"] == exam_id

            ended = client.put(
                f"/exams/{exam_id}",
                headers=teacher_headers,
                json={"status": "ended"},
            )
            assert ended.status_code == 200
            for socket in sockets:
                event = socket.receive_json()
                assert event["type"] == "exam.ended"
                assert event["payload"]["exam_id"] == exam_id

            for token in student_tokens:
                profile = client.get(
                    "/auth/me", headers={"Authorization": f"Bearer {token}"}
                ).json()
                assert profile["is_online"] == 1
                assert profile["last_seen_at"] is not None
    finally:
        db = SessionLocal()
        try:
            if exam_id is not None:
                db.query(Exam).filter(Exam.id == exam_id).delete(synchronize_session=False)
            if created_user_ids:
                db.query(User).filter(User.id.in_(created_user_ids)).delete(
                    synchronize_session=False
                )
            db.commit()
        finally:
            db.close()

        manager = app.state.realtime_manager
        assert all(manager._connections.get(user_id) is None for user_id in created_user_ids)
