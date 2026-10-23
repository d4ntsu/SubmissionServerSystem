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
| `database.path` | `DATABASE_PATH` | `../backend/data/exam_system.db` | SQLite DB path |
| `auth.shared_secret` | `SHARED_SECRET` | `dev-secret-change-in-production` | Shared auth secret |

## Message Protocol

Newline-delimited JSON over TCP. See [Message.java](src/main/java/com/exam/realtime/Message.java) for the full schema.

### Client → Server
```
{"type":"client.hello","requestId":"...","sender":"...","payload":{"user_id":42}}
{"type":"client.heartbeat","requestId":"...","sender":"..."}
```

### Server → Client
```
{"type":"client.status","requestId":"...","recipient":"...","payload":{"authenticated":true,...}}
{"type":"exam.announcement","requestId":"...","recipient":"...","payload":{"message":"..."}}
{"type":"submission.status","requestId":"...","recipient":"...","payload":{"submission_id":123,"status":"RUNNING"}}
```

## Testing

```bash
mvn test
```

## Database Schema Requirements

The server reads from the `users` table (id, username, full_name, role). If the optional `is_online` column exists, the server will update it on connect/disconnect.

The database file path in `server.properties` must point to the same SQLite file used by the Python FastAPI backend.

## Dependencies

- Java 17+
- Maven 3.9+
- SQLite JDBC (bundled in fat JAR)
- Jackson (bundled in fat JAR)