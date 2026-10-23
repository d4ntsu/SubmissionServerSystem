"""Manual acceptance runner for FastAPI browser realtime and exam events.

This runner exercises the currently implemented FastAPI -> WebSocket path.
It does not exercise Java TCP because this checkout has no FastAPI TCP client.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import sys
import uuid
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
import websockets


def _credentials(role: str, username: str | None) -> tuple[str, str]:
    if not username:
        username = input(f"{role.title()} username: ").strip()
    password = getpass.getpass(f"{role.title()} password: ")
    if not username or not password:
        raise ValueError(f"{role.title()} username and password are required")
    return username, password


def _websocket_url(api_url: str, token: str) -> str:
    parts = urlsplit(api_url)
    scheme = "wss" if parts.scheme == "https" else "ws"
    return urlunsplit((scheme, parts.netloc, "/ws/realtime", urlencode({"token": token}), ""))


async def _receive_json(websocket, timeout: float) -> dict:
    message = await asyncio.wait_for(websocket.recv(), timeout=timeout)
    parsed = json.loads(message)
    if not isinstance(parsed, dict):
        raise AssertionError("Expected a JSON object from the WebSocket")
    return parsed


async def _expect_event(websocket, event_type: str, exam_id: int, timeout: float) -> dict:
    message = await _receive_json(websocket, timeout)
    if message.get("type") != event_type:
        raise AssertionError(f"Expected {event_type}, received {message!r}")
    expected_payload = {"exam_id": exam_id}
    if not expected_payload.items() <= message.get("payload", {}).items():
        raise AssertionError(f"Unexpected {event_type} payload: {message.get('payload')!r}")
    return message


async def _expect_no_event(websocket, timeout: float) -> None:
    try:
        message = await asyncio.wait_for(websocket.recv(), timeout=timeout)
    except asyncio.TimeoutError:
        return
    raise AssertionError(f"Teacher socket received a student-targeted event: {message!r}")


async def _expect_websocket_rejected(ws_url: str, timeout: float) -> None:
    try:
        async with websockets.connect(ws_url, open_timeout=timeout):
            raise AssertionError("WebSocket accepted a connection without a valid token")
    except websockets.exceptions.InvalidStatus as exc:
        if exc.response.status_code != 403:
            raise AssertionError(f"Expected HTTP 403 for rejected WebSocket, got {exc.response.status_code}")


async def run(args: argparse.Namespace) -> int:
    teacher_username, teacher_password = _credentials("teacher", args.teacher_username)
    student_username, student_password = _credentials("student", args.student_username)
    api_url = args.api_url.rstrip("/")

    async with httpx.AsyncClient(base_url=api_url, timeout=args.timeout) as client:
        teacher_login = await client.post(
            "/auth/login",
            json={"username": teacher_username, "password": teacher_password},
        )
        student_login = await client.post(
            "/auth/login",
            json={"username": student_username, "password": student_password},
        )
        for role, response in (("teacher", teacher_login), ("student", student_login)):
            if response.status_code != 200:
                raise RuntimeError(f"{role.title()} login failed ({response.status_code}): {response.text}")

        teacher_token = teacher_login.json()["access_token"]
        student_token = student_login.json()["access_token"]
        teacher_headers = {"Authorization": f"Bearer {teacher_token}"}
        student_headers = {"Authorization": f"Bearer {student_token}"}

        parts = urlsplit(api_url)
        ws_scheme = "wss" if parts.scheme == "https" else "ws"
        missing_token_url = urlunsplit((ws_scheme, parts.netloc, "/ws/realtime", "", ""))
        await _expect_websocket_rejected(missing_token_url, args.timeout)
        await _expect_websocket_rejected(_websocket_url(api_url, "invalid-token"), args.timeout)
        print("PASS: unauthenticated and invalid-token WebSockets are rejected")

        created = await client.post(
            "/exams",
            headers=teacher_headers,
            json={"title": f"Realtime Manual Test {uuid.uuid4().hex[:8]}"},
        )
        if created.status_code != 201:
            raise RuntimeError(f"Could not create test exam ({created.status_code}): {created.text}")
        exam = created.json()
        exam_id = exam["id"]
        print(f"Created exam #{exam_id}: {exam['title']}")

        ws_url = _websocket_url(api_url, student_token)
        teacher_ws_url = _websocket_url(api_url, teacher_token)
        async with websockets.connect(ws_url, open_timeout=args.timeout) as student_tab_a:
            ready_a = await _receive_json(student_tab_a, args.timeout)
            assert ready_a.get("type") == "connection.ready" and ready_a.get("role") == "student", ready_a
            print("PASS: authenticated student WebSocket connected")

            async with websockets.connect(ws_url, open_timeout=args.timeout) as student_tab_b:
                ready_b = await _receive_json(student_tab_b, args.timeout)
                assert ready_b.get("connection_count") == 2, ready_b
                print("PASS: second student tab registered")

                async with websockets.connect(teacher_ws_url, open_timeout=args.timeout) as teacher_ws:
                    ready_teacher = await _receive_json(teacher_ws, args.timeout)
                    assert ready_teacher.get("role") == "teacher", ready_teacher

                    heartbeat_id = str(uuid.uuid4())
                    await student_tab_a.send(json.dumps({
                        "type": "client.heartbeat",
                        "request_id": heartbeat_id,
                    }))
                    heartbeat = await _receive_json(student_tab_a, args.timeout)
                    assert heartbeat.get("type") == "client.heartbeat", heartbeat
                    assert heartbeat.get("request_id") == heartbeat_id, heartbeat
                    print("PASS: WebSocket heartbeat acknowledged")

                    await student_tab_a.send(json.dumps({
                        "type": "exam.started",
                        "payload": {"exam_id": exam_id},
                    }))
                    rejected = await _receive_json(student_tab_a, args.timeout)
                    assert rejected.get("type") == "server.error", rejected
                    assert rejected.get("code") == "unsupported_client_event", rejected
                    print("PASS: browser cannot send authoritative exam events")

                    forbidden_update = await client.put(
                        f"/exams/{exam_id}",
                        headers=student_headers,
                        json={"status": "started"},
                    )
                    assert forbidden_update.status_code == 403, forbidden_update.text
                    print("PASS: student cannot start an exam through HTTP")

                    started = await client.put(
                        f"/exams/{exam_id}",
                        headers=teacher_headers,
                        json={"status": "started"},
                    )
                    assert started.status_code == 200 and started.json()["status"] == "started", started.text
                    await _expect_event(student_tab_a, "exam.started", exam_id, args.timeout)
                    await _expect_event(student_tab_b, "exam.started", exam_id, args.timeout)
                    await _expect_no_event(teacher_ws, min(args.timeout, 0.5))
                    persisted = await client.get(f"/exams/{exam_id}", headers=teacher_headers)
                    assert persisted.status_code == 200 and persisted.json()["status"] == "started"
                    print("PASS: teacher start committed and reached both student tabs only")

                    ended = await client.put(
                        f"/exams/{exam_id}",
                        headers=teacher_headers,
                        json={"status": "ended"},
                    )
                    assert ended.status_code == 200 and ended.json()["status"] == "ended", ended.text
                    await _expect_event(student_tab_a, "exam.ended", exam_id, args.timeout)
                    await _expect_event(student_tab_b, "exam.ended", exam_id, args.timeout)
                    await _expect_no_event(teacher_ws, min(args.timeout, 0.5))
                    print("PASS: exam end committed and reached both student tabs only")

                await student_tab_b.close()
                online = await client.get("/auth/me", headers=student_headers)
                assert online.status_code == 200 and online.json()["is_online"] == 1, online.text
                print("PASS: closing one tab leaves the student online")

        offline = await client.get("/auth/me", headers=student_headers)
        assert offline.status_code == 200 and offline.json()["is_online"] == 0, offline.text
        print("PASS: closing the last tab marks the student offline")
        print(f"Manual check complete. Exam #{exam_id} remains saved with status 'ended'.")
        print("SKIP: announcement persistence is not implemented in the current backend.")
        print("SKIP: this checkout has no FastAPI TCP client; Java TCP forwarding was not tested.")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Manual FastAPI WebSocket/exam realtime test")
    parser.add_argument("--api-url", default="http://127.0.0.1:8000", help="FastAPI base URL")
    parser.add_argument("--teacher-username", help="Teacher username (password is prompted securely)")
    parser.add_argument("--student-username", help="Student username (password is prompted securely)")
    parser.add_argument("--timeout", type=float, default=8.0, help="HTTP/WebSocket timeout in seconds")
    args = parser.parse_args()
    try:
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        print("Stopped by user.")
        return 130
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
