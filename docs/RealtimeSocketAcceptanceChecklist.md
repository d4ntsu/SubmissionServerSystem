# Realtime and Socket Acceptance Checklist

This checklist evaluates the current checkout against the realtime and socket requirements in [README §3, §5, and §9](README_LAN_Programming_Exam_System.md). It describes what can be demonstrated now; a green Java test suite does not imply a live FastAPI-to-Java connection.

Status key: `[x]` implemented and covered, `[~]` partial or component-only, `[ ]` missing.

## Input/output map and sequence

The markers below show where the current realtime flow receives input and what it sends next.

| Flow | Input received at | Output produced |
|---|---|---|
| Submission HTTP | `backend/app/api/submissions.py::submit_code`: authenticated `POST /submissions` with `question_id`, `language`, and `source_code` | `SubmissionResponse` with initial `queued` state; after persistence, `submission.received` is queued for TCP |
| Worker transition | `backend/app/workers/grading_worker.py::_claim_next_submission`: queued DB row | Commits `running`, then publishes `submission.status` with `status: running` |
| Grading result | `backend/app/services/grading_service.py::grade_submission`: persisted running submission and question/test cases | Commits `completed` or `error`, then publishes `submission.completed` or sanitized `submission.error` |
| Teacher exam action | `backend/app/api/exams.py::update_exam`: authenticated `PUT /exams/{exam_id}` with requested status | Updated `ExamResponse`; after commit, `exam.started` or `exam.ended` targets `exam:{exam_id}` |
| Teacher announcement | `backend/app/api/exams.py::create_announcement`: authenticated `POST /exams/{exam_id}/announcements` with content | Persisted `AnnouncementResponse`; after commit, `announcement.created` targets `exam:{exam_id}` |
| Browser WebSocket input | `backend/app/api/realtime.py::websocket_endpoint`: `/ws/realtime?token=...`; `_receive_client_messages` accepts `client.heartbeat` | `connection.ready`, heartbeat acknowledgment, protocol errors, and authorized server events |
| FastAPI TCP output | Submission adapter or exam API calls `RealtimeBridge.send()` | Validated event is encoded as newline-delimited JSON and queued for Java; `True` means queued, not acknowledged as delivered |
| Java TCP input/output | `MessageFrameReader.readFrame()` feeds `ClientHandler`; handler authenticates and routes through `RealtimeServer` | Routed JSON-line event or protocol/authentication response over TCP |
| FastAPI TCP input | `backend/app/realtime/bridge.py::_read_message` and `_receive_loop` | Validated event goes through `RealtimeEventRouter` to `RealtimeManager.publish_bridge_event`, which checks the recipient and sends to authorized WebSocket sessions |
| Frontend client | `frontend/app/lib/realtime-client.mjs::connect`: token from the supplied auth provider; server JSON arrives via WebSocket | Sends heartbeat and dispatches received events to `subscribe()` handlers. The host Next.js app does not currently import this module. |

### Submission lifecycle sequence

```mermaid
sequenceDiagram
    autonumber
    actor Student as Student Browser
    participant API as FastAPI Submission API
    participant DB as SQLite
    participant Worker as Grading Worker and Service
    participant Bridge as Realtime Adapter and TCP Bridge
    participant Java as Java TCP Server
    participant RX as FastAPI TCP Receiver
    participant Manager as WebSocket Manager
    participant WS as Student WebSocket

    Student->>API: POST /submissions (JWT, question_id, language, source_code)
    API->>DB: Create submission queued; commit
    DB-->>API: submission_id
    API->>Bridge: submission.received
    API-->>Student: 201 SubmissionResponse queued
    Bridge->>Java: JSON line over authenticated TCP
    Java->>RX: Route event to FastAPI service
    RX->>Manager: Validate and dispatch event
    Manager->>DB: Resolve authorized submission recipient
    Manager-->>WS: submission.received

    Worker->>DB: Claim submission queued to running; commit
    Worker->>Bridge: submission.status (running)
    Bridge->>Java: JSON line over authenticated TCP
    Java->>RX: Route event to FastAPI service
    RX->>Manager: Validate and dispatch event
    Manager->>DB: Resolve authorized submission recipient
    Manager-->>WS: submission.status

    Worker->>DB: Grade and persist terminal state
    alt Grading succeeds
        Worker->>Bridge: submission.completed
        Bridge->>Java: JSON line over authenticated TCP
        Java->>RX: Route event to FastAPI service
        RX->>Manager: Validate and dispatch event
        Manager-->>WS: submission.completed
    else Grading fails
        Worker->>Bridge: submission.error (sanitized)
        Bridge->>Java: JSON line over authenticated TCP
        Java->>RX: Route event to FastAPI service
        RX->>Manager: Validate and dispatch event
        Manager-->>WS: submission.error
    end
```

### Exam and announcement sequence

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as Teacher Browser
    participant API as FastAPI Exam API
    participant DB as SQLite
    participant Bridge as Realtime Bridge
    participant Java as Java TCP Server
    participant RX as FastAPI TCP Receiver
    participant Manager as WebSocket Manager
    participant Students as Exam Participant WebSockets

    alt Start or end exam
        Teacher->>API: PUT /exams/{exam_id} (JWT, status)
        API->>DB: Authorize teacher; update exam; commit
        DB-->>API: Updated exam
        API->>Bridge: exam.started or exam.ended (exam:{exam_id})
        API-->>Teacher: Updated ExamResponse
    else Create announcement
        Teacher->>API: POST /exams/{exam_id}/announcements (JWT, content)
        API->>DB: Authorize teacher; persist announcement; commit
        DB-->>API: Persisted announcement
        API->>Bridge: announcement.created (exam:{exam_id})
        API-->>Teacher: 201 AnnouncementResponse
    end
    Bridge->>Java: JSON line over authenticated TCP
    Java->>RX: Route event to FastAPI service
    RX->>Manager: Validate event and exam recipient
    Manager->>DB: Load exam teacher and participant roster
    Manager-->>Students: Deliver to authorized connected sessions
```

## Manual and automated runs

Start FastAPI from `backend`:

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another PowerShell window, run the interactive browser-realtime check:

```powershell
cd backend
.\.venv\Scripts\python.exe manual_tests\realtime_manual_runner.py
```

Enter an existing teacher username/password and student username/password when prompted. The runner checks missing/invalid WebSocket tokens, creates and retains an exam, checks two student tabs, heartbeat, client authorization, teacher start/end, student-only routing, and online/offline state. The exam remains saved as ended so it can be inspected afterward. This older manual runner does not exercise announcements or Java TCP; use the automated acceptance script above for the live bridge flow.

Run the complete current backend and Java component suites from the repository root:

```powershell
.\scripts\run_realtime_acceptance.ps1
```

The script creates a uniquely named temporary SQLite database, runs the Python backend suite (including a test that starts FastAPI and Java as separate processes), removes that exact database and its SQLite sidecars, then runs `mvn test`. The frontend client test is separate: run `node app/lib/realtime-client.test.mjs` from `frontend`.

## Manual frontend client check

The frontend directory currently has no `package.json`, runnable Next.js application, authentication provider, or frontend test framework. The centralized client is in `frontend/app/lib/realtime-client.mjs`; it accepts a token getter from the host application's existing authentication state and does not store credentials. The procedure below applies once the host application imports and serves this module.

From an authenticated browser page, initialize the client and subscribe before connecting:

```js
import { RealtimeClient } from "<host-app import path>/realtime-client.mjs";

const realtime = new RealtimeClient({
  apiBaseUrl: "http://127.0.0.1:8000",
  getAccessToken: () => existingAuthProvider.getAccessToken(),
  onStatus: ({ state, delayMs }) => console.info("Realtime", state, delayMs ?? ""),
});

const unsubscribe = realtime.subscribe("exam.started", (event) => {
  console.info("Exam started", event.payload);
});
await realtime.connect();
```

1. Start FastAPI with the project's configured WebSocket origin and authentication settings. The browser connects only to FastAPI.
2. Sign in through the host application's existing login and open two tabs for the same student.
3. Confirm `open` status and `exam.started` delivery to both tabs after a teacher starts an exam. Try `submission.status` or `submission.completed` using another account and confirm it is not delivered.
4. Confirm the client sends heartbeats automatically. `send()` accepts only `client.heartbeat`; it returns `false` for authoritative browser events.
5. Stop FastAPI or interrupt the browser's network and watch `retrying` status progress through 1, 2, 4, 8 seconds up to the 30-second cap. Restore the connection and confirm recovery. Call `disconnect()` and confirm retries stop; call the returned unsubscribe function and confirm that event callback no longer runs.
6. Have the host application call `disconnect()` on sign-out. Also attempt a connection with an invalid/expired token and confirm it reports unauthenticated status without disrupting the page.

There is no runnable host frontend or frontend test framework in this checkout. The client has a standalone Node test (`node app/lib/realtime-client.test.mjs` from `frontend`); the browser procedure above still requires the host app to import the client and provide its authentication provider.

## Requirements checklist

| README requirement | Status | Current evidence and what remains |
|---|---|---|
| Separate Java TCP server uses `ServerSocket` and `Socket` | [x] | `java-socket-server/.../RealtimeServer.java` accepts TCP sockets; Java tests run with Maven. |
| Clear server, handler, message, and registry classes | [x] | `RealtimeServer`, `ClientHandler`, `Message`, and `ClientRegistry` exist. |
| Browser uses FastAPI WebSocket rather than Java TCP | [~] | `/ws/realtime` is implemented in `backend/app/api/realtime.py`, and `frontend/app/lib/realtime-client.mjs` centralizes browser transport. The frontend directory still has no runnable app or auth provider to integrate and verify it. |
| FastAPI TCP bridge forwards events to Java and receives routed events | [x] | `RealtimeBridge` sends and receives JSON lines; `test_realtime_java_e2e.py` runs real FastAPI and Java processes and verifies forwarding. |
| Java TCP framing uses bounded UTF-8 newline-delimited JSON | [x] | `MessageFrameReader` enforces a 64 KiB limit and handles partial/multiple frames and incomplete EOF; Java protocol tests cover framing/validation. |
| Validate envelope, supported event, recipient, timestamp, payload, and forbidden data | [x] | Java `Message`, FastAPI bridge validation, and WebSocket event validation are exercised by focused protocol tests and the live bridge acceptance test. Java-side participant authorization remains a separate gap noted above. |
| Service-to-service/TCP authentication | [x] | FastAPI authenticates to Java with a shared-secret challenge response. Java user identity is resolved from a signed JWT and the database. |
| JWT-authenticated browser WebSocket | [x] | Backend WebSocket authentication uses the existing token/user lookup; tests cover authenticated and rejected connections. |
| Multiple browser tabs and connection lifecycle | [x] | FastAPI manager tracks multiple sockets per user; acceptance tests verify both tabs receive events and one-tab disconnect does not mark the user offline. |
| Heartbeat and stale browser connection handling | [~] | FastAPI validates heartbeats and closes stale connections. The centralized frontend client sends heartbeats and reconnects with bounded exponential backoff, but it is not yet wired into a runnable frontend app. |
| Java-side duplicate connections for one user | [x] | `ClientRegistry` tracks multiple sessions per user; Java tests cover remaining online until the last session disconnects. |
| Exam start/end event follows committed database state | [x] | Teacher exam update commits before publishing; acceptance test verifies persisted state and `exam.started`/`exam.ended` delivery. |
| Exam event targeting by actual exam participants | [~] | FastAPI uses `ExamParticipant` for WebSocket targeting. Java direct user subscriptions still need to verify participant membership. |
| Persisted teacher announcement and `announcement.created` delivery | [x] | The announcement API persists before emitting; live acceptance verifies participant delivery through Java TCP. |
| Submission/grading lifecycle event integration | [~] | Submission and worker/grading transitions emit normalized events. Live E2E covers `received`, `status`, and `error`; successful `completed` is covered at service-test level. |
| Socket events never become authoritative exam state | [x] | Exam state changes through authenticated FastAPI HTTP operations and SQLite; browser WebSocket accepts only heartbeat messages. |
| Java and FastAPI use the same SQLite database path | [x] | Defaults point to `backend/data/exam_system.db` when each service is started from its documented working directory; E2E configures both to one temporary absolute path. |
| Bind Java TCP to a suitable LAN interface and protect the control port | [~] | Java binds to loopback by default and supports `SOCKET_HOST`; production still needs strong external secrets and deployment-level network protection. |
| Full offline LAN deployment verified | [ ] | The automated E2E verifies local FastAPI ↔ Java ↔ WebSocket forwarding, but does not verify a real Next.js browser deployment on an Internet-disconnected LAN. |

## What can be demonstrated now

- FastAPI authenticates a browser WebSocket with the existing user token.
- Multiple student tabs receive teacher start/end events after exam state is saved.
- Browser attempts to send authoritative exam events are rejected.
- Heartbeat and best-effort online/offline status work for browser sockets.
- Submission, exam, and announcement notifications traverse the live FastAPI-to-Java TCP bridge and return to authorized WebSocket sessions in the E2E test.
- Java TCP framing and protocol validation have their own automated tests.
- The frontend client has a Node unit test, but the Next.js host application does not yet import it.

## Remaining work before claiming the complete browser experience

- Import and initialize the centralized client in the host Next.js app using its existing authentication provider; verify with a real browser.
- Enforce exam participant membership for Java-side user subscriptions and reject broad Java exam-event recipients.
- Add a live successful grading case that reaches `submission.completed` end to end.
- Require a strong non-default `SECRET_KEY`, use HTTPS/WSS in deployment, and ensure access logs do not retain WebSocket query tokens.
- Verify a full LAN deployment with the Java TCP port restricted to the internal service and Internet disconnected.
