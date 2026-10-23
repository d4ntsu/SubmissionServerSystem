import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.realtime.auth import authenticate_websocket
from app.realtime.manager import RealtimeManager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["realtime"])
MAX_CLIENT_MESSAGE_BYTES = 4096
MAX_PROTOCOL_ERRORS = 3


def _origin_is_allowed(origin: str | None) -> bool:
    if origin is None:
        return True
    allowed_origins = {item.strip() for item in settings.cors_origins.split(",") if item.strip()}
    return origin in allowed_origins


@router.websocket("/ws/realtime")
async def websocket_endpoint(websocket: WebSocket) -> None:
    if not _origin_is_allowed(websocket.headers.get("origin")):
        await websocket.close(code=1008, reason="Origin is not allowed")
        return

    authenticated_user = authenticate_websocket(websocket)
    if authenticated_user is None:
        await websocket.close(code=1008, reason="Authentication required")
        return

    user_id, role = authenticated_user
    manager: RealtimeManager = websocket.app.state.realtime_manager
    connection_count = await manager.register(websocket, user_id, role)
    try:
        await websocket.send_json({
            "type": "connection.ready",
            "user_id": user_id,
            "role": role,
            "connection_count": connection_count,
        })
        await _receive_client_messages(websocket, manager, user_id)
    except WebSocketDisconnect:
        pass
    except (RuntimeError, OSError):
        logger.info("WebSocket send or receive failed for user %s", user_id)
    except Exception:
        logger.exception("Unexpected realtime WebSocket failure for user %s", user_id)
        try:
            await websocket.close(code=1011, reason="Realtime service error")
        except (RuntimeError, OSError, WebSocketDisconnect):
            pass
    finally:
        await manager.unregister(websocket, user_id)


async def _receive_client_messages(
    websocket: WebSocket, manager: RealtimeManager, user_id: int
) -> None:
    loop = asyncio.get_running_loop()
    heartbeat_deadline = loop.time() + manager.heartbeat_timeout_seconds
    protocol_errors = 0

    while True:
        remaining = heartbeat_deadline - loop.time()
        if remaining <= 0:
            await websocket.close(code=1001, reason="Heartbeat timeout")
            return
        try:
            frame = await asyncio.wait_for(websocket.receive(), timeout=remaining)
        except asyncio.TimeoutError:
            await websocket.close(code=1001, reason="Heartbeat timeout")
            return

        if frame.get("type") == "websocket.disconnect":
            return
        raw_text = frame.get("text")
        if not isinstance(raw_text, str) or len(raw_text.encode("utf-8")) > MAX_CLIENT_MESSAGE_BYTES:
            protocol_errors += 1
            await _send_protocol_error(websocket, "invalid_message", "Message must be a small JSON object")
        else:
            try:
                message = json.loads(raw_text)
            except json.JSONDecodeError:
                message = None

            if not isinstance(message, dict):
                protocol_errors += 1
                await _send_protocol_error(websocket, "malformed_json", "Message must be a JSON object")
            elif message.get("type") != "client.heartbeat" or set(message) - {"type", "request_id"}:
                protocol_errors += 1
                await _send_protocol_error(websocket, "unsupported_client_event", "Only client.heartbeat is accepted")
            else:
                request_id = message.get("request_id")
                if request_id is not None:
                    try:
                        request_id = str(uuid.UUID(request_id))
                    except (ValueError, TypeError, AttributeError):
                        protocol_errors += 1
                        await _send_protocol_error(websocket, "invalid_request_id", "request_id must be a UUID")
                        request_id = None
                    else:
                        if not await manager.record_heartbeat(websocket, user_id):
                            await websocket.close(code=1001, reason="Connection is no longer active")
                            return
                        heartbeat_deadline = loop.time() + manager.heartbeat_timeout_seconds
                        await _send_heartbeat_ack(websocket, request_id)
                else:
                    if not await manager.record_heartbeat(websocket, user_id):
                        await websocket.close(code=1001, reason="Connection is no longer active")
                        return
                    heartbeat_deadline = loop.time() + manager.heartbeat_timeout_seconds
                    await _send_heartbeat_ack(websocket, None)

        if protocol_errors >= MAX_PROTOCOL_ERRORS:
            await websocket.close(code=1008, reason="Too many invalid client messages")
            return


async def _send_heartbeat_ack(websocket: WebSocket, request_id: str | None) -> None:
    message = {
        "type": "client.heartbeat",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "payload": {"alive": True},
    }
    if request_id:
        message["request_id"] = request_id
    await websocket.send_json(message)


async def _send_protocol_error(websocket: WebSocket, code: str, message: str) -> None:
    await websocket.send_json({"type": "server.error", "code": code, "error": message})
