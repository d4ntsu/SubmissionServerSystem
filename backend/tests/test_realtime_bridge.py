import asyncio
import json
import socket

import pytest
from fastapi.testclient import TestClient

from app.realtime import RealtimeBridge, RealtimeEventRouter


SHARED_SECRET = "test-only-shared-secret"


async def authenticate_peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> dict:
    hello = json.loads(await asyncio.wait_for(reader.readline(), timeout=2))
    assert hello["type"] == "service.hello"
    assert hello["payload"]["shared_secret"] == SHARED_SECRET
    writer.write(
        b'{"type":"client.status","payload":{"authenticated":true,"service":true}}\n'
    )
    await writer.drain()
    return hello


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
            writer.write(
                b'{"type":"submission.completed","sender":"java","recipient":"broadcast",'
                b'"payload":{"submission_id":17,"status":"accepted"}}\n'
            )
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

        queued = await bridge.send_event({
            "type": "submission.running",
            "recipient": "role:teacher",
            "payload": {"submission_id": 17},
        })
        assert queued
        await asyncio.wait_for(routed.wait(), timeout=2)

        sent = received_events[0]["peer_message"]
        assert sent["type"] == "submission.running"
        assert sent["sender"] == "fastapi"
        assert sent["recipient"] == "role:teacher"
        assert sent["payload"] == {"submission_id": 17}
        assert received_events[1]["type"] == "submission.completed"
        assert not errors
    finally:
        await bridge.stop()
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_malformed_server_message_is_ignored_and_receive_loop_continues():
    routed_events: list[dict] = []
    routed = asyncio.Event()

    async def peer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await authenticate_peer(reader, writer)
            writer.write(b"{malformed json}\n")
            writer.write(b'{"type":"exam.announcement","payload":{"message":"ready"}}\n')
            await writer.drain()
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    async def capture(event: dict) -> None:
        routed_events.append(event)
        routed.set()

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    router = RealtimeEventRouter()
    router.subscribe(capture)
    bridge = RealtimeBridge("127.0.0.1", server.sockets[0].getsockname()[1], SHARED_SECRET, router)
    try:
        await bridge.start()
        await asyncio.wait_for(routed.wait(), timeout=2)
        assert routed_events == [{"type": "exam.announcement", "payload": {"message": "ready"}}]
        assert bridge.is_connected
    finally:
        await bridge.stop()
        server.close()
        await server.wait_closed()


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
