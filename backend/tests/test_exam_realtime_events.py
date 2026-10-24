import asyncio
import uuid

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.api import exams as exams_api
from app.database import SessionLocal, get_db
from app.main import app as fastapi_app
from app.models.announcement import Announcement
from app.models.exam import Exam, ExamParticipant, ExamStatus
from app.models.user import User
from app.realtime.manager import RealtimeManager


def _create_user(client, role: str) -> tuple[str, int]:
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
    token = response.json()["access_token"]
    user_id = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {token}"}
    ).json()["id"]
    return token, user_id


class RecordingBridge:
    def __init__(self):
        self.events = []
        self.persisted_before_send = []

    async def send(self, event):
        self.events.append(event)
        db = SessionLocal()
        try:
            if event["type"] == "announcement.created":
                self.persisted_before_send.append(
                    db.get(Announcement, event["payload"]["announcement_id"]) is not None
                )
            else:
                exam = db.get(Exam, event["payload"]["exam_id"])
                self.persisted_before_send.append(
                    exam.status.value == event["type"].removeprefix("exam.")
                )
        finally:
            db.close()
        return True


def _create_published_exam(client, teacher_token: str) -> int:
    headers = {"Authorization": f"Bearer {teacher_token}"}
    response = client.post("/exams", json={"title": "Realtime Exam"}, headers=headers)
    assert response.status_code == 201
    exam_id = response.json()["id"]
    response = client.put(
        f"/exams/{exam_id}", json={"status": "published"}, headers=headers
    )
    assert response.status_code == 200
    return exam_id


def test_exam_started_and_ended_are_queued_after_persisted_transitions(client, monkeypatch):
    teacher_token, _ = _create_user(client, "teacher")
    student_token, _ = _create_user(client, "student")
    exam_id = _create_published_exam(client, teacher_token)
    assert client.post(
        f"/exams/{exam_id}/join",
        headers={"Authorization": f"Bearer {student_token}"},
    ).status_code == 204

    bridge = RecordingBridge()
    monkeypatch.setattr(fastapi_app.state, "realtime_bridge", bridge)
    headers = {"Authorization": f"Bearer {teacher_token}"}

    started = client.put(
        f"/exams/{exam_id}", json={"status": "started"}, headers=headers
    )
    ended = client.put(
        f"/exams/{exam_id}", json={"status": "ended"}, headers=headers
    )

    assert started.status_code == ended.status_code == 200
    assert [event["type"] for event in bridge.events] == ["exam.started", "exam.ended"]
    assert all(event["recipient"] == f"exam:{exam_id}" for event in bridge.events)
    assert all(event["payload"] == {"exam_id": exam_id, "title": "Realtime Exam"}
               for event in bridge.events)
    assert bridge.persisted_before_send == [True, True]


def test_student_cannot_trigger_teacher_exam_events(client):
    teacher_token, _ = _create_user(client, "teacher")
    student_token, _ = _create_user(client, "student")
    exam_id = _create_published_exam(client, teacher_token)

    response = client.put(
        f"/exams/{exam_id}",
        json={"status": "started"},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert response.status_code == 403
    persisted = client.get(
        f"/exams/{exam_id}", headers={"Authorization": f"Bearer {teacher_token}"}
    )
    assert persisted.json()["status"] == "published"


def test_announcement_is_persisted_then_queued_for_exam_participants(client, monkeypatch):
    teacher_token, _ = _create_user(client, "teacher")
    other_teacher_token, _ = _create_user(client, "teacher")
    student_token, _ = _create_user(client, "student")
    exam_id = _create_published_exam(client, teacher_token)
    assert client.post(
        f"/exams/{exam_id}/join",
        headers={"Authorization": f"Bearer {student_token}"},
    ).status_code == 204

    bridge = RecordingBridge()
    monkeypatch.setattr(fastapi_app.state, "realtime_bridge", bridge)
    response = client.post(
        f"/exams/{exam_id}/announcements",
        json={"content": "  Please begin when the exam starts.  "},
        headers={"Authorization": f"Bearer {teacher_token}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["exam_id"] == exam_id
    assert body["teacher_id"] > 0
    assert body["content"] == "Please begin when the exam starts."
    assert body["created_at"]
    assert bridge.persisted_before_send == [True]
    assert bridge.events == [{
        "type": "announcement.created",
        "recipient": f"exam:{exam_id}",
        "payload": {
            "exam_id": exam_id,
            "announcement_id": body["announcement_id"],
            "message": body["content"],
            "created_at": bridge.events[0]["payload"]["created_at"],
        },
    }]

    denied = client.post(
        f"/exams/{exam_id}/announcements",
        json={"content": "Unauthorized"},
        headers={"Authorization": f"Bearer {other_teacher_token}"},
    )
    assert denied.status_code == 403


@pytest.mark.parametrize("content", ["", "   ", "x" * 4001])
def test_invalid_announcement_content_is_rejected(client, content):
    teacher_token, _ = _create_user(client, "teacher")
    exam_id = _create_published_exam(client, teacher_token)
    response = client.post(
        f"/exams/{exam_id}/announcements",
        json={"content": content},
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    assert response.status_code == 422


def test_student_cannot_create_announcement(client, student_token):
    teacher_token, _ = _create_user(client, "teacher")
    exam_id = _create_published_exam(client, teacher_token)
    response = client.post(
        f"/exams/{exam_id}/announcements",
        json={"content": "Student announcement"},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert response.status_code == 403


def test_announcement_persistence_failure_does_not_queue_event(client, monkeypatch):
    teacher_token, _ = _create_user(client, "teacher")
    exam_id = _create_published_exam(client, teacher_token)
    bridge = RecordingBridge()
    monkeypatch.setattr(fastapi_app.state, "realtime_bridge", bridge)

    def fail_commit_dependency():
        db = SessionLocal()
        try:
            def fail_commit():
                raise SQLAlchemyError("simulated persistence failure")

            db.commit = fail_commit
            yield db
        finally:
            db.close()

    fastapi_app.dependency_overrides[get_db] = fail_commit_dependency
    try:
        with pytest.raises(SQLAlchemyError, match="simulated persistence failure"):
            client.post(
                f"/exams/{exam_id}/announcements",
                json={"content": "Must not be sent"},
                headers={"Authorization": f"Bearer {teacher_token}"},
            )
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)

    assert bridge.events == []


def test_realtime_failure_does_not_undo_exam_or_announcement_persistence(client, monkeypatch):
    teacher_token, _ = _create_user(client, "teacher")
    exam_id = _create_published_exam(client, teacher_token)

    class FailingBridge:
        async def send(self, _event):
            raise RuntimeError("simulated TCP outage")

    monkeypatch.setattr(fastapi_app.state, "realtime_bridge", FailingBridge())
    headers = {"Authorization": f"Bearer {teacher_token}"}
    started = client.put(
        f"/exams/{exam_id}", json={"status": "started"}, headers=headers
    )
    announcement = client.post(
        f"/exams/{exam_id}/announcements",
        json={"content": "Persist through a realtime outage"},
        headers=headers,
    )

    assert started.status_code == 200
    assert started.json()["status"] == "started"
    assert announcement.status_code == 201
    assert announcement.json()["content"] == "Persist through a realtime outage"
    db = SessionLocal()
    try:
        assert db.get(Exam, exam_id).status == ExamStatus.started
        assert db.get(Announcement, announcement.json()["announcement_id"]) is not None
    finally:
        db.close()


def test_exam_events_reach_participant_and_teacher_but_not_nonparticipant(client):
    teacher_token, teacher_id = _create_user(client, "teacher")
    participant_token, participant_id = _create_user(client, "student")
    outsider_token, outsider_id = _create_user(client, "student")
    exam_id = _create_published_exam(client, teacher_token)
    assert client.post(
        f"/exams/{exam_id}/join",
        headers={"Authorization": f"Bearer {participant_token}"},
    ).status_code == 204

    class Socket:
        def __init__(self):
            self.sent = []

        async def accept(self):
            pass

        async def send_json(self, event):
            self.sent.append(event)

        async def close(self, code=1000, reason=None):
            pass

    db = SessionLocal()
    manager = RealtimeManager()

    async def no_presence_write(_user_id):
        return None

    manager._sync_user_presence = no_presence_write
    teacher_socket, participant_socket, outsider_socket = Socket(), Socket(), Socket()
    event = {
        "type": "announcement.created",
        "recipient": f"exam:{exam_id}",
        "payload": {
            "exam_id": exam_id,
            "announcement_id": 1,
            "message": "Only participants should receive this",
            "created_at": "2026-10-24T00:00:00Z",
        },
    }

    async def route_and_cleanup():
        await manager.register(teacher_socket, teacher_id, "teacher")
        await manager.register(participant_socket, participant_id, "student")
        await manager.register(outsider_socket, outsider_id, "student")
        delivered = await manager.publish_bridge_event(event, db)
        await manager.shutdown()
        return delivered

    try:
        delivered = asyncio.run(route_and_cleanup())
    finally:
        db.close()

    assert delivered == 2
    assert [item["type"] for item in teacher_socket.sent] == ["announcement.created"]
    assert [item["type"] for item in participant_socket.sent] == ["announcement.created"]
    assert outsider_socket.sent == []
