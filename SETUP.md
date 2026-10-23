# Project Setup

This guide describes how to set up the project in its current state. Update it when major components, dependencies, configuration, or startup steps change.

## Project components

- `backend/` — FastAPI API, SQLite persistence, and background grading worker.
- `deploy/piston/` — Docker Compose configuration for the Piston code-execution service.
- `java-socket-server/` — Java TCP server for realtime events.
- `frontend/` — frontend files. It does not currently have a package manifest or a documented frontend build/start command.

## Prerequisites

Install the tools required for the components you intend to run:

- Python 3.11 recommended for the backend and its tests.
- Java 17 or newer and Maven 3.9 or newer for the socket server.
- Docker Desktop with Docker Compose for Piston.

## Backend setup

Run these commands from the repository root in PowerShell:

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

The backend reads `.env` relative to its working directory. Copy the root example into `backend` and set a non-empty secret:

```powershell
Copy-Item ..\.env.example .env
```

Edit `backend\.env` and set at least `SECRET_KEY` to a secure, randomly generated value. The example configures SQLite at `./data/exam_system.db`, relative to the `backend` directory. The backend creates the database tables on startup.

Start the API from `backend`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Check that it is responding:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

The grading worker starts with the API. To grade submissions, Piston must also be running.

## Piston setup

From the repository root, start Piston:

```powershell
docker compose -f deploy/piston/docker-compose.yml up -d
```

The service is configured to bind to `127.0.0.1:2000`. The backend's default `PISTON_BASE_URL` uses that address. Keep Piston bound locally; do not expose the code-execution service to an untrusted network.

To stop Piston:

```powershell
docker compose -f deploy/piston/docker-compose.yml down
```

## Java realtime server setup

The Java server requires Java 17+ and Maven. Its default database path may not match the backend database location. Configure it to use the same SQLite database as the backend, preferably with an absolute path.

From the repository root:

```powershell
cd java-socket-server
mvn clean package
```

The packaged application is:

```text
target/realtime-server-1.0.0-jar-with-dependencies.jar
```

Set the database path and shared authentication secret before starting the server. Use the same secret value as the backend's `SECRET_KEY`:

```powershell
$env:DATABASE_PATH = "D:\CodeProjects\SubmissionServerSystem\backend\data\exam_system.db"
$env:SHARED_SECRET = "replace-with-the-same-value-as-backend-SECRET_KEY"
java -jar target\realtime-server-1.0.0-jar-with-dependencies.jar
```

By default, the server binds to `127.0.0.1:9000`. It can also be built and tested with:

```powershell
mvn test
```

## Backend tests

Run tests from `backend`:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\ -v
```

Tests use the configured database, so use a separate test database if you need to preserve existing local data. For example, set `DATABASE_URL` in the PowerShell session before running pytest:

```powershell
$env:DATABASE_URL = "sqlite:///./data/test_exam_system.db"
.\.venv\Scripts\python.exe -m pytest tests\ -v
```

## Configuration reference

The root `.env.example` documents the current settings, including:

- `SECRET_KEY` and JWT settings for authentication.
- `DATABASE_URL` for the backend's SQLite database.
- `PISTON_BASE_URL` and grading time/memory limits.
- `SOCKET_SERVER_HOST` and `SOCKET_SERVER_PORT`.
- `CORS_ORIGINS`.
- `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` for the frontend.

The Java server reads `server.properties` and supports environment overrides such as `DATABASE_PATH`, `SHARED_SECRET`, `SOCKET_HOST`, and `SOCKET_PORT`.

Do not commit real secrets. Keep the backend and Java server configured with matching authentication secrets.

## Updating this guide

Update `SETUP.md` whenever a major change affects prerequisites, environment variables, database setup, service startup, tests, or deployment.