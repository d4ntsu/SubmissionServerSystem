import asyncio
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie

import httpx
import pytest

from app.api.auth import REFRESH_COOKIE_NAME
from app.database import SessionLocal, ensure_refresh_session_schema
from app.main import app
from app.models.refresh_session import RefreshSession

AUTH_ORIGIN = "http://localhost:3000"


def _create_user_and_login(client):
    username = f"refresh_{uuid.uuid4().hex[:12]}"
    headers = {"Origin": AUTH_ORIGIN}
    registration = client.post(
        "/auth/register",
        headers=headers,
        json={
            "username": username,
            "password": "pass123",
            "full_name": "Refresh Test",
            "role": "student",
        },
    )
    assert registration.status_code == 201

    response = client.post(
        "/auth/login",
        headers=headers,
        json={"username": username, "password": "pass123"},
    )
    assert response.status_code == 200
    return username, headers, response


def _hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def test_login_sets_http_only_refresh_cookie_without_returning_it(client):
    _, _, response = _create_user_and_login(client)
    cookie_header = response.headers["set-cookie"]
    refresh_token = client.cookies.get(REFRESH_COOKIE_NAME)

    assert response.json().get("access_token")
    assert REFRESH_COOKIE_NAME not in response.json()
    assert refresh_token
    assert f"{REFRESH_COOKIE_NAME}={refresh_token}" in cookie_header
    assert "HttpOnly" in cookie_header
    assert "Path=/auth" in cookie_header
    assert "Max-Age=1209600" in cookie_header
    assert "SameSite=lax" in cookie_header
    assert "Secure" not in cookie_header

    db = SessionLocal()
    try:
        stored = db.query(RefreshSession).filter_by(token_hash=_hash_token(refresh_token)).one()
        assert stored.token_hash != refresh_token
    finally:
        db.close()


def test_refresh_session_schema_preserves_existing_token_families(client):
    _, _, _ = _create_user_and_login(client)
    refresh_token = client.cookies.get(REFRESH_COOKIE_NAME)

    db = SessionLocal()
    try:
        session = db.query(RefreshSession).filter_by(
            token_hash=_hash_token(refresh_token)
        ).one()
        family_id = session.family_id

        ensure_refresh_session_schema()

        db.expire_all()
        migrated_session = db.query(RefreshSession).filter_by(
            token_hash=_hash_token(refresh_token)
        ).one()
        assert migrated_session.family_id == family_id
    finally:
        db.close()


def test_refresh_rotates_refresh_token_and_access_token(client):
    _, headers, login_response = _create_user_and_login(client)
    old_refresh_token = client.cookies.get(REFRESH_COOKIE_NAME)
    old_access_token = login_response.json()["access_token"]

    response = client.post("/auth/refresh", headers=headers)
    new_refresh_token = client.cookies.get(REFRESH_COOKIE_NAME)

    assert response.status_code == 200
    assert response.json()["access_token"] != old_access_token
    assert new_refresh_token and new_refresh_token != old_refresh_token
    assert old_refresh_token not in response.text
    assert response.json().get(REFRESH_COOKIE_NAME) is None

    db = SessionLocal()
    try:
        old_session = db.query(RefreshSession).filter_by(
            token_hash=_hash_token(old_refresh_token)
        ).one()
        new_session = db.query(RefreshSession).filter_by(
            token_hash=_hash_token(new_refresh_token)
        ).one()
        assert old_session.revoked_at is not None
        assert old_session.replaced_by_hash == new_session.token_hash
        assert old_session.family_id == new_session.family_id
        assert new_session.revoked_at is None
    finally:
        db.close()

    me_response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {response.json()['access_token']}"},
    )
    assert me_response.status_code == 200


def test_refresh_rejects_missing_invalid_and_expired_tokens(client):
    headers = {"Origin": AUTH_ORIGIN}
    missing = client.post("/auth/refresh", headers=headers)
    assert missing.status_code == 401

    client.cookies.set(REFRESH_COOKIE_NAME, "malformed-unknown-token", path="/auth")
    invalid = client.post("/auth/refresh", headers=headers)
    assert invalid.status_code == 401

    client.cookies.clear()
    _, _, login_response = _create_user_and_login(client)
    token = client.cookies.get(REFRESH_COOKIE_NAME)
    db = SessionLocal()
    try:
        session = db.query(RefreshSession).filter_by(token_hash=_hash_token(token)).one()
        session.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    finally:
        db.close()

    expired = client.post("/auth/refresh", headers=headers)
    assert expired.status_code == 401
    assert "Max-Age=0" in expired.headers.get("set-cookie", "")
    assert login_response.status_code == 200


def test_refresh_reuse_is_rejected_and_old_reuse_revokes_the_family(client):
    _, headers, _ = _create_user_and_login(client)
    old_token = client.cookies.get(REFRESH_COOKIE_NAME)
    rotated = client.post("/auth/refresh", headers=headers)
    assert rotated.status_code == 200
    new_token = client.cookies.get(REFRESH_COOKIE_NAME)

    client.cookies.set(
        REFRESH_COOKIE_NAME,
        old_token,
        domain="testserver.local",
        path="/auth",
    )
    concurrent_retry = client.post("/auth/refresh", headers=headers)
    assert concurrent_retry.status_code == 409

    db = SessionLocal()
    try:
        old_session = db.query(RefreshSession).filter_by(token_hash=_hash_token(old_token)).one()
        old_session.revoked_at = datetime.now(timezone.utc) - timedelta(seconds=30)
        db.commit()
    finally:
        db.close()

    replay = client.post("/auth/refresh", headers=headers)
    assert replay.status_code == 401
    assert "Max-Age=0" in replay.headers.get("set-cookie", "")

    db = SessionLocal()
    try:
        family = db.query(RefreshSession).filter_by(token_hash=_hash_token(new_token)).one()
        assert family.revoked_at is not None
    finally:
        db.close()


@pytest.mark.asyncio
async def test_concurrent_refresh_requests_do_not_revoke_the_winning_rotation(client):
    _, _, _ = _create_user_and_login(client)
    original_token = client.cookies.get(REFRESH_COOKIE_NAME)
    transport = httpx.ASGITransport(app=app)

    async def refresh_once():
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as async_client:
            return await async_client.post(
                "/auth/refresh",
                headers={
                    "Origin": AUTH_ORIGIN,
                    "Cookie": f"{REFRESH_COOKIE_NAME}={original_token}",
                },
            )

    responses = await asyncio.gather(refresh_once(), refresh_once())
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response for response in responses if response.status_code == 200)
    cookie = SimpleCookie()
    cookie.load(winner.headers["set-cookie"])
    rotated_token = cookie[REFRESH_COOKIE_NAME].value

    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as async_client:
        after_race = await async_client.post(
            "/auth/refresh",
            headers={
                "Origin": AUTH_ORIGIN,
                "Cookie": f"{REFRESH_COOKIE_NAME}={rotated_token}",
            },
        )
    assert after_race.status_code == 200


def test_logout_revokes_refresh_session_and_clears_cookie(client):
    _, headers, _ = _create_user_and_login(client)
    refresh_token = client.cookies.get(REFRESH_COOKIE_NAME)

    response = client.post("/auth/logout", headers=headers)
    assert response.status_code == 204
    assert REFRESH_COOKIE_NAME not in client.cookies
    assert "Max-Age=0" in response.headers["set-cookie"]

    db = SessionLocal()
    try:
        session = db.query(RefreshSession).filter_by(token_hash=_hash_token(refresh_token)).one()
        assert session.revoked_at is not None
    finally:
        db.close()


def test_refresh_and_logout_reject_untrusted_origins(client):
    _, _, _ = _create_user_and_login(client)
    bad_origin = {"Origin": "http://malicious.example"}
    assert client.post("/auth/refresh", headers=bad_origin).status_code == 403
    assert client.post("/auth/logout", headers=bad_origin).status_code == 403


def test_me_rejects_missing_and_invalid_access_tokens(client):
    assert client.get("/auth/me").status_code in (401, 403)
    assert client.get(
        "/auth/me",
        headers={"Authorization": "Bearer invalid-access-token"},
    ).status_code == 401
