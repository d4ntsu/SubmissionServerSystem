from fastapi import WebSocket

from app.database import SessionLocal
from app.services.dependencies import get_user_from_access_token


def authenticate_websocket(websocket: WebSocket) -> tuple[int, str] | None:
    """Validate the existing JWT and reload canonical user identity and role from the database."""
    token = websocket.query_params.get("token")
    if not token or len(token) > 8192:
        return None

    db = SessionLocal()
    try:
        user = get_user_from_access_token(token, db)
        if user is None:
            return None
        return user.id, user.role.value
    finally:
        db.close()
