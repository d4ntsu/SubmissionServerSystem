import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app, headers={"Origin": "http://localhost:3000"})


@pytest.fixture
def teacher_token(client):
    resp = client.post("/auth/register", json={
        "username": "test_teacher", "password": "teacher123",
        "full_name": "Test Teacher", "role": "teacher",
    })
    # 201 if new, 400 if already exists from a prior run
    assert resp.status_code in (201, 400)

    resp = client.post("/auth/login", json={"username": "test_teacher", "password": "teacher123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


@pytest.fixture
def student_token(client):
    resp = client.post("/auth/register", json={
        "username": "test_student", "password": "student123",
        "full_name": "Test Student", "role": "student",
    })
    assert resp.status_code in (201, 400)

    resp = client.post("/auth/login", json={"username": "test_student", "password": "student123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]
