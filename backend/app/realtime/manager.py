import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.exam import Exam
from app.models.question import Question
from app.models.submission import Submission
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)


@dataclass
class BrowserConnection:
    websocket: WebSocket
    role: str
    connected_at: datetime
    last_seen_at: datetime
    last_persisted_at: datetime

PUBLIC_EVENT_FIELDS: dict[str, set[str]] = {
    "exam.started": {"exam_id", "title", "start_time", "end_time"},
    "exam.ended": {"exam_id", "title", "start_time", "end_time"},
    "exam.announcement": {"exam_id", "announcement_id", "message", "created_at"},
    "submission.received": {"submission_id"},
    "submission.running": {"submission_id"},
    "submission.completed": {"submission_id"},
    "submission.failed": {"submission_id", "error_code"},
    "server.error": {"error", "code"},
}
PUBLIC_BROADCAST_TYPES = {"exam.started", "exam.ended", "exam.announcement"}
PRIVATE_SUBMISSION_TYPES = {
    "submission.received",
    "submission.running",
    "submission.completed",
    "submission.failed",
}
REQUIRED_EVENT_FIELDS = {
    "exam.started": {"exam_id"},
    "exam.ended": {"exam_id"},
    "exam.announcement": {"exam_id", "message"},
    "submission.received": {"submission_id"},
    "submission.running": {"submission_id"},
    "submission.completed": {"submission_id"},
    "submission.failed": {"submission_id"},
    "server.error": {"error"},
}


class RealtimeManager:
    """Tracks browser sockets and routes validated events from trusted backend code."""

    def __init__(
        self,
        heartbeat_timeout_seconds: float = 90.0,
        send_timeout_seconds: float = 5.0,
        heartbeat_persist_interval_seconds: float = 15.0,
    ):
        if (
            heartbeat_timeout_seconds <= 0
            or send_timeout_seconds <= 0
            or heartbeat_persist_interval_seconds < 0
        ):
            raise ValueError("Timeouts must be positive and persistence interval nonnegative")
        self.heartbeat_timeout_seconds = heartbeat_timeout_seconds
        self.send_timeout_seconds = send_timeout_seconds
        self.heartbeat_persist_interval_seconds = heartbeat_persist_interval_seconds
        self._connections: dict[int, dict[int, BrowserConnection]] = {}
        self._presence_locks: dict[int, asyncio.Lock] = {}
        self._lock = asyncio.Lock()

    async def register(self, websocket: WebSocket, user_id: int, role: str) -> int:
        await websocket.accept()
        now = datetime.now(timezone.utc)
        async with self._lock:
            user_connections = self._connections.setdefault(user_id, {})
            user_connections[id(websocket)] = BrowserConnection(
                websocket=websocket,
                role=role,
                connected_at=now,
                last_seen_at=now,
                last_persisted_at=now,
            )
            connection_count = len(user_connections)
        await self._sync_user_presence(user_id)
        return connection_count

    async def unregister(self, websocket: WebSocket, user_id: int) -> bool:
        became_offline = False
        async with self._lock:
            user_connections = self._connections.get(user_id)
            if user_connections is not None:
                removed = user_connections.pop(id(websocket), None)
                if removed is not None and not user_connections:
                    self._connections.pop(user_id, None)
                    became_offline = True
                else:
                    return False
            else:
                return False

        if removed is not None:
            await self._sync_user_presence(user_id)
        return became_offline

    async def record_heartbeat(self, websocket: WebSocket, user_id: int) -> bool:
        """Refresh one authenticated session and persist approximate user liveness."""
        now = datetime.now(timezone.utc)
        should_persist = False
        async with self._lock:
            connection = self._connections.get(user_id, {}).get(id(websocket))
            if connection is None:
                return False
            connection.last_seen_at = now
            if (
                (now - connection.last_persisted_at).total_seconds()
                >= self.heartbeat_persist_interval_seconds
            ):
                connection.last_persisted_at = now
                should_persist = True
        if should_persist:
            await self._sync_user_presence(user_id)
        return True

    async def last_seen(self, websocket: WebSocket, user_id: int) -> datetime | None:
        async with self._lock:
            connection = self._connections.get(user_id, {}).get(id(websocket))
            return connection.last_seen_at if connection else None

    async def connection_count(self, user_id: int) -> int:
        async with self._lock:
            return len(self._connections.get(user_id, {}))

    async def send_to_browser(self, user_id: int, event: dict[str, Any]) -> int:
        outbound = validate_outbound_event(event)
        if outbound["type"] in PRIVATE_SUBMISSION_TYPES:
            raise ValueError("Private submission events must be routed through publish_bridge_event")
        async with self._lock:
            sockets = [
                connection.websocket
                for connection in self._connections.get(user_id, {}).values()
            ]
        return await self._send_to_sockets(user_id, sockets, outbound)

    async def broadcast_to_browsers(self, event: dict[str, Any]) -> int:
        outbound = validate_outbound_event(event)
        if outbound["type"] not in PUBLIC_BROADCAST_TYPES:
            raise ValueError("Only public exam events may be broadcast")
        async with self._lock:
            sockets = [
                connection.websocket
                for entries in self._connections.values()
                for connection in entries.values()
            ]
        return await self._send_to_sockets(None, sockets, outbound)

    async def broadcast_to_role(self, role: str, event: dict[str, Any]) -> int:
        outbound = validate_outbound_event(event)
        if outbound["type"] not in PUBLIC_BROADCAST_TYPES:
            raise ValueError("Only public exam events may be sent to a role")
        async with self._lock:
            sockets = [
                socket
                for entries in self._connections.values()
                for connection in entries.values()
                for socket in (connection.websocket,)
                if connection.role == role
            ]
        return await self._send_to_sockets(None, sockets, outbound)

    async def publish_bridge_event(self, event: dict[str, Any], db: Session) -> int:
        """Route one validated internal event without exposing transport recipients to browsers."""
        outbound = validate_outbound_event(event)
        if outbound["type"] == "server.error":
            outbound["payload"] = {
                "code": outbound["payload"].get("code", "realtime_error"),
                "error": "Realtime operation failed",
            }
        recipient = event.get("recipient")
        if not isinstance(recipient, str):
            raise ValueError("Bridge event recipient is required")

        if outbound["type"] in PRIVATE_SUBMISSION_TYPES:
            user_id = self._authorized_submission_recipient(outbound["payload"], recipient, db)
            return await self._send_private_to_user(user_id, outbound)

        if recipient == "broadcast":
            return await self.broadcast_to_browsers(outbound)
        if recipient == "role:student":
            return await self.broadcast_to_role("student", outbound)
        if recipient == "role:teacher":
            return await self.broadcast_to_role("teacher", outbound)
        if recipient.startswith("student:") or recipient.startswith("teacher:"):
            try:
                user_id = int(recipient.split(":", 1)[1])
            except ValueError as exc:
                raise ValueError("Bridge event recipient is malformed") from exc
            if user_id <= 0:
                raise ValueError("Bridge event recipient is malformed")
            return await self.send_to_browser(user_id, outbound)
        raise ValueError("Bridge event recipient is not supported by the browser layer")

    async def shutdown(self) -> None:
        async with self._lock:
            connections = [
                (user_id, socket)
                for user_id, entries in self._connections.items()
                for connection in entries.values()
                for socket in (connection.websocket,)
            ]
            user_ids = list(self._connections)
            self._connections.clear()

        for user_id, socket in connections:
            try:
                await socket.close(code=1001, reason="Server shutting down")
            except (RuntimeError, OSError, WebSocketDisconnect):
                pass
        for user_id in user_ids:
            await self._sync_user_presence(user_id)

    async def _send_private_to_user(self, user_id: int, event: dict[str, Any]) -> int:
        async with self._lock:
            sockets = [
                connection.websocket
                for connection in self._connections.get(user_id, {}).values()
            ]
        return await self._send_to_sockets(user_id, sockets, event)

    async def _send_to_sockets(
        self,
        user_id: int | None,
        sockets: list[WebSocket],
        event: dict[str, Any],
    ) -> int:
        async def send_one(socket: WebSocket) -> bool:
            try:
                await asyncio.wait_for(
                    socket.send_json(event), timeout=self.send_timeout_seconds
                )
                return True
            except (WebSocketDisconnect, RuntimeError, OSError, asyncio.TimeoutError):
                return False
            except Exception:
                logger.exception("Unexpected realtime send failure")
                return False

        outcomes = await asyncio.gather(*(send_one(socket) for socket in sockets))
        delivered = sum(outcomes)
        failed = [socket for socket, succeeded in zip(sockets, outcomes) if not succeeded]

        await asyncio.gather(*(self._close_failed_socket(socket) for socket in failed))
        for socket in failed:
            if user_id is not None:
                await self.unregister(socket, user_id)
            else:
                await self._unregister_socket(socket)
        return delivered

    @staticmethod
    async def _close_failed_socket(socket: WebSocket) -> None:
        try:
            await asyncio.wait_for(
                socket.close(code=1011, reason="Realtime send failed"), timeout=1.0
            )
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass
        except asyncio.TimeoutError:
            logger.warning("Timed out closing an unresponsive realtime socket")

    async def _unregister_socket(self, socket: WebSocket) -> None:
        async with self._lock:
            user_ids = [
                user_id
                for user_id, entries in self._connections.items()
                if id(socket) in entries
            ]
        for user_id in user_ids:
            await self.unregister(socket, user_id)

    def _authorized_submission_recipient(self, payload: dict[str, Any], recipient: str, db: Session) -> int:
        submission_id = payload.get("submission_id")
        if not isinstance(submission_id, int) or isinstance(submission_id, bool):
            raise ValueError("Submission event requires a valid submission_id")
        submission = db.get(Submission, submission_id)
        if submission is None:
            raise ValueError("Submission event references an unknown submission")

        student_recipient = f"student:{submission.student_id}"
        if recipient == student_recipient:
            student = db.get(User, submission.student_id)
            if student is not None and student.role == UserRole.student:
                return submission.student_id

        question = db.get(Question, submission.question_id)
        exam = db.get(Exam, question.exam_id) if question else None
        if exam:
            teacher = db.get(User, exam.teacher_id)
            if teacher is not None and teacher.role == UserRole.teacher:
                if recipient == f"teacher:{exam.teacher_id}" or recipient == "role:teacher":
                    return exam.teacher_id
        if recipient == "role:student":
            student = db.get(User, submission.student_id)
            if student is not None and student.role == UserRole.student:
                return submission.student_id
        raise ValueError("Submission event recipient is not authorized for this submission")

    def reset_stale_presence(self) -> None:
        """Clear persisted online flags after process restart; sockets are process-local."""
        db = SessionLocal()
        try:
            db.query(User).filter(User.is_online != 0).update(
                {User.is_online: 0}, synchronize_session=False
            )
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Could not clear stale user presence during startup")
        finally:
            db.close()

    async def _sync_user_presence(self, user_id: int) -> None:
        """Persist one user's current session state without holding the global socket lock."""
        presence_lock = self._presence_locks.setdefault(user_id, asyncio.Lock())
        async with presence_lock:
            async with self._lock:
                connections = self._connections.get(user_id, {})
                is_online = bool(connections)
                last_seen_at = (
                    max(item.last_seen_at for item in connections.values())
                    if connections
                    else datetime.now(timezone.utc)
                )
            await asyncio.to_thread(
                self._persist_user_presence, user_id, is_online, last_seen_at
            )

    @staticmethod
    def _persist_user_presence(
        user_id: int, is_online: bool, last_seen_at: datetime
    ) -> None:
        db = SessionLocal()
        try:
            user = db.get(User, user_id)
            if user is not None:
                user.is_online = int(is_online)
                user.last_seen_at = last_seen_at
                db.commit()
        except Exception:
            db.rollback()
            logger.exception("Could not update online state for user %s", user_id)
        finally:
            db.close()


def validate_outbound_event(event: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(event, dict):
        raise ValueError("Realtime event must be an object")
    event_type = event.get("type")
    if not isinstance(event_type, str) or event_type not in PUBLIC_EVENT_FIELDS:
        raise ValueError("Unsupported realtime event type")
    payload = event.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("Realtime event payload must be an object")

    allowed_fields = PUBLIC_EVENT_FIELDS[event_type]
    if any(not isinstance(key, str) or key not in allowed_fields for key in payload):
        raise ValueError("Realtime event contains an unexpected or private payload field")
    if not REQUIRED_EVENT_FIELDS[event_type].issubset(payload):
        raise ValueError("Realtime event is missing required payload fields")
    if event_type in {"exam.started", "exam.ended", "exam.announcement"}:
        _require_positive_id(payload, "exam_id")
    if event_type.startswith("submission."):
        _require_positive_id(payload, "submission_id")
    if "announcement_id" in payload:
        _require_positive_id(payload, "announcement_id")
    if event_type == "exam.announcement":
        _require_text(payload, "message", max_length=4000)
    if event_type == "server.error":
        _require_text(payload, "error", max_length=500)
    if "error_code" in payload:
        _require_text(payload, "error_code", max_length=64)
    for key, max_length in (("title", 200), ("code", 64)):
        if key in payload:
            _require_text(payload, key, max_length)
    for key in ("start_time", "end_time", "created_at"):
        if key in payload:
            _require_timestamp(payload, key)

    request_id = event.get("request_id", event.get("requestId")) or str(uuid.uuid4())
    if not isinstance(request_id, str):
        raise ValueError("Realtime request_id must be a UUID")
    try:
        request_id = str(uuid.UUID(request_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("Realtime request_id must be a UUID") from exc

    timestamp = event.get("timestamp") or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    if not isinstance(timestamp, str):
        raise ValueError("Realtime timestamp must be ISO-8601 text")
    try:
        parsed_timestamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Realtime timestamp must be ISO-8601 text") from exc
    if parsed_timestamp.utcoffset() is None:
        raise ValueError("Realtime timestamp must include a timezone")

    outbound = {
        "type": event_type,
        "request_id": request_id,
        "timestamp": timestamp,
        "payload": payload,
    }
    if len(json.dumps(outbound, ensure_ascii=False).encode("utf-8")) > 64 * 1024:
        raise ValueError("Realtime event exceeds the message size limit")
    return outbound


def _require_positive_id(payload: dict[str, Any], key: str) -> None:
    value = payload.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"Realtime payload requires a positive integer {key}")


def _require_text(payload: dict[str, Any], key: str, max_length: int) -> None:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > max_length:
        raise ValueError(f"Realtime payload requires valid {key} text")


def _require_timestamp(payload: dict[str, Any], key: str) -> None:
    value = payload.get(key)
    if not isinstance(value, str):
        raise ValueError(f"Realtime payload requires ISO-8601 {key}")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"Realtime payload requires ISO-8601 {key}") from exc
    if parsed.utcoffset() is None:
        raise ValueError(f"Realtime payload requires a timezone in {key}")


realtime_manager = RealtimeManager()


async def publish_bridge_event(event: dict[str, Any], db: Session) -> int:
    """Entry point for an in-process realtime bridge to deliver an internal event to browsers."""
    try:
        return await realtime_manager.publish_bridge_event(event, db)
    except ValueError as exc:
        logger.warning("Dropped invalid realtime bridge event (%s)", type(exc).__name__)
        return 0
    except Exception:
        logger.exception("Realtime bridge event delivery failed")
        return 0
