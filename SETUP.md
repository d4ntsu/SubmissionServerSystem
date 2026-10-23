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

### Install the Java execution runtime

Piston runs submitted code inside its container. A JDK installed on the host is not available to Piston, so install a runtime in Piston even if Java works in Windows.

Install the Java package from the repository root:

```powershell
$body = @{ language = "java"; version = "15.0.2" } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:2000/api/v2/packages" `
  -ContentType "application/json" `
  -Body $body `
  -TimeoutSec 600
```

Confirm that Piston loaded it:

```powershell
Invoke-RestMethod http://127.0.0.1:2000/api/v2/runtimes |
  Where-Object { $_.language -eq "java" }
```

The result should include Java version `15.0.2`. If the install request times out, check `/api/v2/runtimes` and the container logs before retrying: the request may have timed out in PowerShell while the install continued in Piston.

#### Recover from a stalled or checksum-failing Java install

Piston verifies downloaded packages. Do not disable or bypass that check. If logs report a checksum mismatch or a Java package remains uninstalled, download the official archive and verify it before replacing the partial file. The checksum below is for the official `java-15.0.2.pkg.tar.gz` package; if Piston's official package index changes, use its current checksum instead.

Run these commands from the repository root in PowerShell:

```powershell
$archive = Join-Path $env:TEMP "piston-java-15.0.2.pkg.tar.gz"
$expectedHash = "f695d4ae1a8c783a9bcdd31f23795a980d938e50260254cf6a95560622c092f7"
curl.exe -L --fail --retry 2 --retry-delay 2 `
  -o $archive `
  "https://github.com/engineer-man/piston/releases/download/pkgs/java-15.0.2.pkg.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "Java package download failed." }
$actualHash = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw "Java package checksum mismatch; do not install this archive." }

docker compose -f deploy/piston/docker-compose.yml stop api
$packageDir = "deploy\piston\data\piston\packages\java\15.0.2"
New-Item -ItemType Directory -Force $packageDir | Out-Null
Copy-Item -LiteralPath $archive -Destination "$packageDir\pkg.tar.gz" -Force
$copiedHash = (Get-FileHash -Algorithm SHA256 "$packageDir\pkg.tar.gz").Hash.ToLowerInvariant()
if ($copiedHash -ne $expectedHash) { throw "Copied Java package checksum mismatch." }
docker compose -f deploy/piston/docker-compose.yml start api
```

After Piston starts, extract and register the verified package inside the container:

```powershell
$installScript = @'
set -eu
dir=/piston/packages/java/15.0.2
tar -xzf "$dir/pkg.tar.gz" -C "$dir"
cd "$dir"
env -i bash -c 'source environment; env' | grep -Ev '^(PWD|OLDPWD|_|SHLVL)=' > .env
chown -R 1001:1001 "$dir"
node -e 'process.stdout.write(Date.now().toString())' > .ppman-installed
test -s pkg-info.json
test -s .env
test -s .ppman-installed
'@
docker exec piston_api sh -c $installScript
if ($LASTEXITCODE -ne 0) { throw "Java package extraction or registration failed." }
docker restart piston_api
```

Verify the runtime is available before grading submissions:

```powershell
Invoke-RestMethod http://127.0.0.1:2000/api/v2/runtimes |
  Where-Object { $_.language -eq "java" }
```

To stop Piston:

```powershell
docker compose -f deploy/piston/docker-compose.yml down
```

## Java realtime server setup

The Java server requires Java 17+ and Maven. Its default database path is relative to the `java-socket-server` working directory and points to the backend's `data\exam_system.db`. If you start it from a different directory, set `DATABASE_PATH` to the absolute path of that same database.

From the repository root:

```powershell
cd java-socket-server
mvn clean package
```

The packaged application is:

```text
target/realtime-server-1.0.0-jar-with-dependencies.jar
```

Set the database path and shared authentication secret before starting the server. These PowerShell commands resolve the database path from the current project location and load the backend's `SECRET_KEY` without printing it:

```powershell
$env:DATABASE_PATH = (Resolve-Path ..\backend\data\exam_system.db).Path
$secretLine = Get-Content ..\backend\.env | Where-Object { $_ -match '^SECRET_KEY=' } | Select-Object -First 1
if (-not $secretLine -or $secretLine -eq 'SECRET_KEY=') { throw 'Set SECRET_KEY in backend\.env first.' }
$env:SHARED_SECRET = $secretLine.Substring('SECRET_KEY='.Length)
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