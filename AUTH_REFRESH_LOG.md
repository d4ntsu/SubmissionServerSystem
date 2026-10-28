# Refresh-Token Implementation Log

## Scope and initial audit

The existing authentication flow used bearer JWT access tokens for protected API
requests. `frontend/lib/api.ts` sent them in the `Authorization` header, while
`frontend/lib/auth-context.tsx` previously persisted and restored authentication
from browser storage. The backend exposed `/auth/login` and `/auth/me`; there was
no refresh endpoint, refresh-cookie lifecycle, or application-level token
rotation/revocation implementation.

The SQLite database already contained a partial `refresh_sessions` table from an
earlier development version, with legacy `previous_token_hash` and `rotated_at`
columns and four existing records. This was not a complete refresh flow. The
implementation preserves those records and migrates the table in place.

The repository uses SQLAlchemy `Base.metadata.create_all()` during application
initialization and has lightweight, hand-written SQLite schema upgrades; it
does not use Alembic. CORS already allowed credentialed requests, but its
origins are now validated as explicit values. No root `SETUP.md` or working
ESLint configuration was present during this task.

## Implementation

### Token and session lifecycle

- Access JWTs expire after **15 minutes** and contain `iat` and unique `jti`
  claims. The existing bearer-token and `/auth/me` contracts remain compatible.
- Login creates a cryptographically random opaque refresh token, stores only its
  SHA-256 hash, and returns the access JWT while setting the refresh cookie.
- Refresh consumes the current session and rotates to a new token in the same
  family. SQLite uses `BEGIN IMMEDIATE` to serialize rotations. A just-rotated
  token receives a brief `409 Conflict` grace response to accommodate a
  simultaneous request; replay outside that grace revokes the family.
- Logout revokes the presented server-side session and expires the cookie.
- Refresh sessions expire after **14 days**. Their expiration slides forward
  with each successful rotation.
- The database retains revoked token hashes and lineage for reuse detection.

### Cookie, CORS, and HTTP development

The cookie is named `lan_exam_refresh`, is `HttpOnly`, has path `/auth`, has no
`Domain` attribute, and uses `SameSite=Lax` by default. Its `Max-Age` matches
the configured 14-day refresh lifetime. `Secure=False` is accepted only when
`APP_ENVIRONMENT=development`; other environments require
`REFRESH_COOKIE_SECURE=true`. `SameSite=None` also requires Secure.

`CORS_ORIGINS` is an explicit comma-separated allowlist. Wildcard or empty
origins are rejected because requests include credentials. Login, registration,
refresh, and logout validate the request `Origin`; refresh and logout require
it. Browser API calls that may use the cookie send credentials.

The repository's HTTP development setup intentionally uses `Secure=False`.
`HttpOnly` prevents JavaScript access but **does not encrypt HTTP traffic**:
refresh credentials can be intercepted on the network. This mode is for
temporary trusted development/testing only and is not production-safe. Do not
use it on untrusted LANs or expose it as a production deployment.

### Frontend lifecycle

The access token is held in module memory and React state, not persistent
browser storage. Startup refreshes through the HttpOnly cookie and then verifies
the returned access token with `/auth/me` before setting the user and role.
Authenticated API calls share a single in-tab refresh promise, retry once after
a `401`, and do not enter an infinite retry loop. A failed refresh clears the
frontend session; a backend/network failure during startup instead exposes a
retryable verification message. Logout clears local state before requesting
server revocation and reports a revocation failure.
If startup refresh returns `404`, the provider reports that the backend does
not expose `/auth/refresh` and asks the user to update/restart it, distinguishing
an outdated backend route table from a network outage.

The app's existing `lan_exam_role` cookie remains a navigation hint only; the
verified backend profile is authoritative. Old `lan_exam_user` and
`lan_exam_token` local-storage entries are removed during authentication
cleanup. Other application data in local storage is unchanged.

## Files changed

| File | Change |
|---|---|
| `.env.example` | Documents development environment, token lifetimes, cookie settings, explicit CORS origin, and HTTP-only development risk. |
| `backend/app/core/config.py` | Adds configurable access/refresh lifetimes and cookie settings; validates environment, SameSite, and explicit CORS origins. |
| `backend/app/core/security.py` | Adds `iat` and unique `jti` claims to access JWTs. |
| `backend/app/models/refresh_session.py` | Defines persistent hashed refresh-token sessions, expiry, family, revocation, and replacement lineage. |
| `backend/app/models/__init__.py` | Registers the refresh-session model for SQLAlchemy metadata creation. |
| `backend/app/database.py` | Adds a backward-compatible in-place upgrade for the existing refresh-session schema. |
| `backend/app/main.py` | Runs the refresh-session schema upgrade during application initialization. |
| `backend/app/api/auth.py` | Sets and clears refresh cookies; implements refresh rotation, replay handling, logout revocation, and Origin validation. |
| `frontend/lib/api.ts` | Keeps access tokens in memory, includes credentials, deduplicates refreshes, and retries authenticated calls once. |
| `frontend/lib/auth-context.tsx` | Restores through refresh and `/auth/me`, clears failed sessions, and reports startup/logout errors. |
| `frontend/lib/socket-context.tsx` | Uses the updated shared token lifecycle for authenticated API requests. |
| `backend/tests/conftest.py` | Supplies the configured frontend Origin to auth test requests. |
| `backend/tests/test_refresh_auth.py` | Covers login cookie secrecy, rotation, invalid/expired/replayed tokens, logout, Origin validation, `/auth/me`, and concurrent refresh. |
| `frontend/lib/api-refresh.test.mjs` | Covers in-tab refresh deduplication, retry limits, and invalid-refresh behavior using the existing Node test runner. |

`AUTH_FIX_LOG.md` was retained as the historical Phase 1/2 record; its earlier
statements about access-token persistence and refresh being out of scope describe
those earlier phases, not the implementation documented here.

## Configuration and startup

Set the backend variables in `backend/.env` (do not copy secrets into source
control):

```dotenv
APP_ENVIRONMENT=development
SECRET_KEY=<a private random signing key>
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_SESSION_DAYS=14
REFRESH_COOKIE_SECURE=false
REFRESH_COOKIE_SAMESITE=lax
CORS_ORIGINS=http://localhost:3000
```

For HTTP development on a LAN, set `NEXT_PUBLIC_API_URL` in the frontend
environment to the backend's reachable HTTP address, and set `CORS_ORIGINS` to
the exact browser-facing frontend origin(s), for example
`http://192.168.1.20:3000`. Do not use `*`.

From the repository root, start the backend in one PowerShell terminal:

```powershell
Set-Location backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Start the frontend in a second terminal:

```powershell
Set-Location frontend
npm run dev -- --hostname 0.0.0.0
```

The database schema is created/upgraded automatically at backend import/startup.
No manual migration command or new migration framework is required. Existing
refresh-session rows are retained and legacy lineage is backfilled. Back up
important database files before deploying schema changes.

## Validation performed

| Command | Result |
|---|---|
| `Set-Location backend; .\.venv\Scripts\python.exe -m pytest tests\test_refresh_auth.py` | **Passed:** 8 tests, including concurrent refresh rotation. |
| `Set-Location backend; .\.venv\Scripts\python.exe -m pytest tests\test_realtime_websocket.py` | **Passed:** 17 tests. |
| `Set-Location backend; .\.venv\Scripts\python.exe -m pytest tests\test_api.py tests\test_submission_api.py tests\test_regrade.py` | **Partial:** 25 passed, 1 failed. The existing `test_register` assertion expected `fresh_user` to be new, but that username already exists in the persistent test database. The database was not reset or deleted. |
| `Set-Location frontend; .\node_modules\.bin\tsc.cmd --noEmit` | **Passed:** TypeScript check. |
| `Set-Location frontend; npm.cmd run build` | **Passed:** Next.js production build and type validation. |
| `Set-Location frontend; node --test lib\api-refresh.test.mjs` | **Passed:** 3 refresh/retry tests. |
| Backend configuration smoke test | **Passed:** accepted HTTP cookie settings in development and rejected insecure non-development settings, `SameSite=None` without Secure, and wildcard CORS. |
| `git diff --check` | **Passed:** no whitespace errors after implementation and documentation changes. |

The combined regression result is not a full pass because the persistent
`fresh_user` fixture collision remains. FastAPI/Starlette deprecation warnings
were emitted by the existing test stack. Lint was not run because the project
has no ESLint configuration and `next lint` previously opened its first-run
configuration prompt. Browser-level/E2E validation and live HTTP/LAN testing
were not performed.

## Known limitations and remaining risks

- HTTP refresh cookies are visible to network observers; use trusted development
  networks only. Production requires HTTPS and `REFRESH_COOKIE_SECURE=true`.
- Refresh-cookie replay detection and rotation are implemented, but this change
  does not add rate limiting or distributed session coordination for multiple
  backend hosts. SQLite is the project's current database.
- The access token is in JavaScript memory and may be exposed by a successful
  same-origin script injection; the refresh credential remains HttpOnly.
- Startup/session-provider behavior was not exercised in a browser-level test.
  The API module's refresh concurrency and retry behavior was covered by Node
  tests.
- Existing backend registration behavior remains unchanged; public teacher
  self-registration and the earlier authorization limitations documented in
  `AUTH_FIX_LOG.md` are outside this refresh-session task.
- The full backend suite, external Java/Piston integrations, lint, and
  end-to-end flows have not been verified.
