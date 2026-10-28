# Refresh-Token Test and Merge Guide

This guide explains how to run the backend and frontend refresh-token tests and
which files must accompany the feature when merging it into another branch.

## What the tests cover

### Backend

[`backend/tests/test_refresh_auth.py`](./backend/tests/test_refresh_auth.py)
contains eight tests for:

- Login issuing an HttpOnly refresh cookie without exposing the refresh secret
  in the JSON response, and storing only its hash.
- Refresh rotation and continued access to `/auth/me`.
- Missing, invalid, and expired refresh tokens.
- Reuse detection, session-family revocation, and concurrent refresh requests.
- Logout revocation and cookie deletion.
- Rejection of untrusted request origins.
- Rejection of missing or invalid access tokens at `/auth/me`.

### Frontend

[`frontend/lib/api-refresh.test.mjs`](./frontend/lib/api-refresh.test.mjs)
contains three Node tests for:

- Deduplicating refresh calls when simultaneous API requests receive `401`.
- Retrying a protected request only once.
- Clearing the access-token session when refresh is rejected.

These are repeatable automated tests, not one-time scripts. Backend tests create
uniquely named accounts and refresh-session rows in the configured database;
they do not automatically clean those records up. They may also update refresh
session records as part of expiry/replay checks. Use a disposable test database
if you need a pristine dataset, and do not point tests at a database containing
important data.

## Run the tests

Run commands from the repository root in PowerShell.

### Backend refresh tests

The backend virtual environment must already be set up with the project's
requirements installed:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pytest tests\test_refresh_auth.py
```

Expected result: `8 passed`. Deprecation warnings from FastAPI/Starlette may be
printed; warnings are not test failures when pytest exits successfully.

### Frontend refresh tests

The frontend dependencies must already be installed:

```powershell
Set-Location frontend
node --test lib\api-refresh.test.mjs
```

Expected result: `3` tests pass.

### Related checks

```powershell
Set-Location frontend
.\node_modules\.bin\tsc.cmd --noEmit
npm.cmd run build
```

The frontend test uses Node's built-in test runner and the already-installed
TypeScript compiler; it does not require adding a test framework.

## Files required when merging the refresh-token feature

For the full feature, merge all of these implementation files together:

### Backend implementation

- `backend/app/api/auth.py` - login cookie, refresh rotation, logout revocation,
  and Origin validation.
- `backend/app/core/config.py` - token lifetimes, cookie settings, and
  environment/CORS validation.
- `backend/app/core/security.py` - access-token claims and lifetime.
- `backend/app/models/refresh_session.py` - refresh-session persistence model.
- `backend/app/models/__init__.py` - registers the model with SQLAlchemy.
- `backend/app/database.py` - in-place upgrade for earlier refresh-session
  schemas.
- `backend/app/main.py` - invokes schema setup at application initialization.

### Frontend implementation

- `frontend/lib/api.ts` - in-memory access token, credentialed requests,
  refresh deduplication, and one-time retry.
- `frontend/lib/auth-context.tsx` - startup restore, verified profile, logout,
  and failed-login behavior.
- `frontend/lib/socket-context.tsx` - integration with authenticated API
  requests.

### Configuration, test setup, and tests

- `.env.example` - non-secret example configuration.
- `backend/tests/conftest.py` - Origin header for auth test requests.
- `backend/tests/test_refresh_auth.py` - backend refresh tests.
- `frontend/lib/api-refresh.test.mjs` - frontend refresh tests.
- `AUTH_REFRESH_LOG.md` - implementation audit, security notes, and validation
  record.

Prefer merging or cherry-picking the complete feature commit(s) instead of
manually selecting individual files. The backend, frontend, model registration,
and database initialization changes are coupled; omitting one can cause startup
errors or leave the UI unable to restore a session.

Do **not** copy or commit machine-specific or secret-bearing files as part of
this feature merge:

- `backend/.env` - local secrets/configuration; add the required values locally
  based on `.env.example`.
- SQLite database files (for example `backend/data/exam_system.db`) - local
  persistent data; the startup upgrade runs on the target database.
- `.venv`, `node_modules`, generated build output, and TypeScript build caches.

`token-access-reqquest.md` is the request/requirements note, not a runtime
dependency. It is not required for the implementation to run.

## Configuration after pulling

Create or update the local `backend/.env` without replacing existing secrets.
For local HTTP development, the relevant values are:

```dotenv
APP_ENVIRONMENT=development
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_SESSION_DAYS=14
REFRESH_COOKIE_SECURE=false
REFRESH_COOKIE_SAMESITE=lax
CORS_ORIGINS=http://localhost:3000
```

Keep the existing private `SECRET_KEY` and `DATABASE_URL`; do not copy them from
another developer's machine. If the frontend/backend use different LAN
addresses, set `NEXT_PUBLIC_API_URL` and `CORS_ORIGINS` to the actual reachable
addresses and exact browser origin. CORS origins must be explicit, not `*`.
`REFRESH_COOKIE_SECURE=false` is only for trusted HTTP development; HTTP does
not encrypt the refresh cookie in transit. Non-development environments must
use HTTPS and `REFRESH_COOKIE_SECURE=true`.

The refresh-session schema upgrade runs automatically on backend startup. Make
a backup before using it with an important database. Do not copy another
developer's SQLite database to receive the schema update.

## Merge-conflict hotspots

Resolve these files carefully; do not simply accept one side wholesale:

1. **`backend/app/api/auth.py`** - Preserve existing auth routes/contracts,
   while ensuring login sets the cookie, `/auth/refresh` rotates sessions, and
   logout revokes the refresh token and clears the cookie. Keep Origin checks
   and the configured cookie attributes. Do not return the refresh secret in
   JSON.
2. **`backend/app/core/config.py` and `.env.example`** - Keep existing project
   settings and merge in the new lifetime/cookie variables and validation.
   Defaults should remain 15 access-token minutes and 14 refresh-session days;
   insecure cookies must not be allowed outside development.
3. **`backend/app/database.py`, `backend/app/main.py`,
   `backend/app/models/refresh_session.py`, and
   `backend/app/models/__init__.py`** - Keep model registration and startup
   migration in sync. `create_all()` alone does not add columns to an existing
   table, so do not drop the explicit legacy-table upgrade. Preserve existing
   database initialization and other migrations.
4. **`frontend/lib/api.ts`** - Keep the existing API helpers while routing
   authenticated requests through the shared token lifecycle. Preserve
   `credentials: "include"`, one refresh retry, and refresh singleflight;
   do not store the refresh token or access token in local storage.
5. **`frontend/lib/auth-context.tsx` and
   `frontend/lib/socket-context.tsx`** - Startup must refresh and verify
   `/auth/me` before setting the user. Backend role remains authoritative.
   Preserve failed-login clearing, local-first logout, and reported revocation
   failures.
6. **`backend/tests/conftest.py` and both refresh test files** - Keep the
   allowed Origin in backend fixtures. Retain tests for concurrent refresh,
   rotation/reuse, and single-retry behavior when adjusting implementation.

After resolving conflicts, inspect the merged diff and run at minimum:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pytest tests\test_refresh_auth.py
Set-Location ..\frontend
node --test lib\api-refresh.test.mjs
.\node_modules\.bin\tsc.cmd --noEmit
npm.cmd run build
```

If existing local work is uncommitted, commit it or use a safe stash before
pulling; do not discard it to make the merge proceed. After the merge, inspect
`git status` and `git diff` before committing the result.
