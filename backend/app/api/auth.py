import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.core.config import settings
from app.models.refresh_session import RefreshSession
from app.models.user import User
from app.schemas.token import TokenResponse
from app.schemas.user import UserCreate, UserLogin, UserResponse
from app.core.security import hash_password, create_access_token
from app.services.auth import authenticate_user, get_user_by_username
from app.services.dependencies import get_current_user
from fastapi import Request, Response

router = APIRouter(prefix="/auth", tags=["auth"])
REFRESH_COOKIE_NAME = "lan_exam_refresh"
REFRESH_ROTATION_GRACE_SECONDS = 10


def _validate_origin(request: Request, *, required: bool = False) -> None:
    origin = request.headers.get("origin")
    if origin is None:
        if required:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Origin header is required",
            )
        return
    allowed_origins = {
        item.strip() for item in settings.cors_origins.split(",") if item.strip()
    }
    if origin not in allowed_origins:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Origin is not allowed")


def _hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        max_age=settings.refresh_session_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite=settings.refresh_cookie_samesite,
        path="/auth",
    )


def _refresh_cookie_deletion_header() -> str:
    response = Response()
    _clear_refresh_cookie(response)
    return response.headers["set-cookie"]


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/auth",
        secure=settings.refresh_cookie_secure,
        httponly=True,
        samesite=settings.refresh_cookie_samesite,
    )


def _new_refresh_session(
    db: Session,
    user_id: int,
    family_id: str | None = None,
) -> str:
    raw_token = secrets.token_urlsafe(48)
    db.add(
        RefreshSession(
            user_id=user_id,
            token_hash=_hash_refresh_token(raw_token),
            family_id=family_id or str(uuid.uuid4()),
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.refresh_session_days),
        )
    )
    return raw_token


def _unauthorized_refresh() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Refresh session is invalid or expired",
        headers={"Set-Cookie": _refresh_cookie_deletion_header()},
    )


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account",
    description="Public self-service registration. No existing account or access token is required.",
)
def register(
    data: UserCreate,
    db: Session = Depends(get_db),
):
    if get_user_by_username(db, data.username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")
    user = User(
        username=data.username,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
def login(
    data: UserLogin,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    _validate_origin(request, required=True)
    old_refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if old_refresh_token:
        db.execute(
            update(RefreshSession)
            .where(
                RefreshSession.token_hash == _hash_refresh_token(old_refresh_token),
                RefreshSession.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.now(timezone.utc))
        )
        db.commit()
    _clear_refresh_cookie(response)

    user = authenticate_user(db, data.username, data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"Set-Cookie": _refresh_cookie_deletion_header()},
        )
    token = create_access_token({"user_id": user.id, "username": user.username, "role": user.role.value})
    refresh_token = _new_refresh_session(db, user.id)
    db.commit()
    _set_refresh_cookie(response, refresh_token)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    _validate_origin(request, required=True)
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw_token:
        raise _unauthorized_refresh()

    token_hash = _hash_refresh_token(raw_token)
    if db.get_bind().dialect.name == "sqlite":
        db.execute(text("BEGIN IMMEDIATE"))

    session = (
        db.query(RefreshSession)
        .filter(RefreshSession.token_hash == token_hash)
        .with_for_update()
        .first()
    )
    now = datetime.now(timezone.utc)
    if session is None:
        db.rollback()
        raise _unauthorized_refresh()

    if session.revoked_at is not None:
        recently_rotated = (
            session.replaced_by_hash is not None
            and (now - _as_utc(session.revoked_at)).total_seconds()
            <= REFRESH_ROTATION_GRACE_SECONDS
        )
        if recently_rotated:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Refresh token was rotated concurrently; retry with the updated cookie",
            )
        db.query(RefreshSession).filter(
            RefreshSession.family_id == session.family_id,
            RefreshSession.revoked_at.is_(None),
        ).update(
            {RefreshSession.revoked_at: now},
            synchronize_session=False,
        )
        db.commit()
        raise _unauthorized_refresh()

    if _as_utc(session.expires_at) <= now:
        session.revoked_at = now
        db.commit()
        raise _unauthorized_refresh()

    user = db.get(User, session.user_id)
    if user is None:
        session.revoked_at = now
        db.commit()
        raise _unauthorized_refresh()

    new_token = secrets.token_urlsafe(48)
    new_hash = _hash_refresh_token(new_token)
    session.revoked_at = now
    session.replaced_by_hash = new_hash
    db.add(
        RefreshSession(
            user_id=user.id,
            token_hash=new_hash,
            family_id=session.family_id,
            expires_at=now + timedelta(days=settings.refresh_session_days),
        )
    )
    db.commit()

    access_token = create_access_token(
        {"user_id": user.id, "username": user.username, "role": user.role.value}
    )
    _set_refresh_cookie(response, new_token)
    return TokenResponse(access_token=access_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    _validate_origin(request, required=True)
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if raw_token:
        db.execute(
            update(RefreshSession)
            .where(
                RefreshSession.token_hash == _hash_refresh_token(raw_token),
                RefreshSession.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.now(timezone.utc))
        )
        db.commit()
    _clear_refresh_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response