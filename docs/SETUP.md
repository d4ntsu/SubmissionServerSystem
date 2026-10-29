

## Prerequisites

Install or confirm:

- Python 3.11+
- Node.js 18+
- Java 17+ and Maven 3.9+
- Docker Desktop, running with its WSL2 engine

## 1. Configure the backend

From the repository root, create the backend’s local environment file:

```powershell
Copy-Item .env.example backend\.env
```

Edit `backend\.env`. Set a strong, random value for `SECRET_KEY` and another for `SOCKET_SERVER_SHARED_SECRET`. Keep these values private and don’t commit the `.env` file. The socket secret must match in the backend and Java server.

The remaining example settings are suitable for local development. In particular, keep Piston on `http://127.0.0.1:2000`.

## 2. Install backend dependencies

From the repository root:

```powershell
Set-Location backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

The commands below use the virtual environment at `backend\.venv`.

## 3. Start Piston for real code grading

In a separate PowerShell window at the repository root:

```powershell
docker compose -f deploy\piston\docker-compose.yml up -d
```

Piston’s image and language runtimes are separate: starting the container alone may not install Java or Python runtimes. Check `http://127.0.0.1:2000/api/v2/runtimes`; install any missing runtimes using the instructions in `the project setup documentation`. The Java smoke test is:

```powershell
python deploy\piston\phase1_java_test.py
```

Keep Piston bound to localhost; it runs submitted code and should not be exposed directly to student devices.

## 4. Start the Java socket server

Open another PowerShell window at the repository root. This loads the secrets from `backend\.env` into the Java process without printing them:

```powershell
$envValues = @{}
Get-Content .\backend\.env | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
        $envValues[$matches[1].Trim()] = $matches[2].Trim()
    }
}

$env:SOCKET_SERVER_SHARED_SECRET = $envValues["SOCKET_SERVER_SHARED_SECRET"]
$env:SECRET_KEY = $envValues["SECRET_KEY"]

Set-Location .\java-socket-server
mvn package
java -jar target\realtime-server-1.0.0-jar-with-dependencies.jar
```

Leave this window running. If the secrets are missing or don’t match, Java will reject the backend’s authentication attempt.

## 5. Start FastAPI

In another window:

```powershell
Set-Location backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) for the API, or check [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health). The backend creates its SQLite database under `backend\data`.

### Create a developer account in Swagger

In Swagger, expand **POST /auth/register**, select **Try it out**, and submit a request such as:

```json
{
  "username": "my_teacher",
  "password": "choose-a-password",
  "full_name": "My Name",
  "role": "teacher"
}
```

Use a username of 3–50 characters, a password of 4–100 characters, and choose `teacher` or `student` for the role. Registration is public, so no token is needed. After receiving a `201` response, use **POST /auth/login** with the same username and password to get an access token.

## 6. Start the frontend

In a separate window:

```powershell
Set-Location frontend
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). 

Keep the Piston, Java, backend, and frontend windows open while using the corresponding services; stop each with **Ctrl+C**.

## 7. Run the automated tests and checks

Run each component's checks from its own directory. The backend test suite includes the live Java/FastAPI/browser acceptance test; it builds and starts its own Java server, so you do not need to start the Java server from step 4 for that test.

### Frontend

The frontend currently defines lint and production-build checks, but no `test` script or frontend unit-test suite.

From the repository root:

```powershell
Set-Location frontend
npm ci
npm run lint
npm run build
```

### Backend

From the repository root, run the full pytest suite using the virtual environment created in step 2. A unique test database keeps test data separate from your local development database:

```powershell
Set-Location backend
$env:DATABASE_URL = "sqlite:///./data/pytest-$([guid]::NewGuid().ToString('N')).db"
.\.venv\Scripts\python.exe -m pytest -q
```

The backend tests need Python dependencies from `backend\requirements.txt`, plus Java and Maven for the live realtime acceptance test. They do not require a separately running Piston container. If you created the virtual environment under a different name, use that environment's `python.exe` instead.

### Java socket server

From the repository root:

```powershell
Set-Location java-socket-server
mvn test
```

This runs the Java unit tests without starting the server. To build the runnable server JAR as well as run the Java tests, use:

```powershell
mvn package
```

### Run all component checks

Run the frontend, backend, and Java commands above in that order. Each command reports its own result; all should complete successfully. The backend's live acceptance test starts an isolated Java process, so it can run while the development services are stopped.