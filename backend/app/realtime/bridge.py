import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from app.realtime.event_router import RealtimeEventRouter

logger = logging.getLogger(__name__)

MAX_FRAME_BYTES = 64 * 1024
OUTBOUND_QUEUE_SIZE = 256
CONNECT_TIMEOUT_SECONDS = 3.0
AUTH_TIMEOUT_SECONDS = 3.0
WRITE_TIMEOUT_SECONDS = 5.0
INITIAL_RETRY_SECONDS = 0.5
MAX_RETRY_SECONDS = 15.0
STABLE_CONNECTION_SECONDS = 30.0


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
    ) -> None:
        self.host = host
        self.port = port
        self._shared_secret = (shared_secret or "").strip()
        self.event_router = event_router or RealtimeEventRouter()
        self._connect_timeout = connect_timeout
        self._initial_retry = initial_retry
        self._max_retry = max_retry

        self._outbound: asyncio.Queue[str] = asyncio.Queue(maxsize=OUTBOUND_QUEUE_SIZE)
        self._task: asyncio.Task[None] | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._connected = False
        self._stopping = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        if not self._shared_secret:
            logger.warning("Realtime bridge disabled: SOCKET_SERVER_SHARED_SECRET is not configured")
            return

        self._stopping = False
        self._outbound = asyncio.Queue(maxsize=OUTBOUND_QUEUE_SIZE)
        self._task = asyncio.create_task(self._connection_loop(), name="fastapi-java-realtime-bridge")

    async def stop(self) -> None:
        self._stopping = True
        task = self._task
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._task = None
        self._connected = False

    async def send_event(self, event: dict[str, Any]) -> bool:
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

    @staticmethod
    def _normalize_event(event: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(event, dict):
            return None
        event_type = event.get("type")
        recipient = event.get("recipient", "broadcast")
        payload = event.get("payload", {})
        if (
            not isinstance(event_type, str)
            or not event_type.strip()
            or event_type == "service.hello"
            or not isinstance(recipient, str)
            or not recipient.strip()
            or not isinstance(payload, dict)
        ):
            return None

        normalized = dict(event)
        normalized.update({
            "type": event_type,
            "requestId": str(event.get("requestId") or uuid.uuid4()),
            "sender": "fastapi",
            "recipient": recipient,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        })
        return normalized

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
                await self._serve_connection(reader, writer)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Java realtime connection unavailable: %s", type(exc).__name__)
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

    async def _authenticate(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        hello = {
            "type": "service.hello",
            "requestId": str(uuid.uuid4()),
            "sender": "fastapi",
            "recipient": "server",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": {"shared_secret": self._shared_secret},
        }
        writer.write(self._encode_frame(hello))
        await asyncio.wait_for(writer.drain(), timeout=WRITE_TIMEOUT_SECONDS)

        response = await asyncio.wait_for(self._read_message(reader), timeout=AUTH_TIMEOUT_SECONDS)
        if (
            response.get("type") != "client.status"
            or not isinstance(response.get("payload"), dict)
            or response["payload"].get("authenticated") is not True
            or response["payload"].get("service") is not True
        ):
            raise ConnectionError("Java realtime service authentication was rejected")

    async def _serve_connection(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        tasks = {
            asyncio.create_task(self._send_loop(writer), name="realtime-tcp-send"),
            asyncio.create_task(self._receive_loop(reader), name="realtime-tcp-receive"),
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

    async def _receive_loop(self, reader: asyncio.StreamReader) -> None:
        while True:
            try:
                event = await self._read_message(reader)
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
                logger.warning("Ignored malformed message from Java realtime server: %s", type(exc).__name__)
                continue
            await self.event_router.dispatch(event)

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
        if len(line) > MAX_FRAME_BYTES + 1:
            raise ConnectionError("Java realtime frame exceeds the configured limit")

        message = json.loads(line.rstrip(b"\r\n").decode("utf-8"))
        if (
            not isinstance(message, dict)
            or not isinstance(message.get("type"), str)
            or not message["type"].strip()
            or ("payload" in message and not isinstance(message["payload"], dict))
        ):
            raise ValueError("Invalid realtime message envelope")
        return message

    @staticmethod
    def _encode_frame(message: dict[str, Any]) -> bytes:
        encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_FRAME_BYTES:
            raise ValueError("TCP frame exceeds configured limit")
        return encoded + b"\n"
