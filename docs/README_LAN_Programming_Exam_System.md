# LAN Programming Exam and Auto-Grading System

## 1. Project Overview

Build a local-network (LAN) programming exam system that runs on a teacher's Windows PC. Students connect to the teacher's machine through a web browser on the same LAN. The system must be able to operate during an exam without requiring Internet access, once all required services, images, dependencies, and runtime environments have been prepared.

The system provides:
- Teacher and student accounts with role-based access.
- Exam and question management.
- Code submission through a browser.
- Automated code execution and grading using a self-hosted Piston instance.
- Persistent exam, submission, and result records in SQLite.
- Real-time notifications and connection status using Socket Programming.
- Java class/method grading with a Java test harness and Reflection.

This README is the implementation guide for the coding agent. Treat the architecture and constraints below as project requirements unless the project owner explicitly changes them.

## 2. Core Requirements

### Functional requirements

1. Teachers can create, edit, publish, start, and end exams.
2. Teachers can create programming questions and configure supported languages and test cases.
3. Students can log in, view available exams, open questions, and submit source code.
4. The backend validates exam status, deadlines, student eligibility, and allowed languages before accepting submissions.
5. Accepted submissions are persisted before grading begins.
6. A background worker sends submissions to Piston and collects execution results.
7. The system calculates scores, stores results, and displays them to students and teachers according to permissions.
8. Real-time events inform students about exam announcements and submission/grading status.
9. The system tracks connected students as online/offline on a best-effort basis.
10. The application should be testable on a LAN with Internet access disconnected after setup.

### Non-functional requirements

- Keep the design understandable and maintainable for a student project.
- Do not execute untrusted student code directly on the Windows host.
- Keep hidden test cases and expected results on the server side.
- Apply execution time, memory, output, and process limits through Piston.
- Handle multiple submissions without blocking HTTP request handlers.
- Persist submissions before queuing work so a server restart does not silently lose accepted submissions.
- Validate all requests on the backend; never trust frontend state for authorization or exam timing.
- Document setup, startup, shutdown, LAN access, and offline verification.

## 3. Recommended Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | Next.js, TypeScript, Tailwind CSS | Teacher and student web interfaces |
| Main backend | Python, FastAPI | API, authentication, validation, exam logic |
| Database | SQLite, SQLAlchemy | Users, exams, questions, submissions, results |
| Code execution | Self-hosted Piston | Compile and execute submitted code in an isolated runner |
| Grading worker | Python background worker and durable database-backed job state | Process queued submissions and recover pending work |
| Java method grader | Java, Reflection, test harness | Validate required class/method structure and invoke methods for test cases |
| Realtime transport | Java TCP Socket server if Java Socket Programming must be demonstrated; browser bridge through FastAPI WebSocket | Real-time events and connection status |
| Deployment | Docker Compose and Docker Desktop/WSL2 where supported | Run local services on the teacher's PC |

### Important Socket Programming requirement

The course requires Socket Programming. Make it a real feature, not an unused demonstration.

Preferred design if the course specifically requires **Java Socket Programming**:
- Implement a separate Java TCP server using `ServerSocket` and `Socket`.
- Use it to manage persistent TCP client connections, parse messages, and broadcast or route real-time events.
- Create clear classes such as `RealtimeServer`, `ClientHandler`, `Message`, and `ClientRegistry`.
- The browser cannot directly use Java's `Socket` API. Use FastAPI WebSocket as a browser-facing bridge, and define a secure internal protocol between FastAPI and the Java TCP service.
- Keep the Java TCP server bound to the local interface/network required for the deployment, and do not expose an unauthenticated control port to untrusted networks.
- Define message framing. For example, use one JSON message per line, with a maximum message size and UTF-8 encoding. Do not assume one TCP read equals one complete message.
- Authenticate clients or service-to-service connections. Validate message type, payload, sender, and destination.
- Handle disconnects, exceptions, duplicate connections, and stale online-status entries.
- Do not rely on Socket events as the authoritative source of exam state. FastAPI and the database remain authoritative.

If the lecturer only requires Socket Programming in general and does not require Java, a Python TCP socket server is also possible. Confirm the course requirement before choosing the implementation. Do not add both Java and Python TCP servers without a clear reason.

Use WebSocket only for communication with browser clients if appropriate. WebSocket and raw TCP sockets are different protocols; explain their roles clearly in project documentation.

## 4. High-Level Architecture

```text
Student / Teacher Browser
        |
        | HTTP/HTTPS API + WebSocket
        v
Next.js Frontend <------> FastAPI Backend
                             |
              +--------------+----------------+
              |              |                |
              v              v                v
           SQLite       Grading Queue     Realtime Bridge
              |              |                |
              |              v                v
              |          Python Worker   Java TCP Socket Server
              |              |                |
              |              v                |
              |             Piston            |
              |              |                |
              +<-------------+----------------+
                         Results
```

The exact realtime topology may be refined during implementation, but the responsibilities must remain separated:
- HTTP APIs handle ordinary requests and commands.
- Socket/WebSocket communication handles notifications and connection events.
- SQLite stores durable application state.
- The worker handles long-running grading tasks.
- Piston executes code in its configured isolated runner.

## 5. Main User Flows

### Student submission and grading

1. Student logs in.
2. Student opens an active exam.
3. Frontend loads questions and allowed languages from FastAPI.
4. Student submits source code.
5. FastAPI checks identity, exam status, deadline, question, language, and submission limits.
6. FastAPI saves the submission and its initial status in SQLite.
7. A grading job becomes available to the worker.
8. The worker prepares a Piston request and sends the code for execution.
9. The worker collects compile/runtime/output results.
10. The grading service calculates the score and persists the detailed result.
11. A realtime event notifies the student that the submission status changed.
12. The frontend fetches authorized result data from the API.

### Teacher announcement

1. Teacher writes an announcement in the teacher interface.
2. FastAPI verifies the teacher's role and stores the announcement or associated audit event if needed.
3. FastAPI sends an internal event to the realtime service.
4. The Socket server routes/broadcasts the event to the intended connected students.
5. FastAPI WebSocket forwards it to browser clients.
6. The frontend displays the announcement.

### Exam end

The backend updates the exam status and enforces the deadline. A realtime event tells browsers to update their interfaces, but the backend must reject late submissions even if a browser is stale or modified.

## 6. Project Structure

Use this as a starting structure; adjust only when implementation needs justify it.

```text
programming-exam-system/
├── frontend/
│   ├── app/
│   │   ├── login/
│   │   ├── student/
│   │   │   ├── exams/
│   │   │   ├── questions/
│   │   │   └── submissions/
│   │   └── teacher/
│   │       ├── exams/
│   │       ├── questions/
│   │       ├── submissions/
│   │       └── results/
│   ├── components/
│   ├── lib/
│   ├── types/
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py
│   │   │   └── security.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── exams.py
│   │   │   ├── questions.py
│   │   │   ├── test_cases.py
│   │   │   ├── submissions.py          (Phase 3)
│   │   │   └── results.py              (Phase 3)
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── user.py
│   │   │   ├── exam.py
│   │   │   ├── question.py
│   │   │   ├── test_case.py
│   │   │   └── submission.py
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   ├── user.py
│   │   │   ├── token.py
│   │   │   ├── exam.py
│   │   │   ├── question.py
│   │   │   ├── test_case.py
│   │   │   └── submission.py
│   │   ├── repositories/               (Phase 3)
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── dependencies.py
│   │   │   ├── exam_service.py         (Phase 3)
│   │   │   ├── submission_service.py   (Phase 3)
│   │   │   ├── grading_service.py      (Phase 3)
│   │   │   ├── piston_client.py
│   │   │   └── java_method_grader.py   (Phase 6)
│   │   ├── realtime/
│   │   │   └── websocket.py            (Phase 5)
│   │   ├── workers/
│   │   │   └── grading_worker.py       (Phase 3)
│   │   └── database.py
│   ├── data/                            (SQLite DB — gitignored)
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── conftest.py
│   │   ├── test_api.py
│   │   └── test_piston_client.py
│   └── requirements.txt
├── java-socket-server/
│   ├── pom.xml
│   ├── README.md
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/exam/realtime/
│   │   │   │   ├── RealtimeServer.java
│   │   │   │   ├── ClientHandler.java
│   │   │   │   ├── ClientRegistry.java
│   │   │   │   ├── Message.java
│   │   │   │   ├── Config.java
│   │   │   │   └── DatabaseConnection.java
│   │   │   └── resources/
│   │   │       └── server.properties
│   │   └── test/java/com/exam/realtime/
│   │       ├── DatabaseConnectionTest.java
│   │       ├── MessageTest.java
│   │       └── ClientRegistryTest.java
│   └── target/                          (build output — gitignored)
├── java-grader/                         (Phase 6)
│   ├── src/main/java/
│   │   └── ReflectionTestRunner.java
│   ├── examples/
│   └── README.md
├── deploy/
│   ├── piston/
│   │   ├── docker-compose.yml
│   │   ├── phase1_java_test.py
│   │   └── data/piston/packages/          (installed runtimes — gitignored)
│   └── scripts/
├── .env.example
├── .gitignore
└── README.md
```

Do not commit passwords, API secrets, real student data, database files containing exam data, or generated submission contents.

## 7. Database Design

Use SQLAlchemy models and migrations or a documented schema initialization strategy. Recommended entities:

### `users`
- `id`
- `username` or student/teacher identifier
- `password_hash`
- `role` (`TEACHER` or `STUDENT`)
- `display_name`
- `created_at`
- `is_active`

### `exams`
- `id`
- `title`
- `description`
- `start_at`
- `end_at`
- `status` (`DRAFT`, `PUBLISHED`, `ACTIVE`, `ENDED`)
- `created_by`
- `created_at`

### `questions`
- `id`
- `title`
- `description`
- `points`
- `question_type` (`STDIN_STDOUT` or `JAVA_CLASS_METHOD`)
- `time_limit`
- `memory_limit`
- `class_name` (optional)
- `method_name` (optional)
- `method_mode` (optional: `STATIC` or `INSTANCE`)
- `return_type` (optional)
- `parameter_types` (optional structured data)

### `exam_questions`
- `exam_id`
- `question_id`
- `display_order`
- Optional per-exam points or settings if the design needs them

### `question_languages`
- `question_id`
- `language_id` or language identifier
- `is_allowed`

### `test_cases`
- `id`
- `question_id`
- `is_sample`
- `weight`
- `stdin` (for stdin/stdout questions)
- `expected_stdout` (for stdin/stdout questions)
- Structured argument values and expected return value for Java method questions
- Never return hidden test data to the student-facing API.

### `exam_participants`
- `exam_id`
- `student_id`
- `joined_at`
- Optional eligibility or attempt settings

### `submissions`
- `id`
- `exam_id`
- `question_id`
- `student_id`
- `language_id`
- `source_code` or a protected source reference
- `status` (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`)
- `submitted_at`
- `graded_at`
- `score`
- `max_score`
- `error_summary`

### `submission_results`
- `id`
- `submission_id`
- `test_case_id` (avoid exposing hidden test identifiers unnecessarily)
- `status`
- `execution_time`
- `memory_used`
- `stdout` and `stderr` subject to safe size limits
- `points_awarded`
- Internal details needed for audit/debugging

Optional tables may include `announcements`, `audit_logs`, and `grading_jobs`. Avoid overengineering the schema before the MVP works.

## 8. Java Class/Method Grading with Reflection

The system needs to support at least two question types:

### Type A: Standard input/output
The student writes a program that reads input and prints output. The grader runs it against test cases and compares normalized output according to a documented policy.

### Type B: Java class/method
The question specifies a required class and method. For example, a question may require a `Calculator` class with an `add(int, int)` method.

The Java grading flow:
1. Keep the required class name, method name, parameter types, return type, and invocation mode in server-side question configuration.
2. Build a test harness that loads/compiles the student's submission and checks the class/method using Java Reflection.
3. Verify that the method signature is compatible with the question.
4. Invoke the method with server-defined test arguments.
5. Compare returned values with expected results.
6. Produce a structured grading result for the Python backend.

Teachers can provide optional starter code per question. For Java class/method questions, the starter code should contain the required class and method, not a `main` method: the backend generates a separate `Main.java` runner from the question contract and test-case arguments. Students receive the question's boilerplate on first open and when they reset their editor. If the teacher leaves it blank, the editor starts blank; changes to the boilerplate do not overwrite code a student has already entered.

Current implementation details:
- Reflection is not a security sandbox. Student code must still run inside Piston or another appropriately isolated environment.
- Do not expose hidden expected values or hidden tests in files or source code accessible to students.
- The required class must be in the default package, and instance methods need an accessible no-argument constructor.
- Supported parameter and return types are Java primitives, their boxed wrappers, and `String`.
- Method arguments are comma-separated; quote string values containing commas.
- Reflection resolves the configured method by exact name and parameter types. Overloaded methods are selected by that signature.
- Do not assume that a hidden test remains secret if it is embedded in a file visible to the submitted program or student. Treat all student-executable test data as potentially observable.

## 9. Realtime Message Protocol

Document the protocol shared by FastAPI, the Java Socket server, and the browser-facing WebSocket bridge.

A message should have a predictable envelope, for example:

```json
{
  "type": "submission.status",
  "request_id": "unique-id",
  "sender": "backend",
  "recipient": "student:123",
  "timestamp": "ISO-8601 timestamp",
  "payload": {
    "submission_id": 456,
    "status": "RUNNING"
  }
}
```

This is an example schema, not a fixed final contract. Define and validate the actual schema before implementing both ends.

Suggested event types:
- `client.hello`
- `client.heartbeat`
- `client.status`
- `exam.started`
- `exam.ended`
- `exam.announcement`
- `submission.received`
- `submission.status`
- `submission.completed`
- `server.error`

Protocol rules:
- Specify whether messages are newline-delimited JSON or use length-prefixed framing.
- Enforce maximum message sizes.
- Use UTF-8 consistently.
- Validate every event and payload.
- Use server-side authorization to decide which clients can receive each event.
- Do not broadcast student source code, hidden tests, credentials, or private result data.
- Make reconnection and heartbeat behavior explicit.
- Treat online status as approximate; a disconnected browser may take time to be detected.
- Do not let clients set authoritative exam status, grades, roles, or another user's identity.

## 10. Piston and Offline Operation

Piston is the selected local code-execution service. The project uses the Piston v2 API at `http://127.0.0.1:2000`; keep it bound to localhost and do not expose its privileged execution API directly to the LAN or Internet.

Deployment on the teacher's Windows PC:

1. Install and start Docker Desktop with its WSL2 Linux engine.
2. While Internet access is available, pull and start the Piston image:
   `docker compose -f deploy/piston/docker-compose.yml up -d`
3. Install the required language runtimes using Piston's package manager. Java 15.0.2 has been installed and verified with the project smoke test.
4. Verify installed runtimes with `GET /api/v2/runtimes` and run `deploy/piston/phase1_java_test.py`.
5. Test the complete application while disconnected from the Internet after all container images and runtime packages are present.

To install Java on Windows with Git, Node.js, and npm available:

```powershell
$pistonCli = Join-Path $env:TEMP "piston-cli"
git clone --depth 1 https://github.com/engineer-man/piston.git $pistonCli
Push-Location (Join-Path $pistonCli "cli")
npm install
Pop-Location
node (Join-Path $pistonCli "cli\index.js") -u http://127.0.0.1:2000 ppman install java
```

Run the verified Java smoke test from the repository root:

```powershell
python deploy\piston\phase1_java_test.py
```

Piston's image and language runtimes are separate downloads. The runtime directory `deploy/piston/data/piston/packages/` is persisted and gitignored; retain it for offline use. Other supported languages must be installed and tested explicitly before the exam.

The Compose configuration disables networking for jobs and sets process, output, compile/run timeout, and memory limits. Review the limits against the course workload and machine resources before deployment. Piston requires a privileged container; keep its API on localhost and accept student code only through the authenticated application backend.

Official references:
- Piston project and self-hosting: https://github.com/engineer-man/piston
- Piston API v2: https://github.com/engineer-man/piston/blob/master/docs/api-v2.md
- Piston configuration: https://github.com/engineer-man/piston/blob/master/docs/configuration.md
- Docker Desktop WSL 2: https://docs.docker.com/desktop/features/wsl/
- Docker Desktop installation on Windows: https://docs.docker.com/desktop/setup/install/windows-install/

## 11. Security and Reliability

- Hash passwords using a suitable password-hashing algorithm; never store plaintext passwords.
- Enforce role-based authorization in FastAPI.
- Validate exam windows and submission permissions on the server.
- Apply request size limits and safe error responses.
- Store uploads and source files safely; do not trust filenames or file extensions.
- Never run untrusted submissions directly on the Windows host.
- Configure and verify Piston's isolation and resource limits; a sandbox reduces risk but is not a guarantee of complete security.
- Keep Piston bound to localhost; its container is privileged and its execution API must not be exposed to student devices.
- Keep hidden test cases and expected outputs server-side as far as the execution model permits.
- Limit stdout/stderr capture and stored logs to avoid resource exhaustion.
- Use a durable job state in the database. On startup, recover eligible `QUEUED` jobs and handle jobs left in `RUNNING` according to a documented retry policy.
- Make grading retries idempotent so the same submission is not accidentally awarded duplicate points.
- Handle duplicate submissions, client disconnects, timeouts, Piston failures, and service restarts.
- Add audit logs for important teacher actions if time permits.
- Restrict internal Socket service access and authenticate service-to-service messages.
- Keep secrets and configuration in environment variables or local configuration files excluded from version control.

## 12. Implementation Plan

Build incrementally. Do not attempt all advanced features at once. The status below reflects the implementation and verification completed so far; it distinguishes implemented work from final deployment acceptance.

### Phase 1 — Environment validation
- **Status: Implemented; offline verification remains.**
- Piston is configured locally, Java is installed, and Java execution has been smoke-tested through Piston.
- Resource limits and the Java method-grader runtime requirements have been configured and exercised.
- Still to verify: the complete application works with Internet disconnected after all images and runtimes have been prepared.

### Phase 2 — Backend foundation
- **Status: Implemented.**
- FastAPI, SQLite/SQLAlchemy persistence, authentication, role checks, exam/question/test-case APIs, and request validation are present.
- Backend tests cover the principal API and lifecycle behavior.

### Phase 3 — Basic submission and grading
- **Status: Implemented.**
- Submissions are validated and persisted before a database-backed worker grades them through Piston.
- Standard input/output and result persistence/scoring are implemented, including recovery handling for queued or interrupted work.
- Java standard-I/O execution has been exercised against the configured Piston service.

### Phase 4 — Frontend completion
- **Status: Implemented; continue validating UX as features evolve.**
- Teacher exam/question management and result views, and student exam/submission/result flows, are present.
- Loading, submission state, and error handling are implemented; production builds have been verified.

### Phase 5 — Socket Programming
- **Status: Implemented; service authentication/configuration needs verification in the current environment.**
- The Java TCP server uses framed JSON messages, authenticated service/user sessions, validation, routing, and connection lifecycle handling.
- FastAPI provides the browser WebSocket endpoint and an optional authenticated TCP bridge to Java.
- Exam and submission realtime events, presence, announcements, and protocol tests are implemented.
- **Current operational issue:** FastAPI bridge logs `Java realtime connection unavailable: ConnectionError` and Java logs rejected authentication. Verify that both processes use the same non-empty `SOCKET_SERVER_SHARED_SECRET` and matching host/port, then restart both services.
- Still to verify in the deployment environment: sustained multi-client operation and reconnect behavior across service restarts.

### Phase 6 — Java Reflection grading
- **Status: Implemented and exercised.**
- The Java reflection harness supports class/method questions, configured method contracts, test arguments, and hidden-test handling.
- Java method questions are graded through Piston. The `ArrayUtils.findSecondLargest(int[])` cases were exercised successfully, and Piston resource caps were adjusted for the harness.
- Focused grader tests and the frontend production build passed during implementation.

### Phase 7 — Deployment and final testing
- **Status: In progress.**
- Startup/deployment instructions and service configuration are documented.
- Still to complete: end-to-end testing from teacher/student devices on the LAN, offline verification, restart and queued-job recovery checks, concurrent-submission/failure testing, and final security/configuration review.

The core grading and realtime features are implemented. Prioritize resolving the current realtime bridge configuration issue and completing Phase 7 end-to-end acceptance before treating the system as deployment-ready.

## 13. Definition of Done

The MVP is complete when:
- A teacher can create and run an exam.
- A student can connect over the LAN and submit code.
- The backend rejects submissions outside the permitted exam window.
- A standard input/output Java submission is graded through Piston.
- Results are saved and visible to authorized users.
- The Socket Programming module demonstrates real two-way communication and at least one useful realtime feature.
- The system can handle multiple connected students without blocking the API.
- The application can be started and tested with Internet disconnected after preparation.
- A server restart does not silently discard persisted submissions or queued grading work.
- Setup, architecture, message protocol, known limitations, and test steps are documented.

## 14. Agent Instructions

When implementing this project:

1. Inspect the existing repository before changing files. Reuse working code where sensible; do not overwrite project files blindly.
2. Start by writing a short implementation plan and identifying environment assumptions.
3. Implement in small, testable phases. Run relevant tests after each phase.
4. Prefer straightforward code and explicit types over unnecessary abstractions.
5. Keep frontend API calls, backend business logic, database access, realtime transport, and grading execution separated.
6. Do not put all logic in a single file or execute grading inside the HTTP request handler.
7. Do not fabricate successful test results. Report commands run, results observed, and any tests not run.
8. If a required environment detail is missing, inspect available files and configuration first. Ask only when the uncertainty blocks safe or correct implementation.
9. Do not add technologies or services without a concrete requirement.
10. Keep README and configuration examples updated as implementation decisions become final.
11. Never expose secrets, hidden test cases, or private student data in frontend responses or logs.
12. Do not assume that a Socket server is integrated merely because its code exists; demonstrate a working end-to-end event from the teacher interface to a student browser.
13. If an existing `submission_server.py` or similar prototype is present, inspect it before deciding what to reuse. Migrate its useful file-listing or upload behavior into the main FastAPI application if appropriate; do not retain a second production server without a clear purpose.
14. Before declaring the project complete, provide a summary of implemented features, architecture decisions, startup instructions, test evidence, and remaining limitations.

## 15. Initial Tasks for the Agent

Begin with these tasks in order:

1. Inspect the repository and report the existing structure and working components.
2. Verify the local development environment and the availability of Docker/Piston if possible.
3. Propose a phased implementation plan based on the actual repository rather than assuming it is empty.
4. Implement the smallest end-to-end slice: login or development authentication, one exam/question, student submission, Piston execution, and persisted result.
5. Add automated tests for backend validation and grading-result handling.
6. Implement the realtime protocol and Socket feature once the main API flow is clear.
7. Add Java Reflection grading and deployment/offline checks.
8. Update documentation to match the actual implemented behavior.

Do not claim that offline execution, sandboxing, or realtime delivery is verified until it has actually been tested.
