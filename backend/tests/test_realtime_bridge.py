import asyncio
import hashlib
import hmac
import json
import socket
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.main import app as fastapi_app, realtime_bridge as configured_bridge
from app.database import SessionLocal
from app.models.exam import Exam, ExamParticipant, ExamStatus
from app.realtime import RealtimeBridge, RealtimeEventRouter
from app.realtime.manager import RealtimeManager


SHARED_SECRET = "test-only-shared-secret"


def tcp_message(
    event_type: str,
    sender: str,
    recipient: str,
    payload: dict,
    *,
    event_id: str | None = None,
) -> bytes:
    return (
        json.dumps(
            {
                "type": event_type,
                "event_id": event_id or str(uuid.uuid4()),
                "sender": sender,
                "recipient": recipient,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "payload": payload,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        + b"\n"
    )


async def authenticate_peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> dict:
    auth_request = json.loads(await asyncio.wait_for(reader.readline(), timeout=2))
    assert auth_request["type"] == "auth"
    assert auth_request["event_id"]
    assert auth_request["payload"] == {}
    challenge = uuid.uuid4().hex + uuid.uuid4().hex
    writer.write(tcp_message("auth", "server", "client:fastapi", {"challenge": challenge}))
    await writer.drain()
    proof_message = json.loads(await asyncio.wait_for(reader.readline(), timeout=2))
    assert proof_message["type"] == "auth"
    proof = proof_message["payload"]["proof"]
    expected = hmac.new(
        SHARED_SECRET.encode("utf-8"),
        challenge.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    assert hmac.compare_digest(proof, expected)
    writer.write(tcp_message("client.status", "server", "client:fastapi", {
        "authenticated": True,
        "service": True,
    }))
    await writer.drain()
    return auth_request


async def wait_until_connected(bridge: RealtimeBridge) -> None:
    deadline = asyncio.get_running_loop().time() + 2
    while not bridge.is_connected and asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(0.01)
    assert bridge.is_connected


@pytest.mark.asyncio
async def test_bridge_authenticates_sends_event_and_routes_returned_event():
    received_events: list[dict] = []
    routed = asyncio.Event()
    peer_received = asyncio.Event()
    errors: list[BaseException] = []

    async def capture(event: dict) -> None:
        received_events.append(event)
        routed.set()

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await authenticate_peer(reader, writer)
            peer_received.set()
            line = await asyncio.wait_for(reader.readline(), timeout=3)
            received_events.append({"peer_message": json.loads(line)})
            writer.write(tcp_message(
                "submission.completed",
                "java",
                "broadcast",
                {"submission_id": 17},
            ))
            await writer.drain()
            await reader.read()
        except BaseException as exc:
            errors.append(exc)
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    router = RealtimeEventRouter()
    router.subscribe(capture)
    bridge = RealtimeBridge("127.0.0.1", server.sockets[0].getsockname()[1], SHARED_SECRET, router)
    try:
        await bridge.start()
        await asyncio.wait_for(peer_received.wait(), timeout=2)
        assert bridge.is_connected

        queued = await bridge.send({
            "type": "submission.running",
            "recipient": "role:teacher",
            "payload": {"submission_id": 17},
        })
        assert queued
        await asyncio.wait_for(routed.wait(), timeout=2)

        sent = received_events[0]["peer_message"]
        assert sent["type"] == "submission.running"
        assert str(uuid.UUID(sent["event_id"])) == sent["event_id"]
        assert sent["sender"] == "fastapi"
        assert sent["recipient"] == "role:teacher"
        assert sent["payload"] == {"submission_id": 17}
        assert received_events[1]["type"] == "submission.completed"
        assert (await bridge.receive())["payload"] == {"submission_id": 17}
        assert not errors
    finally:
        await bridge.disconnect()
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_malformed_server_message_is_ignored_and_receive_loop_continues():
    routed_events: list[dict] = []
    routed = asyncio.Event()

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await authenticate_peer(reader, writer)
            writer.write(
                b"{malformed json}\n"
                + tcp_message("unknown.event", "java", "role:student", {})
                + tcp_message("exam.announcement", "java", "role:student", {
                    "exam_id": 4,
                    "message": "ready",
                })
                + tcp_message("exam.ended", "java", "role:student", {"exam_id": 4})
            )
            await writer.drain()
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    async def capture(event: dict) -> None:
        routed_events.append(event)
        if len(routed_events) == 2:
            routed.set()

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    router = RealtimeEventRouter()
    router.subscribe(capture)
    bridge = RealtimeBridge("127.0.0.1", server.sockets[0].getsockname()[1], SHARED_SECRET, router)
    try:
        await bridge.start()
        await asyncio.wait_for(routed.wait(), timeout=2)
        assert [event["type"] for event in routed_events] == ["exam.announcement", "exam.ended"]
        assert (await bridge.receive())["type"] == "exam.announcement"
        assert (await bridge.receive())["type"] == "exam.ended"
        assert bridge.is_connected
    finally:
        await bridge.stop()
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_duplicate_domain_event_id_is_dispatched_and_queued_once():
    dispatched: list[dict] = []
    duplicate_written = asyncio.Event()
    connection_count = 0
    event_id = str(uuid.uuid4())
    frame = tcp_message(
        "submission.completed",
        "java",
        "student:17",
        {"submission_id": 17},
        event_id=event_id,
    )

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        nonlocal connection_count
        connection_count += 1
        try:
            await authenticate_peer(reader, writer)
            writer.write(frame)
            await writer.drain()
            if connection_count == 1:
                return
            duplicate_written.set()
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    async def capture(event: dict) -> None:
        dispatched.append(event)

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    router = RealtimeEventRouter()
    router.subscribe(capture)
    bridge = RealtimeBridge(
        "127.0.0.1",
        server.sockets[0].getsockname()[1],
        SHARED_SECRET,
        router,
        initial_retry=0.01,
        max_retry=0.02,
        heartbeat_interval=3600,
    )
    try:
        assert await bridge.connect()
        await asyncio.wait_for(duplicate_written.wait(), timeout=2)
        await wait_until_connected(bridge)
        deadline = asyncio.get_running_loop().time() + 1
        while len(dispatched) < 1 and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.005)
        await asyncio.sleep(0.02)

        assert len(dispatched) == 1
        assert dispatched[0]["event_id"] == event_id
        assert bridge._inbound.qsize() == 1
        assert (await bridge.receive())["event_id"] == event_id
        assert connection_count >= 2
    finally:
        await bridge.disconnect()
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_tcp_ping_pong_keeps_bridge_alive_and_stays_out_of_domain_routing():
    client_ping_seen = asyncio.Event()
    client_pong_seen = asyncio.Event()
    routed_events: list[dict] = []

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await authenticate_peer(reader, writer)
            writer.write(tcp_message("ping", "java", "client:fastapi", {}))
            await writer.drain()
            while not (client_ping_seen.is_set() and client_pong_seen.is_set()):
                message = json.loads(await asyncio.wait_for(reader.readline(), timeout=2))
                if message["type"] == "ping":
                    client_ping_seen.set()
                    writer.write(tcp_message("pong", "java", "client:fastapi", {}))
                    await writer.drain()
                elif message["type"] == "pong":
                    client_pong_seen.set()
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    async def capture(event: dict) -> None:
        routed_events.append(event)

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    router = RealtimeEventRouter()
    router.subscribe(capture)
    bridge = RealtimeBridge(
        "127.0.0.1",
        server.sockets[0].getsockname()[1],
        SHARED_SECRET,
        router,
        heartbeat_interval=0.01,
        heartbeat_timeout=0.2,
    )
    try:
        assert await bridge.connect()
        await asyncio.wait_for(client_ping_seen.wait(), timeout=2)
        await asyncio.wait_for(client_pong_seen.wait(), timeout=2)
        assert bridge.is_connected
        assert routed_events == []
        assert bridge._inbound.empty()
    finally:
        await bridge.disconnect()
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_tcp_heartbeat_timeout_reconnects_to_java():
    connection_count = 0
    second_connected = asyncio.Event()

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        nonlocal connection_count
        connection_count += 1
        try:
            await authenticate_peer(reader, writer)
            ping = json.loads(await asyncio.wait_for(reader.readline(), timeout=2))
            assert ping["type"] == "ping"
            if connection_count > 1:
                writer.write(tcp_message("pong", "java", "client:fastapi", {}))
                await writer.drain()
                second_connected.set()
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    bridge = RealtimeBridge(
        "127.0.0.1",
        server.sockets[0].getsockname()[1],
        SHARED_SECRET,
        initial_retry=0.01,
        max_retry=0.02,
        heartbeat_interval=0.01,
        heartbeat_timeout=0.02,
    )
    try:
        assert await bridge.connect()
        await asyncio.wait_for(second_connected.wait(), timeout=2)
        await wait_until_connected(bridge)
        assert connection_count >= 2
        assert bridge.is_connected
    finally:
        await bridge.disconnect()
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_tcp_reconnect_backoff_is_exponential_and_capped(monkeypatch):
    import app.realtime.bridge as bridge_module

    attempt_times: list[float] = []
    fourth_attempt = asyncio.Event()

    async def unavailable_server(*_args, **_kwargs):
        attempt_times.append(asyncio.get_running_loop().time())
        if len(attempt_times) == 4:
            fourth_attempt.set()
        raise ConnectionRefusedError("test server unavailable")

    monkeypatch.setattr(bridge_module.asyncio, "open_connection", unavailable_server)
    bridge = RealtimeBridge(
        "127.0.0.1",
        9000,
        SHARED_SECRET,
        initial_retry=0.01,
        max_retry=0.02,
        heartbeat_interval=3600,
    )
    try:
        assert not await bridge.connect()
        await asyncio.wait_for(fourth_attempt.wait(), timeout=2)
    finally:
        await bridge.disconnect()

    intervals = [later - earlier for earlier, later in zip(attempt_times, attempt_times[1:])]
    assert len(intervals) == 3
    assert intervals[0] >= 0.008
    assert intervals[1] >= 0.016
    assert intervals[2] >= 0.016
    assert all(interval < 0.2 for interval in intervals)


@pytest.mark.asyncio
async def test_oversized_tcp_frame_disconnects_peer_and_bridge_recovers():
    connection_count = 0
    recovered = asyncio.Event()

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        nonlocal connection_count
        connection_count += 1
        try:
            await authenticate_peer(reader, writer)
            if connection_count == 1:
                writer.write(b"x" * (64 * 1024 + 2) + b"\n")
                await writer.drain()
                await reader.read()
            else:
                recovered.set()
                await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    bridge = RealtimeBridge(
        "127.0.0.1",
        server.sockets[0].getsockname()[1],
        SHARED_SECRET,
        initial_retry=0.01,
        max_retry=0.02,
        heartbeat_interval=3600,
    )
    try:
        assert await bridge.connect()
        await asyncio.wait_for(recovered.wait(), timeout=2)
        await wait_until_connected(bridge)
        assert connection_count >= 2
        assert bridge.is_connected
    finally:
        await bridge.disconnect()
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_java_event_is_dispatched_to_exam_sessions_only(
    client, teacher_token, student_token, monkeypatch
):
    received = asyncio.Event()
    teacher_id = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {teacher_token}"}
    ).json()["id"]
    student_id = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {student_token}"}
    ).json()["id"]
    db = SessionLocal()
    exam = Exam(
        title="Bridge integration",
        teacher_id=teacher_id,
        status=ExamStatus.started,
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)
    db.add(ExamParticipant(exam_id=exam.id, student_id=student_id))
    db.commit()

    class BrowserSocket:
        def __init__(self):
            self.sent = []
            self.closed = []

        async def accept(self):
            pass

        async def send_json(self, event):
            self.sent.append(event)
            received.set()

        async def close(self, code=1000, reason=None):
            self.closed.append((code, reason))

    manager = RealtimeManager()

    async def no_presence_write(_user_id):
        return None

    manager._sync_user_presence = no_presence_write
    student_tab_one = BrowserSocket()
    student_tab_two = BrowserSocket()
    teacher_socket = BrowserSocket()
    await manager.register(student_tab_one, student_id, "student")
    await manager.register(student_tab_two, student_id, "student")
    await manager.register(teacher_socket, teacher_id, "teacher")
    monkeypatch.setattr(fastapi_app.state, "realtime_manager", manager)

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await authenticate_peer(reader, writer)
            writer.write(
                tcp_message(
                    "exam.started", "java", f"exam:{exam.id}", {"title": "invalid"}
                )
                + tcp_message(
                    "exam.started", "java", f"exam:{exam.id}",
                    {"exam_id": exam.id, "title": "Bridge integration"},
                )
            )
            await writer.drain()
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    bridge = RealtimeBridge(
        "127.0.0.1",
        server.sockets[0].getsockname()[1],
        SHARED_SECRET,
        configured_bridge.event_router,
    )
    try:
        assert await bridge.connect()
        await asyncio.wait_for(received.wait(), timeout=2)
        await asyncio.sleep(0.05)
        assert [event["type"] for event in student_tab_one.sent] == ["exam.started"]
        assert student_tab_one.sent == student_tab_two.sent
        assert [event["type"] for event in teacher_socket.sent] == ["exam.started"]
    finally:
        await bridge.disconnect()
        await manager.shutdown()
        server.close()
        await server.wait_closed()
        db.delete(exam)
        db.commit()
        db.close()


def test_java_tcp_event_reaches_authenticated_browser_websockets(monkeypatch):
    disabled_bridge = RealtimeBridge("127.0.0.1", 0, None)
    monkeypatch.setattr(main_module, "realtime_bridge", disabled_bridge)
    monkeypatch.setattr(fastapi_app.state, "realtime_bridge", disabled_bridge)

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await authenticate_peer(reader, writer)
            writer.write(
                b'{"malformed-json\n'
                + tcp_message("unknown.event", "java", "broadcast", {})
                + tcp_message(
                    "exam.started",
                    "java",
                    f"exam:{exam_id}",
                    {"exam_id": exam_id, "title": "TCP to browser"},
                )
            )
            await writer.drain()
            outbound_line = await asyncio.wait_for(reader.readline(), timeout=3)
            outbound_event = json.loads(outbound_line)
            assert outbound_event["type"] == "exam.ended"
            assert outbound_event["recipient"] == f"exam:{exam_id}"
            writer.write(tcp_message(
                outbound_event["type"],
                "java",
                outbound_event["recipient"],
                outbound_event["payload"],
            ))
            await writer.drain()
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    async def close_server(server):
        server.close()
        await server.wait_closed()

    def register(client, role: str) -> str:
        username = f"tcp_route_{role}_{uuid.uuid4().hex[:10]}"
        response = client.post(
            "/auth/register",
            json={
                "username": username,
                "password": "realtime-pass-123",
                "full_name": f"TCP route {role}",
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

    bridge = None
    server = None
    with TestClient(fastapi_app) as client:
        teacher_token = register(client, "teacher")
        student_token = register(client, "student")
        other_teacher_token = register(client, "teacher")
        exam_response = client.post(
            "/exams",
            json={"title": "TCP to browser"},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert exam_response.status_code == 201
        exam_id = exam_response.json()["id"]
        published = client.put(
            f"/exams/{exam_id}",
            json={"status": "published"},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert published.status_code == 200
        assert client.post(
            f"/exams/{exam_id}/join",
            headers={"Authorization": f"Bearer {student_token}"},
        ).status_code == 204
        started = client.put(
            f"/exams/{exam_id}",
            json={"status": "started"},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert started.status_code == 200

        with (
            client.websocket_connect(f"/ws/realtime?token={student_token}") as student_tab_one,
            client.websocket_connect(f"/ws/realtime?token={student_token}") as student_tab_two,
            client.websocket_connect(f"/ws/realtime?token={teacher_token}") as exam_teacher,
            client.websocket_connect(f"/ws/realtime?token={other_teacher_token}") as other_teacher,
        ):
            assert student_tab_one.receive_json()["type"] == "connection.ready"
            assert student_tab_two.receive_json()["type"] == "connection.ready"
            assert exam_teacher.receive_json()["type"] == "connection.ready"
            assert other_teacher.receive_json()["type"] == "connection.ready"

            server = client.portal.call(asyncio.start_server, peer, "127.0.0.1", 0)
            port = server.sockets[0].getsockname()[1]
            bridge = RealtimeBridge(
                "127.0.0.1",
                port,
                SHARED_SECRET,
                fastapi_app.state.realtime_event_router,
            )
            monkeypatch.setattr(main_module, "realtime_bridge", bridge)
            monkeypatch.setattr(fastapi_app.state, "realtime_bridge", bridge)
            assert client.portal.call(bridge.connect)
            client.portal.call(asyncio.sleep, 0.05)

            for websocket in (student_tab_one, student_tab_two, exam_teacher):
                event = websocket.receive_json()
                assert event["type"] == "exam.started"
                assert event["payload"] == {
                    "exam_id": exam_id,
                    "title": "TCP to browser",
                }

            ended = client.put(
                f"/exams/{exam_id}",
                json={"status": "ended"},
                headers={"Authorization": f"Bearer {teacher_token}"},
            )
            assert ended.status_code == 200
            for websocket in (student_tab_one, student_tab_two, exam_teacher):
                event = websocket.receive_json()
                assert event["type"] == "exam.ended"
                assert event["payload"]["exam_id"] == exam_id

            other_teacher.send_json({"type": "client.heartbeat"})
            assert other_teacher.receive_json()["type"] == "client.heartbeat"

            client.portal.call(bridge.disconnect)
            await_close = client.portal.call(close_server, server)
            assert await_close is None

    assert bridge is not None and not bridge.is_connected


@pytest.mark.asyncio
async def test_bridge_detects_disconnect_and_reconnects():
    first_connection = asyncio.Event()
    second_connection = asyncio.Event()
    connection_count = 0

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        nonlocal connection_count
        connection_count += 1
        try:
            await authenticate_peer(reader, writer)
            if connection_count == 1:
                first_connection.set()
                writer.close()
                await writer.wait_closed()
                return
            second_connection.set()
            await reader.read()
        finally:
            if not writer.is_closing():
                writer.close()
                await writer.wait_closed()

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    bridge = RealtimeBridge(
        "127.0.0.1",
        server.sockets[0].getsockname()[1],
        SHARED_SECRET,
        initial_retry=0.01,
        max_retry=0.05,
    )
    try:
        await bridge.start()
        await asyncio.wait_for(first_connection.wait(), timeout=2)
        await asyncio.wait_for(second_connection.wait(), timeout=2)
        await wait_until_connected(bridge)
        assert connection_count >= 2
    finally:
        await bridge.stop()
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_bridge_reconnects_after_java_server_restart():
    first_connected = asyncio.Event()
    first_listener_closed = asyncio.Event()
    restarted_connection = asyncio.Event()
    first_server = []

    async def first_peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await authenticate_peer(reader, writer)
            first_connected.set()
            first_server[0].close()
            first_listener_closed.set()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(first_peer, "127.0.0.1", 0)
    first_server.append(server)
    port = server.sockets[0].getsockname()[1]
    bridge = RealtimeBridge(
        "127.0.0.1",
        port,
        SHARED_SECRET,
        initial_retry=0.01,
        max_retry=0.05,
    )
    restarted_server = None

    async def restarted_peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await authenticate_peer(reader, writer)
            restarted_connection.set()
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    try:
        assert await bridge.connect()
        await asyncio.wait_for(first_connected.wait(), timeout=2)
        await asyncio.wait_for(first_listener_closed.wait(), timeout=2)
        await first_server[0].wait_closed()
        restarted_server = await asyncio.start_server(restarted_peer, "127.0.0.1", port)
        await asyncio.wait_for(restarted_connection.wait(), timeout=2)
        await wait_until_connected(bridge)
        assert bridge.is_connected
    finally:
        await bridge.disconnect()
        if restarted_server is not None:
            restarted_server.close()
            await restarted_server.wait_closed()
        first_server[0].close()
        await first_server[0].wait_closed()


@pytest.mark.asyncio
async def test_disconnect_stops_receive_and_reconnect_tasks():
    connected = asyncio.Event()
    peer_closed = asyncio.Event()

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await authenticate_peer(reader, writer)
            connected.set()
            await reader.read()
        finally:
            peer_closed.set()
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    bridge = RealtimeBridge("127.0.0.1", server.sockets[0].getsockname()[1], SHARED_SECRET)
    try:
        assert await bridge.connect()
        await asyncio.wait_for(connected.wait(), timeout=2)
        await bridge.disconnect()
        await asyncio.wait_for(peer_closed.wait(), timeout=2)
        assert not bridge.is_connected
        assert bridge._task is None
    finally:
        await bridge.disconnect()
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_bridge_starts_cleanly_after_fastapi_shutdown_lifecycle():
    connection_events = [asyncio.Event(), asyncio.Event()]
    connection_count = 0

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        nonlocal connection_count
        connection_count += 1
        try:
            await authenticate_peer(reader, writer)
            connection_events[connection_count - 1].set()
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    bridge = RealtimeBridge(
        "127.0.0.1",
        server.sockets[0].getsockname()[1],
        SHARED_SECRET,
        initial_retry=0.01,
        max_retry=0.02,
        heartbeat_interval=3600,
    )
    try:
        assert await bridge.connect()
        await asyncio.wait_for(connection_events[0].wait(), timeout=2)
        await bridge.disconnect()
        assert not bridge.is_connected

        assert await bridge.connect()
        await asyncio.wait_for(connection_events[1].wait(), timeout=2)
        assert bridge.is_connected
        assert connection_count == 2
    finally:
        await bridge.disconnect()
        server.close()
        await server.wait_closed()


def test_api_health_is_available_when_java_server_is_unavailable(monkeypatch):
    import app.main as main

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        unavailable_port = probe.getsockname()[1]

    bridge = RealtimeBridge(
        "127.0.0.1",
        unavailable_port,
        SHARED_SECRET,
        initial_retry=0.01,
        max_retry=0.05,
    )
    monkeypatch.setattr(main, "realtime_bridge", bridge)

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
