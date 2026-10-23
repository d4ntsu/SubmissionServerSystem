import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.database import SessionLocal
from app.core.security import create_access_token
from app.main import app
from app.models.exam import Exam
from app.models.question import Question, QuestionType
from app.models.submission import Submission, SubmissionStatus
from app.realtime.manager import RealtimeManager


def _user_id(client: TestClient, token: str) -> int:
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    return response.json()["id"]


def _ws_path(token: str) -> str:
    return f"/ws/realtime?token={token}"


def test_authenticated_connection_and_heartbeat(client, student_token):
    student_id = _user_id(client, student_token)
    with client.websocket_connect(_ws_path(student_token)) as websocket:
        ready = websocket.receive_json()
        assert ready["type"] == "connection.ready"
        assert ready["user_id"] == student_id
        assert ready["role"] == "student"

        request_id = str(uuid.uuid4())
        websocket.send_json({"type": "client.heartbeat", "request_id": request_id})
        heartbeat = websocket.receive_json()
        assert heartbeat["type"] == "client.heartbeat"
        assert heartbeat["request_id"] == request_id
        assert heartbeat["payload"] == {"alive": True}


def test_websocket_role_comes_from_database_not_jwt_role_claim(client, student_token):
    student_id = _user_id(client, student_token)
    forged_role_token = create_access_token({"user_id": student_id, "role": "teacher"})

    with client.websocket_connect(_ws_path(forged_role_token)) as websocket:
        ready = websocket.receive_json()
        assert ready["role"] == "student"


@pytest.mark.parametrize("path", ["/ws/realtime", "/ws/realtime?token=not-a-valid-token"])
def test_unauthenticated_or_invalid_token_is_rejected(client, path):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(path):
            pass


def test_untrusted_browser_origin_is_rejected(client, student_token):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            _ws_path(student_token),
            headers={"origin": "https://attacker.example"},
        ):
            pass


def test_multiple_users_can_connect_at_the_same_time(client, teacher_token, student_token):
    with client.websocket_connect(_ws_path(teacher_token)) as teacher_socket:
        teacher_ready = teacher_socket.receive_json()
        with client.websocket_connect(_ws_path(student_token)) as student_socket:
            student_ready = student_socket.receive_json()
            assert teacher_ready["user_id"] != student_ready["user_id"]
            assert teacher_ready["role"] == "teacher"
            assert student_ready["role"] == "student"


def test_multiple_tabs_only_mark_user_offline_after_last_disconnect(client, student_token):
    student_id = _user_id(client, student_token)
    first_socket = client.websocket_connect(_ws_path(student_token))
    second_socket = client.websocket_connect(_ws_path(student_token))
    first = first_socket.__enter__()
    second = second_socket.__enter__()
    try:
        assert first.receive_json()["connection_count"] == 1
        assert second.receive_json()["connection_count"] == 2
        first_socket.__exit__(None, None, None)

        response = client.get("/auth/me", headers={"Authorization": f"Bearer {student_token}"})
        assert response.json()["id"] == student_id
        assert response.json()["is_online"] == 1
    finally:
        second_socket.__exit__(None, None, None)

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {student_token}"})
    assert response.json()["is_online"] == 0


def test_reconnect_registers_a_new_connection(client, student_token):
    with client.websocket_connect(_ws_path(student_token)) as websocket:
        assert websocket.receive_json()["connection_count"] == 1
    with client.websocket_connect(_ws_path(student_token)) as websocket:
        assert websocket.receive_json()["connection_count"] == 1


def test_malformed_and_authoritative_client_events_are_rejected(client, student_token):
    with client.websocket_connect(_ws_path(student_token)) as websocket:
        websocket.receive_json()
        websocket.send_text("{malformed-json")
        malformed = websocket.receive_json()
        assert malformed["type"] == "server.error"
        assert malformed["code"] == "malformed_json"

        websocket.send_json({"type": "submission.completed", "payload": {"submission_id": 1}})
        unauthorized = websocket.receive_json()
        assert unauthorized["type"] == "server.error"
        assert unauthorized["code"] == "unsupported_client_event"

        websocket.send_json({"type": "client.heartbeat"})
        assert websocket.receive_json()["payload"] == {"alive": True}


class FakeWebSocket:
    def __init__(self):
        self.sent = []
        self.closed = []

    async def accept(self):
        pass

    async def send_json(self, event):
        self.sent.append(event)

    async def close(self, code=1000, reason=None):
        self.closed.append((code, reason))


def test_targeted_and_public_events_route_without_broadcasting_submission_data(
    client, teacher_token, student_token
):
    teacher_id = _user_id(client, teacher_token)
    student_id = _user_id(client, student_token)
    manager = RealtimeManager()
    student_socket = FakeWebSocket()
    teacher_socket = FakeWebSocket()

    announcement = {
        "type": "exam.announcement",
        "recipient": "broadcast",
        "payload": {"exam_id": 12, "message": "Exam starts soon"},
    }
    submission_event = {
        "type": "submission.completed",
        "recipient": f"student:{student_id}",
        "payload": {"submission_id": 9},
    }
    async def run_scenario():
        await manager.register(student_socket, student_id, "student")
        await manager.register(teacher_socket, teacher_id, "teacher")
        assert await manager.broadcast_to_browsers(announcement) == 2
        assert len(student_socket.sent) == len(teacher_socket.sent) == 1

        targeted_announcement = {**announcement, "recipient": f"student:{student_id}"}
        assert await manager.send_to_browser(student_id, targeted_announcement) == 1
        assert len(student_socket.sent) == 2
        assert len(teacher_socket.sent) == 1

        with pytest.raises(ValueError, match="Only public exam events"):
            await manager.broadcast_to_browsers(submission_event)
        with pytest.raises(ValueError, match="publish_bridge_event"):
            await manager.send_to_browser(student_id, submission_event)
        await manager.shutdown()
        assert student_socket.closed == [(1001, "Server shutting down")]
        assert teacher_socket.closed == [(1001, "Server shutting down")]

    asyncio.run(run_scenario())


def test_bridge_submission_events_are_owner_targeted_and_payloads_are_filtered(
    client, teacher_token, student_token
):
    teacher_id = _user_id(client, teacher_token)
    student_id = _user_id(client, student_token)
    db = SessionLocal()
    exam = None
    student_socket = FakeWebSocket()
    teacher_socket = FakeWebSocket()
    other_socket = FakeWebSocket()
    manager = RealtimeManager()

    try:
        exam = Exam(title="Realtime test exam", teacher_id=teacher_id)
        db.add(exam)
        db.flush()
        question = Question(
            exam_id=exam.id,
            title="Realtime test question",
            question_type=QuestionType.stdio,
            allowed_languages="python",
        )
        db.add(question)
        db.flush()
        submission = Submission(
            student_id=student_id,
            question_id=question.id,
            language="python",
            source_code="must not reach browser",
            status=SubmissionStatus.completed,
            max_score=100,
        )
        db.add(submission)
        db.commit()
        submission_id = submission.id

        event = {
            "type": "submission.completed",
            "recipient": f"student:{student_id}",
            "payload": {"submission_id": submission_id},
        }
        sensitive_payload = {
            **event,
            "payload": {"submission_id": submission_id, "score": 100},
        }

        async def run_scenario():
            await manager.register(student_socket, student_id, "student")
            await manager.register(teacher_socket, teacher_id, "teacher")
            await manager.register(other_socket, student_id + 100000, "student")
            assert await manager.publish_bridge_event(event, db) == 1
            assert len(student_socket.sent) == 1
            assert teacher_socket.sent == []
            assert other_socket.sent == []
            assert "source_code" not in student_socket.sent[0]["payload"]

            teacher_event = {**event, "recipient": "role:teacher"}
            assert await manager.publish_bridge_event(teacher_event, db) == 1
            assert len(teacher_socket.sent) == 1
            assert other_socket.sent == []

            unauthorized_recipient = {**event, "recipient": f"student:{student_id + 100000}"}
            with pytest.raises(ValueError, match="not authorized"):
                await manager.publish_bridge_event(unauthorized_recipient, db)
            with pytest.raises(ValueError, match="unexpected or private"):
                await manager.publish_bridge_event(sensitive_payload, db)
            await manager.shutdown()

        asyncio.run(run_scenario())
    finally:
        if exam is not None:
            if "submission" in locals():
                db.delete(submission)
            if "question" in locals():
                db.delete(question)
            db.delete(exam)
            db.commit()
        db.close()


def test_stale_websocket_is_closed_and_unregistered(client, student_token):
    student_id = _user_id(client, student_token)
    manager = app.state.realtime_manager
    original_timeout = manager.heartbeat_timeout_seconds
    manager.heartbeat_timeout_seconds = 0.05
    try:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(_ws_path(student_token)) as websocket:
                websocket.receive_json()
                websocket.receive_json()
    finally:
        manager.heartbeat_timeout_seconds = original_timeout

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {student_token}"})
    assert response.json()["id"] == student_id
    assert response.json()["is_online"] == 0
