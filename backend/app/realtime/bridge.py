import asyncio
import hashlib
import hmac
import json
import logging
import re
import time
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

from app.realtime.event_router import RealtimeEventRouter

logger = logging.getLogger(__name__)

MAX_FRAME_BYTES = 64 * 1024
OUTBOUND_QUEUE_SIZE = 256
CONNECT_TIMEOUT_SECONDS = 3.0
AUTH_TIMEOUT_SECONDS = 3.0
WRITE_TIMEOUT_SECONDS = 5.0
INITIAL_RETRY_SECONDS = 1.0
MAX_RETRY_SECONDS = 30.0
STABLE_CONNECTION_SECONDS = 30.0
TCP_HEARTBEAT_INTERVAL_SECONDS = 30.0
TCP_HEARTBEAT_TIMEOUT_SECONDS = 15.0
EVENT_DEDUP_TTL_SECONDS = 300.0
EVENT_DEDUP_MAX_ENTRIES = 4096
DEDUPLICATED_EVENT_TYPES = {
    "exam.started",
    "exam.ended",
    "exam.announcement",
    "announcement.created",
    "submission.received",
    "submission.running",
    "submission.status",
    "submission.completed",
    "submission.failed",
    "submission.error",
    "server.error",
}
SUPPORTED_MESSAGE_TYPES = {
    "auth",
    "ping",
    "pong",
    "subscribe",
    "unsubscribe",
    "client.hello",
    "client.heartbeat",
    "client.status",
    "exam.started",
    "exam.ended",
    "exam.announcement",
    "announcement.created",
    "submission.received",
    "submission.running",
    "submission.status",
    "submission.completed",
    "submission.failed",
    "submission.error",
    "server.error",
}
_STOP_RECEIVING = object()


class RealtimeBridge:
    """Persistent newline-JSON TCP bridge to the internal Java realtime server."""

    def __init__(
        self,
        host: str,
        port: int,
        shared_secret: str | None,
        event_router: RealtimeEventRouter | None = None,
        *,
        connect_timeout: float = CONNECT_TIMEOUT_SECONDS,
        initial_retry: float = INITIAL_RETRY_SECONDS,
        max_retry: float = MAX_RETRY_SECONDS,
        heartbeat_interval: float = TCP_HEARTBEAT_INTERVAL_SECONDS,
        heartbeat_timeout: float = TCP_HEARTBEAT_TIMEOUT_SECONDS,
    ) -> None:
        if connect_timeout <= 0 or initial_retry <= 0 or max_retry < initial_retry:
            raise ValueError("Connection timeouts and retry bounds are invalid")
        if heartbeat_interval <= 0 or heartbeat_timeout <= 0:
            raise ValueError("TCP heartbeat intervals must be positive")
        self.host = host
        self.port = port
        self._shared_secret = (shared_secret or "").strip()
        self.event_router = event_router or RealtimeEventRouter()
        self._connect_timeout = connect_timeout
        self._initial_retry = initial_retry
        self._max_retry = max_retry
        self._heartbeat_interval = heartbeat_interval
        self._heartbeat_timeout = heartbeat_timeout

        self._outbound: asyncio.Queue[str] = asyncio.Queue(maxsize=OUTBOUND_QUEUE_SIZE)
        self._inbound: asyncio.Queue[dict[str, Any] | object] = asyncio.Queue(maxsize=OUTBOUND_QUEUE_SIZE)
        self._task: asyncio.Task[None] | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._connected = False
        self._stopping = False
        self._first_attempt: asyncio.Event | None = None
        self._first_attempt_succeeded = False
        self._first_failed = False
        self._recent_event_ids: OrderedDict[str, float] = OrderedDict()

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def connect(self) -> bool:
        if self._task is not None and not self._task.done():
            first_attempt = self._first_attempt
            if first_attempt is not None and not first_attempt.is_set():
                await first_attempt.wait()
            return self._connected
        if not self._shared_secret:
            logger.warning("Realtime bridge disabled: SOCKET_SERVER_SHARED_SECRET is not configured")
            return False

        self._stopping = False
        self._outbound = asyncio.Queue(maxsize=OUTBOUND_QUEUE_SIZE)
        self._inbound = asyncio.Queue(maxsize=OUTBOUND_QUEUE_SIZE)
        self._first_attempt = asyncio.Event()
        self._first_attempt_succeeded = False
        self._first_failed = False
        self._task = asyncio.create_task(self._connection_loop(), name="fastapi-java-realtime-bridge")
        await self._first_attempt.wait()
        return self._first_attempt_succeeded

    async def start(self) -> None:
        """Compatibility alias for connect(); the reconnect supervisor remains active."""
        await self.connect()

    async def disconnect(self) -> None:
        self._stopping = True
        task = self._task
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._task = None
        self._connected = False
        self._writer = None
        self._queue_received(_STOP_RECEIVING)

    async def stop(self) -> None:
        """Compatibility alias for disconnect()."""
        await self.disconnect()

    async def reconnect(self) -> bool:
        """Restart the connection supervisor and wait for its next connection attempt."""
        await self.disconnect()
        return await self.connect()

    async def send(self, event: dict[str, Any]) -> bool:
        """Queue an event in memory; True means accepted, not acknowledged by Java."""
        if self._task is None or self._task.done() or not self._shared_secret:
            return False

        normalized = self._normalize_event(event)
        if normalized is None:
            logger.warning("Rejected invalid realtime event for TCP delivery")
            return False

        try:
            encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            frame = encoded.encode("utf-8")
        except (TypeError, ValueError):
            logger.warning("Rejected non-JSON realtime event")
            return False

        if len(frame) > MAX_FRAME_BYTES:
            logger.warning("Rejected realtime event larger than the TCP frame limit")
            return False

        try:
            self._outbound.put_nowait(encoded)
            return True
        except asyncio.QueueFull:
            logger.warning("Realtime outbound queue is full; event was not queued")
            return False

    async def send_event(self, event: dict[str, Any]) -> bool:
        """Compatibility alias for send()."""
        return await self.send(event)

    async def receive(self) -> dict[str, Any]:
        """Wait for the next validated message received from Java."""
        message = await self._inbound.get()
        if message is _STOP_RECEIVING:
            raise ConnectionError("Realtime bridge has been disconnected")
        return message

    @staticmethod
    def _normalize_event(event: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(event, dict):
            return None
        event_type = event.get("type")
        recipient = event.get("recipient", "broadcast")
        payload = event.get("payload", {})
        if (
            not isinstance(event_type, str)
            or event_type not in SUPPORTED_MESSAGE_TYPES
            or not isinstance(recipient, str)
            or not recipient.strip()
            or not isinstance(payload, dict)
        ):
            return None

        return {
            "type": event_type,
            "event_id": str(uuid.uuid4()),
            "sender": "fastapi",
            "recipient": recipient,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }

    async def _connection_loop(self) -> None:
        retry_delay = self._initial_retry
        while not self._stopping:
            writer: asyncio.StreamWriter | None = None
            connected_at: float | None = None
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(
                        self.host,
                        self.port,
                        limit=MAX_FRAME_BYTES + 1,
                    ),
                    timeout=self._connect_timeout,
                )
                await self._authenticate(reader, writer)
                self._writer = writer
                self._connected = True
                connected_at = time.monotonic()
                logger.info("Connected to Java realtime server at %s:%s", self.host, self.port)
                self._first_attempt_succeeded = True
                if self._first_attempt is not None:
                    self._first_attempt.set()
                await self._serve_connection(reader, writer)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Java realtime connection unavailable: %s", type(exc).__name__)
                if self._first_attempt is not None and not self._first_attempt.is_set():
                    self._first_attempt_succeeded = False
                    self._first_failed = True
            finally:
                self._connected = False
                self._writer = None
                if writer is not None:
                    writer.close()
                    try:
                        await asyncio.wait_for(writer.wait_closed(), timeout=1.0)
                    except (asyncio.TimeoutError, OSError, RuntimeError):
                        pass

            if self._stopping:
                break

            if connected_at is not None and time.monotonic() - connected_at >= STABLE_CONNECTION_SECONDS:
                retry_delay = self._initial_retry
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, self._max_retry)
            if self._first_failed and self._first_attempt is not None:
                self._first_failed = False
                self._first_attempt.set()

    async def _authenticate(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        writer.write(self._encode_frame(self._message("auth", "server", {})))
        await asyncio.wait_for(writer.drain(), timeout=WRITE_TIMEOUT_SECONDS)

        challenge_message = await asyncio.wait_for(self._read_message(reader), timeout=AUTH_TIMEOUT_SECONDS)
        challenge = challenge_message.get("payload", {}).get("challenge")
        if challenge_message.get("type") != "auth" or not isinstance(challenge, str) \
                or not re.fullmatch(r"[0-9a-f]{64}", challenge):
            raise ConnectionError("Java realtime service authentication challenge was invalid")

        proof = hmac.new(
            self._shared_secret.encode("utf-8"),
            challenge.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        writer.write(self._encode_frame(self._message("auth", "server", {"proof": proof})))
        await asyncio.wait_for(writer.drain(), timeout=WRITE_TIMEOUT_SECONDS)

        response = await asyncio.wait_for(self._read_message(reader), timeout=AUTH_TIMEOUT_SECONDS)
        if (
            response.get("type") != "client.status"
            or not isinstance(response.get("payload"), dict)
            or response["payload"].get("authenticated") is not True
            or response["payload"].get("service") is not True
        ):
            raise ConnectionError("Java realtime service authentication was rejected")

    @staticmethod
    def _message(event_type: str, recipient: str, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": event_type,
            "event_id": str(uuid.uuid4()),
            "sender": "fastapi",
            "recipient": recipient,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }

    async def _serve_connection(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        pong_received = asyncio.Event()
        tasks = {
            asyncio.create_task(self._send_loop(writer), name="realtime-tcp-send"),
            asyncio.create_task(
                self._receive_loop(reader, pong_received), name="realtime-tcp-receive"
            ),
            asyncio.create_task(
                self._heartbeat_loop(pong_received), name="realtime-tcp-heartbeat"
            ),
        }
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                exception = task.exception()
                if exception is not None:
                    raise exception
            raise ConnectionError("Java realtime connection closed")
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _send_loop(self, writer: asyncio.StreamWriter) -> None:
        while True:
            encoded = await self._outbound.get()
            try:
                writer.write(encoded.encode("utf-8") + b"\n")
                await asyncio.wait_for(writer.drain(), timeout=WRITE_TIMEOUT_SECONDS)
            except Exception as exc:
                logger.warning("Realtime event write failed: %s", type(exc).__name__)
                raise
            finally:
                self._outbound.task_done()

    async def _receive_loop(
        self, reader: asyncio.StreamReader, pong_received: asyncio.Event
    ) -> None:
        while True:
            try:
                event = await self._read_message(reader)
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
                logger.warning("Ignored malformed message from Java realtime server: %s", type(exc).__name__)
                continue
            if event["type"] == "pong":
                pong_received.set()
                continue
            if event["type"] == "ping":
                if not await self.send({"type": "pong", "recipient": "server", "payload": {}}):
                    raise ConnectionError("Could not queue TCP heartbeat response")
                continue
            if self._is_duplicate_domain_event(event):
                logger.debug("Ignored duplicate realtime event %s", event["event_id"])
                continue
            self._queue_received(event)
            await self.event_router.dispatch(event)

    async def _heartbeat_loop(self, pong_received: asyncio.Event) -> None:
        while True:
            await asyncio.sleep(self._heartbeat_interval)
            pong_received.clear()
            if not await self.send({"type": "ping", "recipient": "server", "payload": {}}):
                raise ConnectionError("Could not queue TCP heartbeat ping")
            try:
                await asyncio.wait_for(
                    pong_received.wait(), timeout=self._heartbeat_timeout
                )
            except asyncio.TimeoutError as exc:
                raise ConnectionError("Java realtime heartbeat timed out") from exc

    def _is_duplicate_domain_event(self, event: dict[str, Any]) -> bool:
        if event.get("type") not in DEDUPLICATED_EVENT_TYPES:
            return False

        now = time.monotonic()
        cutoff = now - EVENT_DEDUP_TTL_SECONDS
        while self._recent_event_ids:
            oldest_event_id, first_seen = next(iter(self._recent_event_ids.items()))
            if first_seen > cutoff:
                break
            self._recent_event_ids.pop(oldest_event_id)

        event_id = event["event_id"]
        if event_id in self._recent_event_ids:
            return True

        self._recent_event_ids[event_id] = now
        while len(self._recent_event_ids) > EVENT_DEDUP_MAX_ENTRIES:
            self._recent_event_ids.popitem(last=False)
        return False

    @staticmethod
    async def _read_message(reader: asyncio.StreamReader) -> dict[str, Any]:
        try:
            line = await reader.readuntil(b"\n")
        except asyncio.LimitOverrunError as exc:
            raise ConnectionError("Java realtime frame exceeds the configured limit") from exc
        except asyncio.IncompleteReadError as exc:
            if not exc.partial:
                raise ConnectionError("Java realtime server disconnected") from exc
            raise ConnectionError("Java realtime server sent an unterminated frame") from exc
        if not line.endswith(b"\n"):
            raise ValueError("TCP frame is missing its newline delimiter")
        frame = line[:-1]
        if frame.endswith(b"\r"):
            frame = frame[:-1]
        if len(frame) > MAX_FRAME_BYTES:
            raise ConnectionError("Java realtime frame exceeds the configured limit")

        message = json.loads(frame.decode("utf-8"))
        if (
            not isinstance(message, dict)
            or not isinstance(message.get("type"), str)
            or message["type"] not in SUPPORTED_MESSAGE_TYPES
            or not isinstance(message.get("event_id"), str)
            or not isinstance(message.get("sender"), str)
            or not isinstance(message.get("recipient"), str)
            or not isinstance(message.get("timestamp"), str)
            or not isinstance(message.get("payload"), dict)
        ):
            raise ValueError("Invalid realtime message envelope")
        try:
            uuid.UUID(message["event_id"])
            timestamp = datetime.fromisoformat(message["timestamp"].replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                raise ValueError("Timestamp must include a timezone offset")
        except (ValueError, TypeError) as exc:
            raise ValueError("Invalid realtime message identifiers or timestamp") from exc
        if not message["sender"].strip() or not message["recipient"].strip():
            raise ValueError("Invalid realtime message sender or recipient")
        return message

    @staticmethod
    def _encode_frame(message: dict[str, Any]) -> bytes:
        encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_FRAME_BYTES:
            raise ValueError("TCP frame exceeds configured limit")
        return encoded + b"\n"

    def _queue_received(self, event: dict[str, Any] | object) -> None:
        try:
            self._inbound.put_nowait(event)
        except asyncio.QueueFull:
            if event is _STOP_RECEIVING:
                try:
                    self._inbound.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                self._inbound.put_nowait(event)
            else:
                logger.warning("Realtime inbound queue is full; message was not queued")
