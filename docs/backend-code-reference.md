# Backend Code Reference — `backend/app/`

> Auto-generated documentation for every function in the backend application.
> Excludes `__pycache__` directories.

---

## Directory Structure

```
backend/app/
├── main.py                          # FastAPI application entry point
├── database.py                      # SQLAlchemy engine, session, and Base
├── core/
│   ├── config.py                    # Application settings (env vars)
│   └── security.py                  # Password hashing & JWT utilities
├── api/
│   ├── auth.py                      # POST /auth/register, /auth/login, GET /auth/me
│   ├── exams.py                     # CRUD /exams
│   ├── questions.py                 # CRUD /questions
│   ├── test_cases.py                # CRUD /test-cases
│   ├── submissions.py               # POST /submissions, GET /submissions
│   └── results.py                   # GET /results/{id}, GET /results/exam/{id}
├── models/
│   ├── user.py                      # User ORM model
│   ├── exam.py                      # Exam ORM model
│   ├── question.py                  # Question ORM model
│   ├── test_case.py                 # TestCase ORM model
│   └── submission.py                # Submission & SubmissionTestResult ORM models
├── schemas/
│   ├── user.py                      # UserCreate, UserLogin, UserResponse
│   ├── token.py                     # TokenResponse, TokenData
│   ├── exam.py                      # ExamCreate, ExamUpdate, ExamResponse
│   ├── question.py                  # QuestionCreate, QuestionUpdate, QuestionResponse
│   ├── test_case.py                 # TestCaseCreate, TestCaseResponse
│   └── submission.py                # SubmissionCreate, SubmissionResponse, SubmissionTestResultResponse
├── services/
│   ├── auth.py                      # User lookup & authentication
│   ├── dependencies.py              # FastAPI dependency callables (auth guards)
│   ├── submission_service.py        # Submission validation & persistence
│   ├── grading_service.py           # Grading orchestration (Piston integration)
│   └── piston_client.py             # Async HTTP client for Piston API v2
└── workers/
    └── grading_worker.py            # Background polling worker for grading queue
```

---

## `main.py` — Application Entry Point

### `app`
```python
app = FastAPI(title="LAN Programming Exam System", version="0.1.0")
```
The FastAPI application instance. Registers CORS middleware and six routers (`auth`, `exams`, `questions`, `test_cases`, `submissions`, `results`).

### `start_grading_worker()`
```python
@app.on_event("startup")
async def start_grading_worker()
```
**Lifecycle hook** — runs on server startup. Creates an `asyncio.Event` as a stop signal and spawns `run_grading_worker()` as a background `asyncio.Task`. The worker polls the database for queued submissions independently of HTTP request handlers.

### `stop_grading_worker()`
```python
@app.on_event("shutdown")
async def stop_grading_worker()
```
**Lifecycle hook** — runs on server shutdown. Sets the stop event, cancels the worker task, and awaits its graceful termination.

### `health_check()`
```python
@app.get("/health")
def health_check()
```
**GET /health** — returns `{"status": "ok"}`. Used for liveness probes and quick connectivity checks.

---

## `database.py` — Database Setup

### `engine`
```python
engine = create_engine(settings.database_url, connect_args={...})
```
SQLAlchemy engine configured from `settings.database_url`. For SQLite, sets `check_same_thread=False` to allow multi-threaded access.

### `_set_sqlite_pragmas(dbapi_connection, connection_record)`
```python
@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, connection_record)
```
**SQLAlchemy event listener** — fires on every new database connection. Enables WAL journal mode and foreign key enforcement for SQLite.

### `SessionLocal`
```python
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
```
Factory for database sessions. Each call produces a new `Session` with manual commit and flush.

### `Base`
```python
class Base(DeclarativeBase)
```
Declarative base class for all ORM models. All model classes inherit from this.

### `get_db()`
```python
def get_db()
```
**FastAPI dependency generator** — yields a database session and closes it after the request completes. Used via `Depends(get_db)` in route handlers.

---

## `core/config.py` — Application Settings

### `Settings`
```python
class Settings(BaseSettings)
```
Pydantic `BaseSettings` class that reads from environment variables and a `.env` file.

| Field | Default | Purpose |
|-------|---------|---------|
| `secret_key` | `"dev-secret-change-in-production"` | JWT signing key |
| `jwt_algorithm` | `"HS256"` | JWT algorithm |
| `access_token_expire_minutes` | `60` | Token lifetime in minutes |
| `database_url` | `"sqlite:///./data/exam_system.db"` | SQLAlchemy connection string |
| `piston_base_url` | `"http://127.0.0.1:2000"` | Piston API base URL |
| `piston_request_timeout_seconds` | `20.0` | HTTP timeout for Piston calls |
| `piston_compile_timeout_ms` | `10000` | Max compile time sent to Piston |
| `piston_run_timeout_ms` | `3000` | Max run time sent to Piston |
| `piston_compile_memory_limit_bytes` | `536870912` (512 MiB) | Compile memory limit |
| `piston_run_memory_limit_bytes` | `268435456` (256 MiB) | Runtime memory limit |
| `socket_server_host` | `"127.0.0.1"` | Java Socket server host (Phase 5) |
| `socket_server_port` | `9000` | Java Socket server port (Phase 5) |
| `cors_origins` | `"http://localhost:3000"` | Allowed CORS origins (comma-separated) |

### `settings`
```python
settings = Settings()
```
Singleton settings instance used throughout the application.

---

## `core/security.py` — Authentication Utilities

### `pwd_context`
```python
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
```
Passlib `CryptContext` configured for bcrypt hashing.

### `hash_password(password: str) -> str`
Hashes a plaintext password using bcrypt. Returns the hash string.

### `verify_password(plain_password: str, hashed_password: str) -> bool`
Verifies a plaintext password against a bcrypt hash. Returns `True` if they match.

### `create_access_token(data: dict) -> str`
Creates a JWT access token. Adds an `exp` claim based on `access_token_expire_minutes`. Encodes with the configured secret key and algorithm.

### `decode_access_token(token: str) -> dict | None`
Decodes and validates a JWT token. Returns the payload dict on success, `None` if the token is expired or invalid.

---

## `api/auth.py` — Authentication Endpoints

**Router prefix:** `/auth`

### `register(data: UserCreate, db: Session) -> UserResponse`
**POST /auth/register** — creates a new user account. Checks for duplicate usernames (returns 400 if taken), hashes the password, and persists the user. Returns 201 on success.

### `login(data: UserLogin, db: Session) -> TokenResponse`
**POST /auth/login** — authenticates a user by username and password. Returns a JWT access token on success, 401 on invalid credentials.

### `me(current_user: User) -> UserResponse`
**GET /auth/me** — returns the currently authenticated user's profile. Requires a valid Bearer token.

---

## `api/exams.py` — Exam CRUD Endpoints

**Router prefix:** `/exams`

### `_get_exam_or_404(db: Session, exam_id: int) -> Exam`
**Internal helper** — fetches an exam by ID or raises 404. Used by multiple route handlers to avoid repetition.

### `create_exam(data: ExamCreate, current_user, db) -> ExamResponse`
**POST /exams** — creates a new exam. Only teachers can call this. The exam starts in `draft` status. Returns 201.

### `list_exams(current_user, db) -> list[ExamResponse]`
**GET /exams** — lists exams. Teachers see only their own exams; students see only `published` and `started` exams.

### `get_exam(exam_id, current_user, db) -> ExamResponse`
**GET /exams/{exam_id}** — returns a single exam by ID. Accessible to any authenticated user.

### `update_exam(exam_id, data, current_user, db) -> ExamResponse`
**PUT /exams/{exam_id}** — updates an exam's fields. Only the owning teacher can update. Uses `exclude_unset=True` so only provided fields are changed. This is how exams are published/started/ended (by setting `status`).

### `delete_exam(exam_id, current_user, db)`
**DELETE /exams/{exam_id}** — deletes an exam. Only the owning teacher can delete. Returns 204 with no body. Cascades to questions and test cases.

---

## `api/questions.py` — Question CRUD Endpoints

**Router prefix:** `/questions`

### `_get_question_or_404(db: Session, question_id: int) -> Question`
**Internal helper** — fetches a question by ID or raises 404.

### `create_question(data: QuestionCreate, current_user, db) -> QuestionResponse`
**POST /questions** — creates a new question. Only teachers can call this. Accepts `exam_id`, `title`, `question_type`, `max_score`, `allowed_languages`, and optional Java class/method fields. Returns 201.

### `list_questions(exam_id, current_user, db) -> list[QuestionResponse]`
**GET /questions** — lists questions, optionally filtered by `exam_id` query parameter. Accessible to any authenticated user.

### `get_question(question_id, current_user, db) -> QuestionResponse`
**GET /questions/{question_id}** — returns a single question by ID.

### `update_question(question_id, data, current_user, db) -> QuestionResponse`
**PUT /questions/{question_id}** — updates a question's fields. Only teachers can call this.

### `delete_question(question_id, current_user, db)`
**DELETE /questions/{question_id}** — deletes a question. Only teachers can call this. Returns 204. Cascades to test cases.

---

## `api/test_cases.py` — Test Case Endpoints

**Router prefix:** `/test-cases`

### `create_test_case(data: TestCaseCreate, current_user, db) -> TestCaseResponse`
**POST /test-cases** — creates a new test case for a question. Only teachers can call this. Accepts `question_id`, `input_data`, `expected_output`, `is_hidden`, and `score_weight`. Returns 201.

### `list_test_cases(question_id, current_user, db) -> list[TestCaseResponse]`
**GET /test-cases/question/{question_id}** — lists all test cases for a given question. Accessible to any authenticated user. **Note:** hidden test case data (`input_data`, `expected_output`) is returned here — the results endpoint handles sanitization separately.

### `delete_test_case(test_case_id, current_user, db)`
**DELETE /test-cases/{test_case_id}** — deletes a test case. Only teachers can call this. Returns 204.

---

## `api/submissions.py` — Submission Endpoints

**Router prefix:** `/submissions`

### `submit_code(data: SubmissionCreate, current_user, db) -> SubmissionResponse`
**POST /submissions** — accepts a code submission from a student. Delegates validation and persistence to `submission_service.create_submission()`. Returns 201 with the submission in `queued` status. Returns 400 if validation fails (wrong role, exam not active, unsupported language, etc.).

### `get_one_submission(submission_id, current_user, db) -> SubmissionResponse`
**GET /submissions/{submission_id}** — returns a single submission. Students can only view their own; teachers can view any. Returns 404 if not found or not authorized.

### `list_all_submissions(exam_id, current_user, db) -> list[SubmissionResponse]`
**GET /submissions** — lists submissions, optionally filtered by `exam_id`. Students see only their own; teachers see all. Results are ordered by submission time descending.

---

## `api/results.py` — Grading Results Endpoints

**Router prefix:** `/results`

### `_sanitize_test_result(tr: SubmissionTestResult, is_student: bool) -> SubmissionTestResultResponse`
**Internal helper** — returns a test result DTO. If the viewer is a student and the test case is hidden (`is_hidden=1`), the `stdout`, `stderr`, and `compile_output` fields are set to `None` to prevent leaking hidden test data.

### `get_submission_result(submission_id, current_user, db)`
**GET /results/{submission_id}** — returns a submission with all its per-test-case results. Students can only view their own submissions. Hidden test data is sanitized for students. Returns `{submission: ..., test_results: [...]}`.

### `get_exam_results(exam_id, current_user, db)`
**GET /results/exam/{exam_id}** — returns all submissions and their test results for an exam. **Teacher-only.** No sanitization is applied (teachers see everything). Returns a list of `{submission: ..., test_results: [...]}` objects.

---

## `models/user.py` — User Model

### `UserRole`
```python
class UserRole(str, enum.Enum):
    teacher = "teacher"
    student = "student"
```
Enum defining the two user roles.

### `User`
SQLAlchemy ORM model for the `users` table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | Primary key, auto-increment |
| `username` | `String(50)` | Unique, indexed |
| `hashed_password` | `String(128)` | bcrypt hash |
| `full_name` | `String(100)` | Display name |
| `role` | `Enum(UserRole)` | `teacher` or `student` |
| `is_online` | `Integer` | 0 or 1, for realtime status (Phase 5) |
| `created_at` | `DateTime` | Server default `now()` |

---

## `models/exam.py` — Exam Model

### `ExamStatus`
```python
class ExamStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    started = "started"
    ended = "ended"
```
Enum representing the exam lifecycle.

### `Exam`
SQLAlchemy ORM model for the `exams` table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | Primary key |
| `title` | `String(200)` | Required |
| `description` | `String(1000)` | Default `""` |
| `status` | `Enum(ExamStatus)` | Default `draft` |
| `teacher_id` | `Integer` | FK → `users.id` |
| `start_time` | `DateTime` | Nullable |
| `end_time` | `DateTime` | Nullable |
| `duration_minutes` | `Integer` | Nullable |
| `created_at` | `DateTime` | Server default `now()` |

**Relationships:**
- `teacher` → `User`
- `questions` → `list[Question]` (cascade delete)

---

## `models/question.py` — Question Model

### `QuestionType`
```python
class QuestionType(str, enum.Enum):
    stdio = "stdio"
    java_class = "java_class"
```
Enum for the two grading strategies.

### `Question`
SQLAlchemy ORM model for the `questions` table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | Primary key |
| `exam_id` | `Integer` | FK → `exams.id` (CASCADE delete) |
| `title` | `String(200)` | Required |
| `description` | `Text` | Default `""` |
| `question_type` | `Enum(QuestionType)` | Default `stdio` |
| `max_score` | `Float` | Default `100.0` |
| `allowed_languages` | `String(200)` | Comma-separated, default `"java"` |
| `class_name` | `String(100)` | For Java class/method questions (Phase 6) |
| `method_signature` | `String(500)` | For Java class/method questions (Phase 6) |
| `created_at` | `DateTime` | Server default `now()` |

**Relationships:**
- `exam` → `Exam`
- `test_cases` → `list[TestCase]` (cascade delete)

---

## `models/test_case.py` — Test Case Model

### `TestCase`
SQLAlchemy ORM model for the `test_cases` table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | Primary key |
| `question_id` | `Integer` | FK → `questions.id` (CASCADE delete) |
| `input_data` | `Text` | Stdin input for the program |
| `expected_output` | `Text` | Expected stdout |
| `is_hidden` | `Integer` | 0 = visible sample, 1 = hidden |
| `score_weight` | `Float` | Relative weight, default `1.0` |
| `created_at` | `DateTime` | Server default `now()` |

**Relationships:**
- `question` → `Question`

---

## `models/submission.py` — Submission & Results Models

### `SubmissionStatus`
```python
class SubmissionStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    error = "error"
```
Enum for the submission grading lifecycle.

### `Submission`
SQLAlchemy ORM model for the `submissions` table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | Primary key |
| `student_id` | `Integer` | FK → `users.id` |
| `question_id` | `Integer` | FK → `questions.id` |
| `language` | `String(20)` | e.g. `"java"` |
| `source_code` | `Text` | Full submitted source |
| `status` | `Enum(SubmissionStatus)` | Default `queued` |
| `score` | `Float` | Nullable, set after grading |
| `max_score` | `Float` | Copied from question at submission time |
| `error_summary` | `Text` | Human-readable error if grading fails |
| `submitted_at` | `DateTime` | Server default `now()` |
| `graded_at` | `DateTime` | Set when grading completes |

**Relationships:**
- `student` → `User`
- `question` → `Question`
- `test_results` → `list[SubmissionTestResult]` (cascade delete)

### `SubmissionTestResult`
SQLAlchemy ORM model for the `submission_test_results` table. One row per test case per submission.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | Primary key |
| `submission_id` | `Integer` | FK → `submissions.id` (CASCADE delete) |
| `test_case_id` | `Integer` | FK → `test_cases.id` |
| `passed` | `Integer` | 1 = passed, 0 = failed |
| `stdout` | `Text` | Captured stdout |
| `stderr` | `Text` | Captured stderr |
| `compile_output` | `Text` | Compiler messages |
| `exit_code` | `Integer` | Process exit code |
| `time` | `Float` | Execution time (reserved) |
| `memory` | `Float` | Memory used (reserved) |

**Relationships:**
- `submission` → `Submission`
- `test_case` → `TestCase`

---

## `schemas/user.py` — User Pydantic Schemas

### `UserCreate`
Request body for `POST /auth/register`. Validates `username` (3–50 chars), `password` (4–100 chars), `full_name` (1–100 chars), and `role`.

### `UserLogin`
Request body for `POST /auth/login`. Accepts `username` and `password`.

### `UserResponse`
Response model for user data. Includes `id`, `username`, `full_name`, `role`, `is_online`, and `created_at`. Configured with `from_attributes=True` for ORM compatibility.

---

## `schemas/token.py` — Token Pydantic Schemas

### `TokenResponse`
Response for `POST /auth/login`. Contains `access_token` (JWT string) and `token_type` (always `"bearer"`).

### `TokenData`
Internal model for decoded JWT payload. Contains `user_id`, `username`, and `role`.

---

## `schemas/exam.py` — Exam Pydantic Schemas

### `ExamCreate`
Request body for `POST /exams`. Accepts `title` (1–200 chars), `description` (max 1000), optional `start_time`, `end_time`, and `duration_minutes`.

### `ExamUpdate`
Request body for `PUT /exams/{exam_id}`. All fields are optional; only provided fields are applied. Includes `status` for transitioning the exam lifecycle.

### `ExamResponse`
Response model for exam data. Includes all exam fields plus `teacher_id` and `created_at`.

---

## `schemas/question.py` — Question Pydantic Schemas

### `QuestionCreate`
Request body for `POST /questions`. Accepts `exam_id`, `title`, `description`, `question_type` (default `stdio`), `max_score` (default 100, must be > 0), `allowed_languages` (default `"java"`), and optional `class_name`/`method_signature` for Java class questions.

### `QuestionUpdate`
Request body for `PUT /questions/{question_id}`. All fields optional.

### `QuestionResponse`
Response model for question data. Includes all fields plus `id` and `created_at`.

---

## `schemas/test_case.py` — Test Case Pydantic Schemas

### `TestCaseCreate`
Request body for `POST /test-cases`. Accepts `question_id`, `input_data`, `expected_output`, `is_hidden` (0 or 1), and `score_weight` (must be > 0, default 1.0).

### `TestCaseResponse`
Response model for test case data. Includes all fields plus `id` and `created_at`.

---

## `schemas/submission.py` — Submission Pydantic Schemas

### `SubmissionCreate`
Request body for `POST /submissions`. Accepts `question_id`, `language` (1–20 chars), and `source_code` (non-empty).

### `SubmissionResponse`
Response model for submission data. Includes all submission fields: `id`, `student_id`, `question_id`, `language`, `source_code`, `status`, `score`, `max_score`, `error_summary`, `submitted_at`, and `graded_at`.

### `SubmissionTestResultResponse`
Response model for per-test-case results. Includes `id`, `submission_id`, `test_case_id`, `passed`, `stdout`, `stderr`, `compile_output`, `exit_code`, `time`, and `memory`.

---

## `services/auth.py` — Authentication Service

### `get_user_by_username(db: Session, username: str) -> User | None`
Queries the `users` table by username. Returns the `User` or `None`.

### `authenticate_user(db: Session, username: str, password: str) -> User | None`
Looks up a user by username, then verifies the password against the stored hash. Returns the `User` on success, `None` on failure.

---

## `services/dependencies.py` — FastAPI Dependencies

### `security`
```python
security = HTTPBearer()
```
FastAPI security scheme that extracts the Bearer token from the `Authorization` header.

### `get_current_user(credentials, db) -> User`
**FastAPI dependency** — decodes the JWT from the `Authorization: Bearer <token>` header, extracts the `user_id`, and loads the `User` from the database. Returns the user or raises 401 if the token is invalid/expired or the user doesn't exist.

### `require_role(role: UserRole)`
**Dependency factory** — returns a dependency that checks the current user's role. If the role doesn't match, raises 403. Usage: `Depends(require_role(UserRole.teacher))`.

---

## `services/submission_service.py` — Submission Business Logic

### `SubmissionValidationError`
```python
class SubmissionValidationError(ValueError)
```
Custom exception raised when a submission fails business-rule validation. Caught by the API layer and converted to HTTP 400.

### `validate_submission(db, student, question_id, language) -> Question`
Validates that a student is allowed to submit to a question. Checks:
1. The user's role is `student`
2. The question exists
3. The question's exam exists
4. The exam status is `started`
5. The current time is within the exam's `start_time`–`end_time` window (if set)
6. The submitted language is in the question's `allowed_languages` list

Returns the validated `Question` on success, raises `SubmissionValidationError` otherwise.

### `create_submission(db, student, question_id, language, source_code) -> Submission`
Calls `validate_submission()`, then creates and persists a new `Submission` with status `queued`. The `max_score` is copied from the question at submission time. Returns the persisted submission.

### `get_submission(db, submission_id, current_user) -> Submission | None`
Fetches a submission by ID. Enforces that students can only retrieve their own submissions (returns `None` for unauthorized access, which the API layer converts to 404).

### `list_submissions(db, current_user, exam_id) -> list[Submission]`
Lists submissions. Students see only their own; teachers see all. Optionally filtered by `exam_id` (joins through `Question`). Results are ordered by `submitted_at` descending.

---

## `services/grading_service.py` — Grading Orchestration

### `grade_submission(submission_id: int) -> None`
**Main entry point for grading.** Called by the worker. Opens its own database session (never shares with HTTP handlers). Flow:
1. Loads the submission — skips if not found or not in `running` status
2. Loads the question — marks as error if not found
3. Loads all test cases for the question — marks as error if none exist
4. Routes to `_grade_stdio()` for stdin/stdout questions, or marks as error for unimplemented `java_class` type
5. On `PistonClientError`: marks submission as `error` with the Piston error message
6. On any other exception: logs the traceback and marks as `error`

### `_grade_stdio(db, submission, question, test_cases) -> None`
**Internal** — grades a stdin/stdout question. For each test case:
1. Sends the source code + test case input to Piston via `PistonClient.execute()`
2. If compilation fails (`compile.code != 0`), marks this and all remaining test cases as failed with the compile error
3. If execution succeeds, compares `run.stdout` (trimmed) with `expected_output` (trimmed) for an exact match
4. Creates a `SubmissionTestResult` row for each test case

After all test cases are processed, calculates the weighted score:
```
score = (sum of passed weights / total weight) × question.max_score
```
Sets the submission to `completed` with the calculated score and `graded_at` timestamp.

### `_create_test_result(db, submission, test_case, *, passed, stdout, stderr, compile_output, exit_code) -> None`
**Internal** — creates and persists a single `SubmissionTestResult` row.

### `_fail_submission(db, submission, message) -> None`
**Internal** — marks a submission as `error` and stores the error message in `error_summary`. Rolls back on failure to persist.

---

## `services/piston_client.py` — Piston API Client

### `PistonClientError`
```python
class PistonClientError(RuntimeError)
```
Custom exception for all Piston-related failures (connection errors, HTTP errors, invalid responses).

### `PistonRuntime`
Pydantic model for a Piston runtime entry: `language`, `version`, `aliases`, `runtime`.

### `PistonFile`
Pydantic model for a source file sent to Piston. `name` is validated to reject path separators (`/`, `\`) and reserved names (`.`, `..`). `encoding` defaults to `"utf8"`.

### `PistonStageResult`
Pydantic model for a single stage result (compile or run): `stdout`, `stderr`, `output`, `code`, `signal`.

### `PistonExecutionResult`
Pydantic model for a full Piston execution response: `language`, `version`, `run` (required), `compile` (optional).

### `PistonClient`
Async HTTP client for the Piston API v2. Uses `httpx.AsyncClient` internally.

#### `__init__(base_url, timeout_seconds, transport)`
Creates the underlying `httpx.AsyncClient`. Defaults to `settings.piston_base_url` and `settings.piston_request_timeout_seconds`. Accepts a custom `transport` for testing.

#### `__aenter__() / __aexit__() / close()`
Async context manager support. `close()` shuts down the HTTP client.

#### `get_runtimes() -> list[PistonRuntime]`
**GET /api/v2/runtimes** — fetches the list of installed language runtimes from Piston. Validates the response as a list of `PistonRuntime` objects.

#### `execute(*, language, files, stdin, args, version) -> PistonExecutionResult`
**POST /api/v2/execute** — executes code through Piston. Flow:
1. Validates and serializes source files
2. Calls `get_runtimes()` to find a matching runtime (by language name/alias and optional version)
3. Builds the execution payload with compile/run timeout and memory limits from settings
4. Sends the request and validates the response as `PistonExecutionResult`

#### `_get_json(path) -> object`
**Internal** — sends a GET request and decodes the JSON response. Wraps all errors as `PistonClientError`.

#### `_post_json(path, payload) -> object`
**Internal** — sends a POST request with a JSON body and decodes the response.

#### `_decode_response(response) -> object`
**Internal (static)** — checks the HTTP status code (raises on 4xx/5xx), then parses the response body as JSON. All errors are wrapped as `PistonClientError`.

---

## `workers/grading_worker.py` — Background Grading Worker

### `POLL_INTERVAL_SECONDS`
```python
POLL_INTERVAL_SECONDS = 2
```
How often the worker checks for new queued submissions when idle.

### `run_grading_worker(stop_event: asyncio.Event) -> None`
**Main worker loop.** Runs as an `asyncio.Task` started by the FastAPI startup hook.
1. Calls `_recover_stuck_submissions()` on startup to reset any `running` submissions left from a crash
2. Loops until `stop_event` is set:
   - Calls `_claim_next_submission()` to atomically claim the oldest `queued` submission
   - If a submission is claimed, calls `grade_submission()` to grade it
   - If no submissions are queued, waits for `POLL_INTERVAL_SECONDS` (or until the stop event fires)

### `_recover_stuck_submissions() -> None`
**Internal** — queries for all submissions with status `running` and resets them to `queued` with `error_summary = "Recovered after server restart"`. This ensures no submission is lost if the server crashes mid-grading.

### `_claim_next_submission() -> int | None`
**Internal** — atomically claims the oldest `queued` submission using `with_for_update()` (row-level lock in SQLite/WAL mode). Sets its status to `running` and returns its ID. Returns `None` if no queued submissions exist.