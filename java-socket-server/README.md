# LAN Exam Realtime Socket Server

Java TCP socket server with JDBC for realtime event distribution in the LAN Programming Exam System.

## Architecture

```
FastAPI                     Java Socket Server          Browser (via FastAPI WebSocket)
(Authoritative backend)     (Realtime events)           (Student/Teacher UI)
      |                           |                            |
      |  ── internal event ──→   |                            |
      |                           |  ── TCP broadcast ──→     | (via FastAPI bridge)
      |
  SQLAlchemy               JDBC (sqlite-jdbc)
      \                         /
       ──── exam_system.db ────
             (WAL mode)
```

## Build

```bash
mvn clean package
```

This produces `target/realtime-server-1.0.0-jar-with-dependencies.jar`.

## Run

```bash
java -jar target/realtime-server-1.0.0-jar-with-dependencies.jar
```

Or with Maven:

```bash
mvn exec:java -Dexec.mainClass="com.exam.realtime.RealtimeServer"
```

## Configuration

Edit `src/main/resources/server.properties` or set environment variables:

| Property | Env Variable | Default | Description |
|---|---|---|---|
| `server.host` | `SOCKET_HOST` | `127.0.0.1` | Bind address |
| `server.port` | `SOCKET_PORT` | `9000` | TCP port |
| `database.path` | `DATABASE_PATH` | `../backend/app/data/exam_system.db` | SQLite DB path |
| `auth.shared_secret` | `SOCKET_SERVER_SHARED_SECRET` or `SHARED_SECRET` | empty | Shared secret for FastAPI service authentication; set the same value in the backend `.env` and Java server environment |
| `auth.jwt_secret` | `SECRET_KEY` | empty | Must match the FastAPI `SECRET_KEY`; verifies user access JWTs. Java accepts HS256 only. Set this through the environment or local `server.properties`, never commit a real secret. |
| `auth.jwt_algorithm` | `JWT_ALGORITHM` | `HS256` | JWT algorithm; Java user authentication currently supports HS256 only |

The FastAPI bridge remains disabled until `SOCKET_SERVER_SHARED_SECRET` is configured. User JWT authentication also remains disabled until Java receives the backend `SECRET_KEY`. Keep both services on a trusted internal network; the TCP connection does not add TLS.

## Message Protocol

Newline-delimited UTF-8 JSON over TCP. Each message is one complete JSON object followed by `\n`; a TCP read may contain part of a frame or several frames. Frames are limited to 64 KiB before the line-feed; an optional carriage return counts toward the limit. The server rejects incomplete final frames, invalid UTF-8, unknown fields, unsupported event types, and payloads that do not match the event schema.

The envelope keeps the existing flat field names for compatibility. `request_id` is accepted as an alias for `requestId`; Java emits `requestId`.

```json
{
  "type": "exam.announcement",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "sender": "fastapi",
  "recipient": "role:student",
  "timestamp": "2026-10-22T10:00:00Z",
  "payload": { "exam_id": 17, "message": "Exam begins soon" }
}
```

Supported event types:

```text
client.hello, client.heartbeat, client.status
exam.started, exam.ended, exam.announcement
submission.received, submission.running, submission.completed, submission.failed
server.error
```

Payloads use event-specific allowlists. Submission events carry `submission_id`; exam start/end carry `exam_id`; announcements carry `exam_id` and `message`. Passwords, credentials in domain events, source code, hidden tests, expected outputs, grades, and scores are rejected. The backend access token is accepted only in the `auth` credential message.

### Client to Server

```
{"type":"auth","event_id":"550e8400-e29b-41d4-a716-446655440000","sender":"client:127.0.0.1","recipient":"server","timestamp":"2026-10-22T10:00:00Z","payload":{"access_token":"<backend-issued-access-token>"}}
{"type":"client.heartbeat","requestId":"550e8400-e29b-41d4-a716-446655440000","sender":"client:127.0.0.1","recipient":"server","timestamp":"2026-10-22T10:00:00Z","payload":{}}
```

FastAPI authenticates with the existing HMAC challenge-response. A direct Java user client authenticates with an `auth` message containing its backend `access_token`; Java verifies the HS256 signature and expiry, then reads the current role from SQLite. The legacy `client.hello` message does not authenticate a user. User clients may subscribe only to published/started exams visible to students, or exams owned by the teacher.

After the service handshake succeeds, FastAPI sends newline-delimited normalized event envelopes. Java routes them by `recipient` (`broadcast`, `user:<id>`, `student:<id>`, `role:<name>`, `exam:<id>`, or `session:<connection-id>`). Exam delivery goes only to authorized subscribed sessions. Submission events are rejected when they target broad recipients. Routed messages received by the service connection are dispatched to FastAPI's `RealtimeEventRouter`.

### Server to Client

```
{"type":"client.status","requestId":"550e8400-e29b-41d4-a716-446655440000","sender":"server","recipient":"client:/127.0.0.1:9000","timestamp":"2026-10-22T10:00:00Z","payload":{"authenticated":true,"user_id":42,"username":"student1","role":"student","online_count":1}}
{"type":"submission.running","requestId":"550e8400-e29b-41d4-a716-446655440000","sender":"fastapi","recipient":"student:42","timestamp":"2026-10-22T10:00:00Z","payload":{"submission_id":123}}
```

The `user_id` and `role` in a user JWT are not used as authorization data. Java trusts only a valid signature and user ID from the JWT, and loads the current user role from SQLite. Tokens are never written to logs. Since this TCP service does not provide TLS, direct user JWT authentication must be used only on the trusted internal network; browser clients should continue to connect through FastAPI WebSocket.

## Testing

```bash
mvn test
```

## Project realtime checks

From the repository root, run the combined FastAPI and Java component suites:

```powershell
.\scripts\run_realtime_acceptance.ps1
```

To manually exercise browser authentication, heartbeat, multiple tabs, and teacher exam start/end events, start FastAPI and run `backend/manual_tests/realtime_manual_runner.py`. The runner and its limitations are documented in the [realtime/socket acceptance checklist](../docs/RealtimeSocketAcceptanceChecklist.md).

The current backend does not contain a FastAPI TCP client, so these checks do not demonstrate forwarding between this Java server and FastAPI.

## Database Schema Requirements

The server reads from the `users` table (id, username, full_name, role). If the optional `is_online` column exists, the server will update it on connect/disconnect.

The database file path in `server.properties` must point to the same SQLite file used by the Python FastAPI backend.

## Dependencies

- Java 17+
- Maven 3.9+
- SQLite JDBC (bundled in fat JAR)
- Jackson (bundled in fat JAR)
