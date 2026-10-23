# Realtime and Socket Acceptance Checklist

This checklist evaluates the current checkout against the realtime and socket requirements in [README §3, §5, and §9](README_LAN_Programming_Exam_System.md). It describes what can be demonstrated now; a green Java test suite does not imply a live FastAPI-to-Java connection.

Status key: `[x]` implemented and covered, `[~]` partial or component-only, `[ ]` missing.

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

Enter an existing teacher username/password and student username/password when prompted. The runner checks missing/invalid WebSocket tokens, creates and retains an exam, checks two student tabs, heartbeat, client authorization, teacher start/end, student-only routing, and online/offline state. The exam remains saved as ended so it can be inspected afterward.

Run the complete current backend and Java component suites from the repository root:

```powershell
.\scripts\run_realtime_acceptance.ps1
```

The script creates a uniquely named temporary SQLite database for Python tests, removes that exact file and its SQLite sidecars afterward, then runs `mvn test`. It covers the FastAPI acceptance workflow and the Java protocol/server tests separately. It does not exercise traffic between the two servers because the FastAPI TCP client is missing.

## Requirements checklist

| README requirement | Status | Current evidence and what remains |
|---|---|---|
| Separate Java TCP server uses `ServerSocket` and `Socket` | [x] | `java-socket-server/.../RealtimeServer.java` accepts TCP sockets; Java tests run with Maven. |
| Clear server, handler, message, and registry classes | [x] | `RealtimeServer`, `ClientHandler`, `Message`, and `ClientRegistry` exist. |
| Browser uses FastAPI WebSocket rather than Java TCP | [~] | `/ws/realtime` is implemented in `backend/app/api/realtime.py`; the manual runner exercises it. A Next.js realtime client is not tested here. |
| FastAPI TCP bridge forwards events to Java and receives routed events | [ ] | Backend config has a socket host/port, but there is no FastAPI TCP client or receive loop. The current exam event publisher delivers directly to the in-process WebSocket manager. |
| Java TCP framing uses bounded UTF-8 newline-delimited JSON | [x] | `MessageFrameReader` enforces a 64 KiB limit and handles partial/multiple frames and incomplete EOF; Java protocol tests cover framing/validation. |
| Validate envelope, supported event, recipient, timestamp, payload, and forbidden data | [~] | Java `Message` and the FastAPI WebSocket manager validate their own protocols. There is no live bridge to verify that both sides agree end to end. |
| Service-to-service/TCP authentication | [ ] | Java `client.hello` trusts a `user_id` that exists in SQLite; it does not verify the caller owns the account. `SHARED_SECRET` is configured but not used by the handshake. |
| JWT-authenticated browser WebSocket | [x] | Backend WebSocket authentication uses the existing token/user lookup; tests cover authenticated and rejected connections. |
| Multiple browser tabs and connection lifecycle | [x] | FastAPI manager tracks multiple sockets per user; acceptance tests verify both tabs receive events and one-tab disconnect does not mark the user offline. |
| Heartbeat and stale browser connection handling | [x] | Browser endpoint accepts heartbeat and closes stale connections; tests cover acknowledgement and timeout. Automatic client reconnection is not implemented by this backend. |
| Java-side duplicate connections for one user | [~] | Each TCP socket is tracked, but the user-to-client index stores only one client ID per user. Concurrent TCP connections for a user need additional handling. |
| Exam start/end event follows committed database state | [x] | Teacher exam update commits before publishing; acceptance test verifies persisted state and `exam.started`/`exam.ended` delivery. |
| Exam event targeting by actual exam participants | [~] | Events target student-role sockets. The current schema has no `exam_participants` relation, so it cannot target a roster per exam. |
| Persisted teacher announcement and `exam.announcement` delivery | [ ] | Protocol validation supports the event, but backend has no announcement persistence model or teacher announcement API. |
| Submission/grading lifecycle event integration | [~] | The realtime router can validate and target submission events, but grading/submission business operations do not emit them as a complete lifecycle. |
| Socket events never become authoritative exam state | [x] | Exam state changes through authenticated FastAPI HTTP operations and SQLite; browser WebSocket accepts only heartbeat messages. |
| Java and FastAPI use the same SQLite database path | [~] | Both support path configuration, but the documented Java default path differs from FastAPI's default `backend/data/exam_system.db`. Configure and verify a single absolute path before running both together. |
| Bind Java TCP to a suitable LAN interface and protect the control port | [~] | Default Java bind is loopback and can be overridden with `SOCKET_HOST`; TCP authentication is not adequate for LAN exposure yet. |
| Full offline LAN deployment verified | [ ] | The acceptance runner uses local services, but it does not verify Next.js deployment, Java-to-FastAPI forwarding, or operation with Internet disconnected. |

## What can be demonstrated now

- FastAPI authenticates a browser WebSocket with the existing user token.
- Multiple student tabs receive teacher start/end events after exam state is saved.
- Browser attempts to send authoritative exam events are rejected.
- Heartbeat and best-effort online/offline status work for browser sockets.
- Java TCP framing and protocol validation have their own automated tests.

## Work required before claiming the README realtime flow is complete

- Implement the FastAPI TCP client with connect/reconnect, bounded framing, shared-service authentication, and a receive/routing loop.
- Connect teacher announcement persistence to `exam.announcement` delivery.
- Add exam participant membership and route events to that exam's roster.
- Harden Java TCP authentication and support multiple connections per user safely.
- Align the Java and FastAPI database paths and run a true FastAPI → Java TCP → FastAPI WebSocket integration test.
- Add client-side reconnect behavior and verify the actual Next.js browser flow on a LAN with Internet disconnected.
