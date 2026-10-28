"""Live Browser -> FastAPI -> Java TCP -> FastAPI -> Browser acceptance test."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import socket
import sqlite3
import subprocess
import sys
import time
import uuid
from contextlib import AsyncExitStack
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import urlopen

import httpx
import pytest
import websockets
from websockets.exceptions import InvalidStatus


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = PROJECT_ROOT / "backend"
JAVA_ROOT = PROJECT_ROOT / "java-socket-server"
PYTHON = Path(sys.executable)
SERVER_JAR = JAVA_ROOT / "target" / "realtime-server-1.0.0-jar-with-dependencies.jar"
SHARED_SECRET = "e2e-realtime-shared-secret-2026"
JWT_SECRET = "e2e-jwt-signing-secret-for-realtime-tests"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _java_executable() -> str:
    executable_name = "java.exe" if os.name == "nt" else "java"
    java_home = os.environ.get("JAVA_HOME")
    if java_home:
        executable = Path(java_home) / "bin" / executable_name
        if executable.is_file():
            return str(executable)
    return "java"


def _wait_for_tcp(
    port: int,
    process: subprocess.Popen[bytes],
    log_path: Path,
    timeout: float = 15.0,
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            log = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
            raise AssertionError(
                f"Java realtime server exited with code {process.returncode}. Log:\n{log[-5000:]}"
            )
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.1)
    raise AssertionError(f"Java realtime server did not listen on port {port}")


def _wait_for_fastapi(url: str, process: subprocess.Popen[bytes], timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f"FastAPI exited with code {process.returncode}")
        try:
            with urlopen(url, timeout=0.5) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise AssertionError(f"FastAPI did not become ready at {url}")


class _RealtimeStack:
    def __init__(self) -> None:
        self.data_dir = BACKEND_ROOT / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.database_path = (self.data_dir / f"realtime-e2e-{uuid.uuid4().hex}.db").resolve()
        self.http_port = _free_port()
        self.tcp_port = _free_port()
        while self.tcp_port == self.http_port:
            self.tcp_port = _free_port()
        self.http_url = f"http://127.0.0.1:{self.http_port}"
        self.ws_url = f"ws://127.0.0.1:{self.http_port}/ws/realtime"
        self.java_env = os.environ.copy()
        self.java_env.update(
            {
                "SOCKET_HOST": "127.0.0.1",
                "SOCKET_PORT": str(self.tcp_port),
                "DATABASE_PATH": self.database_path.as_posix(),
                "SOCKET_SERVER_SHARED_SECRET": SHARED_SECRET,
                "SECRET_KEY": JWT_SECRET,
                "JWT_ALGORITHM": "HS256",
            }
        )
        self.api_env = os.environ.copy()
        self.api_env.update(
            {
                "DATABASE_URL": f"sqlite:///./data/{self.database_path.name}",
                "SOCKET_SERVER_HOST": "127.0.0.1",
                "SOCKET_SERVER_PORT": str(self.tcp_port),
                "SOCKET_SERVER_SHARED_SECRET": SHARED_SECRET,
                "SECRET_KEY": JWT_SECRET,
                "JWT_ALGORITHM": "HS256",
            }
        )
        self.java_process: subprocess.Popen[bytes] | None = None
        self.api_process: subprocess.Popen[bytes] | None = None
        self._java_log_handle = None
        self._api_log_handle = None
        self.java_log_path = self.database_path.with_suffix(".java-1.log")
        self.api_log_path = self.database_path.with_suffix(".fastapi.log")

    def start_java(self, log_number: int = 1) -> None:
        self.java_log_path = self.database_path.with_suffix(f".java-{log_number}.log")
        self._java_log_handle = self.java_log_path.open("wb")
        self.java_process = subprocess.Popen(
            [_java_executable(), "-jar", str(SERVER_JAR)],
            cwd=JAVA_ROOT,
            env=self.java_env,
            stdout=self._java_log_handle,
            stderr=subprocess.STDOUT,
        )
        _wait_for_tcp(self.tcp_port, self.java_process, self.java_log_path)

    def start_api(self) -> None:
        self._api_log_handle = self.api_log_path.open("wb")
        self.api_process = subprocess.Popen(
            [
                str(PYTHON),
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(self.http_port),
                "--no-access-log",
                "--log-level",
                "info",
            ],
            cwd=BACKEND_ROOT,
            env=self.api_env,
            stdout=self._api_log_handle,
            stderr=subprocess.STDOUT,
        )
        _wait_for_fastapi(f"{self.http_url}/health", self.api_process)

    def stop_java(self) -> None:
        process = self.java_process
        self.java_process = None
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if self._java_log_handle is not None:
            self._java_log_handle.close()
            self._java_log_handle = None

    def wait_for_bridge_disconnect(self, previous_failure_count: int, timeout: float = 5.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            log = self.api_log_path.read_text(encoding="utf-8", errors="replace")
            failure_count = log.count("Java realtime connection unavailable:")
            if failure_count > previous_failure_count:
                return
            if self.api_process is None or self.api_process.poll() is not None:
                raise AssertionError("FastAPI exited before observing the Java server shutdown")
            time.sleep(0.01)
        raise AssertionError("FastAPI realtime bridge did not observe the Java server shutdown")

    def close(self) -> None:
        self.stop_java()
        if self.api_process is not None and self.api_process.poll() is None:
            self.api_process.terminate()
            try:
                self.api_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.api_process.kill()
                self.api_process.wait(timeout=5)
        if self._api_log_handle is not None:
            self._api_log_handle.close()
            self._api_log_handle = None
        expected_parent = self.data_dir.resolve()
        if self.database_path.parent != expected_parent:
            raise AssertionError(f"Refusing to clean unexpected E2E database path: {self.database_path}")
        for path in (
            self.database_path,
            Path(f"{self.database_path}-wal"),
            Path(f"{self.database_path}-shm"),
            self.database_path.with_suffix(".java-1.log"),
            self.database_path.with_suffix(".java-2.log"),
            self.api_log_path,
        ):
            for attempt in range(10):
                try:
                    path.unlink(missing_ok=True)
                    break
                except PermissionError:
                    if attempt == 9:
                        raise
                    time.sleep(0.2)

    def diagnostic_logs(self) -> str:
        paths = [self.api_log_path, self.database_path.with_suffix(".java-1.log"), self.database_path.with_suffix(".java-2.log")]
        parts = []
        for path in paths:
            if path.exists():
                parts.append(f"--- {path.name} ---\n{path.read_text(encoding='utf-8', errors='replace')[-8000:]}")
        return "\n".join(parts)


def _build_server_jar() -> None:
    command = ["mvn", "-q", "-DskipTests", "package"]
    if os.name == "nt":
        command = ["cmd.exe", "/c", *command]
    result = subprocess.run(
        command,
        cwd=JAVA_ROOT,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    assert result.returncode == 0, f"Could not build the Java runtime jar:\n{result.stdout}\n{result.stderr}"
    assert SERVER_JAR.exists(), f"Maven did not produce {SERVER_JAR}"


async def _register_and_login(client: httpx.AsyncClient, role: str) -> tuple[str, int]:
    username = f"e2e_{role}_{uuid.uuid4().hex[:12]}"
    response = await client.post(
        "/auth/register",
        json={
            "username": username,
            "password": "e2e-test-password",
            "full_name": f"Realtime E2E {role}",
            "role": role,
        },
    )
    assert response.status_code == 201, response.text
    response = await client.post(
        "/auth/login", json={"username": username, "password": "e2e-test-password"}
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    response = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.text
    return token, response.json()["id"]


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _receive_type(websocket: Any, event_type: str, timeout: float = 20.0) -> dict[str, Any]:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise AssertionError(f"Timed out waiting for {event_type}")
        raw = await asyncio.wait_for(websocket.recv(), timeout=remaining)
        event = json.loads(raw)
        if event.get("type") == event_type:
            return event
        raise AssertionError(f"Expected {event_type}, received {event.get('type')}: {event}")


async def _assert_quiet(websocket: Any, duration: float = 0.25) -> None:
    try:
        unexpected = await asyncio.wait_for(websocket.recv(), timeout=duration)
    except asyncio.TimeoutError:
        return
    raise AssertionError(f"Unexpected cross-recipient event: {unexpected}")


async def _expect_browser_protocol_error(
    ws_url: str, token: str, message: str, expected_code: str
) -> None:
    async with websockets.connect(f"{ws_url}?token={token}", open_timeout=5) as websocket:
        ready = json.loads(await asyncio.wait_for(websocket.recv(), timeout=5))
        assert ready["type"] == "connection.ready"
        await websocket.send(message)
        error = json.loads(await asyncio.wait_for(websocket.recv(), timeout=5))
        assert error["type"] == "server.error"
        assert error["code"] == expected_code


def _assert_java_rejects_malformed_frames(port: int) -> None:
    envelope = {
        "event_id": str(uuid.uuid4()),
        "sender": "fastapi",
        "recipient": "server",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "payload": {},
    }
    with socket.create_connection(("127.0.0.1", port), timeout=3) as tcp:
        tcp.settimeout(3)
        reader = tcp.makefile("rb")
        tcp.sendall(b"{invalid-json}\n")
        assert json.loads(reader.readline())["type"] == "server.error"

        tcp.sendall((json.dumps(envelope) + "\n").encode("utf-8"))
        assert json.loads(reader.readline())["type"] == "server.error"

        invalid_target = {
            **envelope,
            "type": "client.heartbeat",
            "event_id": str(uuid.uuid4()),
            "recipient": "exam:0",
        }
        tcp.sendall((json.dumps(invalid_target) + "\n").encode("utf-8"))
        assert json.loads(reader.readline())["type"] == "server.error"
        reader.close()

    with socket.create_connection(("127.0.0.1", port), timeout=3) as oversized:
        oversized.settimeout(3)
        oversized.sendall(b"x" * (64 * 1024 + 1))
        oversized.shutdown(socket.SHUT_WR)
        assert oversized.recv(1) == b""


async def _run_live_acceptance(stack: _RealtimeStack) -> None:
    async with httpx.AsyncClient(base_url=stack.http_url, timeout=10) as client:
        teacher1_token, teacher1_id = await _register_and_login(client, "teacher")
        teacher2_token, _teacher2_id = await _register_and_login(client, "teacher")
        student_credentials = [await _register_and_login(client, "student") for _ in range(5)]
        student_tokens = [token for token, _ in student_credentials]

        created_exam = await client.post(
            "/exams", headers=_bearer(teacher1_token), json={"title": "Live TCP E2E Exam"}
        )
        assert created_exam.status_code == 201, created_exam.text
        exam_id = created_exam.json()["id"]
        published = await client.put(
            f"/exams/{exam_id}",
            headers=_bearer(teacher1_token),
            json={"status": "published"},
        )
        assert published.status_code == 200, published.text

        participant_ids = {student_credentials[0][1], student_credentials[1][1]}
        for token, user_id in student_credentials[:2]:
            joined = await client.post(f"/exams/{exam_id}/join", headers=_bearer(token))
            assert joined.status_code == 204
            assert user_id in participant_ids

        with pytest.raises(InvalidStatus) as unauthenticated:
            async with websockets.connect(f"{stack.ws_url}?token=not-a-valid-token", open_timeout=5):
                pass
        assert unauthenticated.value.response.status_code == 403

        async with AsyncExitStack() as sockets_context:
            browser_sockets = []
            for token in student_tokens:
                ws = await sockets_context.enter_async_context(
                    websockets.connect(f"{stack.ws_url}?token={token}", open_timeout=5)
                )
                ready = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert ready["type"] == "connection.ready"
                assert ready["role"] == "student"
                browser_sockets.append(ws)

            teacher1_ws = await sockets_context.enter_async_context(
                websockets.connect(f"{stack.ws_url}?token={teacher1_token}", open_timeout=5)
            )
            teacher2_ws = await sockets_context.enter_async_context(
                websockets.connect(f"{stack.ws_url}?token={teacher2_token}", open_timeout=5)
            )
            assert json.loads(await teacher1_ws.recv())["role"] == "teacher"
            assert json.loads(await teacher2_ws.recv())["role"] == "teacher"

            # Five simultaneous student sockets plus two teacher sockets are held open.
            for ws in browser_sockets:
                await ws.send(json.dumps({"type": "client.heartbeat", "request_id": str(uuid.uuid4())}))
            for ws in browser_sockets:
                heartbeat = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert heartbeat["type"] == "client.heartbeat"
                assert heartbeat["payload"] == {"alive": True}

            # Malformed and unsupported browser messages are isolated to their own connection.
            await _expect_browser_protocol_error(
                stack.ws_url, student_tokens[4], "{invalid-json", "malformed_json"
            )
            await _expect_browser_protocol_error(stack.ws_url, student_tokens[4], "{}", "unsupported_client_event")
            await _expect_browser_protocol_error(
                stack.ws_url,
                student_tokens[4],
                json.dumps({"type": "client.heartbeat", "target": f"user:{teacher1_id}"}),
                "unsupported_client_event",
            )
            await _expect_browser_protocol_error(
                stack.ws_url, student_tokens[4], "x" * 4097, "invalid_message"
            )

            # A student cannot impersonate a teacher over WebSocket or HTTP.
            await browser_sockets[0].send(
                json.dumps({"type": "exam.started", "payload": {"exam_id": exam_id}})
            )
            spoof_rejected = json.loads(await asyncio.wait_for(browser_sockets[0].recv(), timeout=5))
            assert spoof_rejected["type"] == "server.error"
            assert spoof_rejected["code"] == "unsupported_client_event"
            student_start = await client.put(
                f"/exams/{exam_id}", headers=_bearer(student_tokens[0]), json={"status": "started"}
            )
            assert student_start.status_code == 403

            # Teacher 2 cannot operate on teacher 1's exam.
            unrelated_announcement = await client.post(
                f"/exams/{exam_id}/announcements",
                headers=_bearer(teacher2_token),
                json={"content": "Unauthorized announcement"},
            )
            assert unrelated_announcement.status_code == 403

            started = await client.put(
                f"/exams/{exam_id}", headers=_bearer(teacher1_token), json={"status": "started"}
            )
            assert started.status_code == 200
            assert started.json()["status"] == "started"
            for index in (0, 1):
                event = await _receive_type(browser_sockets[index], "exam.started")
                assert event["payload"]["exam_id"] == exam_id
            teacher_event = await _receive_type(teacher1_ws, "exam.started")
            assert teacher_event["payload"]["exam_id"] == exam_id
            for index in (2, 3, 4):
                await _assert_quiet(browser_sockets[index])
            await _assert_quiet(teacher2_ws)

            announcement_response = await client.post(
                f"/exams/{exam_id}/announcements",
                headers=_bearer(teacher1_token),
                json={"content": "The live TCP announcement is persisted."},
            )
            assert announcement_response.status_code == 201, announcement_response.text
            announcement = announcement_response.json()
            assert announcement["exam_id"] == exam_id
            assert announcement["teacher_id"] == teacher1_id
            database = sqlite3.connect(stack.database_path)
            try:
                persisted = database.execute(
                    "SELECT exam_id, teacher_id, content FROM announcements WHERE id = ?",
                    (announcement["announcement_id"],),
                ).fetchone()
            finally:
                database.close()
            assert persisted == (exam_id, teacher1_id, "The live TCP announcement is persisted.")

            for index in (0, 1):
                event = await _receive_type(browser_sockets[index], "announcement.created")
                assert event["payload"]["announcement_id"] == announcement["announcement_id"]
                assert event["payload"]["exam_id"] == exam_id
                assert event["payload"]["message"] == "The live TCP announcement is persisted."
            teacher_event = await _receive_type(teacher1_ws, "announcement.created")
            assert teacher_event["payload"]["announcement_id"] == announcement["announcement_id"]
            for index in (2, 3, 4):
                await _assert_quiet(browser_sockets[index])
            await _assert_quiet(teacher2_ws)

            # A question with no test cases deterministically takes the existing error path;
            # this exercises realtime state transitions without changing or mocking grading.
            question_response = await client.post(
                "/questions",
                headers=_bearer(teacher1_token),
                json={
                    "exam_id": exam_id,
                    "title": "No-case lifecycle acceptance question",
                    "description": "The existing grader marks this as error without invoking Piston.",
                    "question_type": "stdio",
                    "max_score": 10,
                    "allowed_languages": "java",
                },
            )
            assert question_response.status_code == 201, question_response.text
            submission_response = await client.post(
                "/submissions",
                headers=_bearer(student_tokens[0]),
                json={
                    "question_id": question_response.json()["id"],
                    "language": "java",
                    "source_code": "public class Main { public static void main(String[] args) {} }",
                },
            )
            assert submission_response.status_code == 201, submission_response.text
            submission = submission_response.json()
            submission_id = submission["id"]
            assert submission["status"] == "queued"

            student_submission_events = [
                await _receive_type(browser_sockets[0], "submission.received"),
                await _receive_type(browser_sockets[0], "submission.status"),
                await _receive_type(browser_sockets[0], "submission.error"),
            ]
            assert student_submission_events[0]["payload"] == {"submission_id": submission_id}
            assert student_submission_events[1]["payload"] == {
                "submission_id": submission_id,
                "status": "running",
            }
            assert student_submission_events[2]["payload"]["submission_id"] == submission_id
            for event in student_submission_events:
                assert "source_code" not in event["payload"]
                assert "error_summary" not in event["payload"]

            teacher_submission_events = [
                await _receive_type(teacher1_ws, "submission.received"),
                await _receive_type(teacher1_ws, "submission.status"),
                await _receive_type(teacher1_ws, "submission.error"),
            ]
            assert [event["type"] for event in teacher_submission_events] == [
                "submission.received",
                "submission.status",
                "submission.error",
            ]
            for index in (1, 2, 3, 4):
                await _assert_quiet(browser_sockets[index])
            await _assert_quiet(teacher2_ws)

            final_submission = await client.get(
                f"/submissions/{submission_id}", headers=_bearer(student_tokens[0])
            )
            assert final_submission.status_code == 200
            assert final_submission.json()["status"] == "error"
            private_submission = await client.get(
                f"/submissions/{submission_id}", headers=_bearer(student_tokens[1])
            )
            assert private_submission.status_code == 404

            # Check the reverse direction too: student A must not receive student B's result.
            submission_b_response = await client.post(
                "/submissions",
                headers=_bearer(student_tokens[1]),
                json={
                    "question_id": question_response.json()["id"],
                    "language": "java",
                    "source_code": "public class Main { public static void main(String[] args) {} }",
                },
            )
            assert submission_b_response.status_code == 201, submission_b_response.text
            submission_b_id = submission_b_response.json()["id"]
            assert submission_b_response.json()["status"] == "queued"
            for event_type in ("submission.received", "submission.status", "submission.error"):
                event = await _receive_type(browser_sockets[1], event_type)
                assert event["payload"]["submission_id"] == submission_b_id
            for event_type in ("submission.received", "submission.status", "submission.error"):
                event = await _receive_type(teacher1_ws, event_type)
                assert event["payload"]["submission_id"] == submission_b_id
            await _assert_quiet(browser_sockets[0])
            for index in (2, 3, 4):
                await _assert_quiet(browser_sockets[index])
            await _assert_quiet(teacher2_ws)
            assert (await client.get(
                f"/submissions/{submission_b_id}", headers=_bearer(student_tokens[1])
            )).json()["status"] == "error"
            assert (await client.get(
                f"/submissions/{submission_b_id}", headers=_bearer(student_tokens[0])
            )).status_code == 404

            ended = await client.put(
                f"/exams/{exam_id}", headers=_bearer(teacher1_token), json={"status": "ended"}
            )
            assert ended.status_code == 200
            for index in (0, 1):
                event = await _receive_type(browser_sockets[index], "exam.ended")
                assert event["payload"]["exam_id"] == exam_id
            teacher_event = await _receive_type(teacher1_ws, "exam.ended")
            assert teacher_event["payload"]["exam_id"] == exam_id
            for index in (2, 3, 4):
                await _assert_quiet(browser_sockets[index])
            await _assert_quiet(teacher2_ws)

            # Malformed TCP frames must be rejected without stopping Java or FastAPI.
            await asyncio.to_thread(_assert_java_rejects_malformed_frames, stack.tcp_port)
            assert stack.java_process is not None and stack.java_process.poll() is None
            health = await client.get("/health")
            assert health.status_code == 200
            for ws in browser_sockets:
                await ws.send(json.dumps({"type": "client.heartbeat"}))
            for ws in browser_sockets:
                assert json.loads(await ws.recv())["payload"] == {"alive": True}

            # Stop Java, confirm FastAPI and browser sockets stay usable, then restart it.
            previous_bridge_failures = stack.api_log_path.read_text(
                encoding="utf-8", errors="replace"
            ).count("Java realtime connection unavailable:")
            stack.stop_java()
            await asyncio.to_thread(
                stack.wait_for_bridge_disconnect,
                previous_bridge_failures,
            )
            health = await client.get("/health")
            assert health.status_code == 200
            await browser_sockets[0].send(json.dumps({"type": "client.heartbeat"}))
            assert json.loads(await browser_sockets[0].recv())["payload"] == {"alive": True}

            # This DB-backed event queues while Java is stopped and must not reach browsers yet.
            restarted_announcement = await client.post(
                f"/exams/{exam_id}/announcements",
                headers=_bearer(teacher1_token),
                json={"content": "Announcement after Java reconnect."},
            )
            assert restarted_announcement.status_code == 201
            for index in (0, 1):
                await _assert_quiet(browser_sockets[index])
            await _assert_quiet(teacher1_ws)

            stack.start_java(log_number=2)
            # Delivery after restart proves automatic reconnect and a fresh service-auth challenge.
            for index in (0, 1):
                event = await _receive_type(browser_sockets[index], "announcement.created", timeout=45)
                assert event["payload"]["announcement_id"] == restarted_announcement.json()["announcement_id"]
            teacher_event = await _receive_type(teacher1_ws, "announcement.created", timeout=45)
            assert teacher_event["payload"]["announcement_id"] == restarted_announcement.json()["announcement_id"]
            for index in (2, 3, 4):
                await _assert_quiet(browser_sockets[index])
            await _assert_quiet(teacher2_ws)


def test_live_java_tcp_browser_realtime_acceptance() -> None:
    """Exercise real browser sockets and both sides of the authenticated Java TCP bridge."""
    assert PYTHON.exists(), f"Backend virtual environment not found: {PYTHON}"
    _build_server_jar()
    stack = _RealtimeStack()
    try:
        stack.start_java()
        stack.start_api()
        asyncio.run(_run_live_acceptance(stack))
    except BaseException:
        print(stack.diagnostic_logs())
        try:
            stack.close()
        except Exception as cleanup_error:
            print(f"E2E cleanup also failed: {cleanup_error}")
        raise
    else:
        stack.close()
