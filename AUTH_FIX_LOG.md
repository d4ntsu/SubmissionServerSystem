# Auth Fix Log

## Scope and decisions
- This change is limited to authentication/session restoration and exam/question/test-case API read behavior. Refresh tokens and cookie-based access tokens remain out of scope.
- The backend `/auth/me` profile is authoritative for the restored user and role.
- A selected-role mismatch rejects the login with a message naming the backend role; it does not authenticate the user or trust the browser selection.
- Startup verifies a saved token before setting authenticated state. A 401/403 clears the saved session. A connectivity/server failure keeps the token only in local storage for an explicit retry; React auth state stays unauthenticated, the role cookie is cleared, and the login page displays a retryable error.
- A failed new login clears the old session before attempting authentication and clears again on every failed step.
- API read failures are surfaced and never replaced with bundled demo data. Successful empty lists remain empty.

## Phase 1 - Session state and API

### Findings
- The initial worktree was on branch `minh` (`ahead 14, behind 2`) with the untracked `phase1_auth_session_api_prompt.md` and `project-tree.txt`. These existing files were preserved.
- `auth-context.tsx` restored the cached role without backend verification and manufactured `auth_token_student` / `auth_token_teacher` when no token existed.
- Login and `/auth/me` returned `null` for both HTTP failures and network errors, and a failed login could leave the previous session intact.
- Exam, question, and test-case reads returned mock records after backend errors. Their socket-provider caller caught errors and retained local/demo records without showing a failure.
- `frontend/package.json` has no test script or test dependencies, and no frontend test files or ESLint configuration were present.

### Files changed
| File | Change | Reason |
|---|---|---|
| `frontend/lib/auth-context.tsx` | Verify saved tokens with `/auth/me`; use backend profile; clear missing/rejected sessions; expose retryable startup errors; clear old sessions on failed login; reject role mismatch. | Correct session restoration and failed-login behavior. |
| `frontend/lib/api.ts` | Add typed API errors and validate login/profile responses; stop exam/question/test-case reads from returning mock data on HTTP or network failure; preserve empty responses. | Distinguish auth failures from connectivity/server errors and prevent fake success data. |
| `frontend/lib/socket-context.tsx` | Clear exam/question/test-case state while loading real data; surface read failures with a retry action; log out on a protected-data 401. | Prevent the caller from hiding API errors behind cached/demo state. |
| `frontend/app/login/page.tsx` | Show accurate login errors and a retry control for startup session verification failures. | Make connectivity, credential, role, and restored-session failures understandable and recoverable. |
| `AUTH_FIX_LOG.md` | Record decisions, findings, validation, and remaining limitations. | Required Phase 1 change log. |

### Tests run
| Command/test | Result | Notes |
|---|---|---|
| `Set-Location frontend; .\node_modules\.bin\tsc.cmd --noEmit` | Passed | Frontend TypeScript check. |
| `Set-Location frontend; npm.cmd run build` | Passed | Next.js production build, including compilation and type validation. |
| `Set-Location frontend; npm.cmd run lint` | Not completed | `next lint` opened its first-run ESLint configuration prompt because no ESLint configuration exists; no config was created. |
| Inline `node -` API smoke checks | Passed | Transpiled `frontend/lib/api.ts` with the installed TypeScript compiler and asserted empty-list preservation, 401 rejection for exams/questions/test cases, network errors, invalid-credential status, and backend profile/token handling. No test file was added. |
| `git diff --check` | Passed | No whitespace errors. |

The initial root-directory npm/TypeScript invocations were not applicable because the frontend package is under `frontend/`; final TypeScript, lint, and build commands were run from that directory.

### Remaining risks / not verified
- No configured frontend test runner exists, so the AuthProvider lifecycle and browser-level localStorage/cookie scenarios were not exercised in an automated UI test.
- The API smoke checks used mocked `fetch`; no live FastAPI server or database was available for end-to-end verification.
- Access tokens remain in `localStorage`, as required by the task scope. HTTPS/WSS and token-storage redesign remain separate work.
- The broader application still contains demo/mock state outside the exam/question/test-case read path addressed here; this phase does not convert the full application to an explicit demo/API mode.

## Phase 2 - Route guards and backend authorization

### Findings
- Phase 1's recorded frontend TypeScript check, production build, and API smoke checks passed. Its lint command was blocked by the repository's missing ESLint configuration.
- Middleware previously treated any non-empty `lan_exam_role` cookie as a valid role for navigation. It now recognizes only `student` and `teacher`; the cookie remains a navigation hint, not proof of identity.
- `ProtectedRoute` already waits for `isLoading` to finish before redirecting or rendering protected content. `isAuthenticated` is based on the verified Phase 1 user and token, and `requireTeacher` renders a restricted-access view for a student. It required no code change.
- Teacher-role checks existed on teacher mutations, but questions/test cases were not scoped to the owning teacher's exam. Teacher submission/result reads were also not consistently limited to owned exams. Ownership enforcement was added to these operations.
- The project owner directed that public registration behavior remain unchanged for now because a separate registration flow is planned. Consequently, `POST /auth/register` remains unauthenticated and accepts `role: teacher`; Swagger availability and role cookie contents do not protect this endpoint. This is explicitly deferred, not considered secure.

### Files changed
| File | Change | Reason |
|---|---|---|
| `frontend/middleware.ts` | Accept only `student`/`teacher` role-cookie values for UX redirects; treat any other value as missing. | Prevent invalid cookie values from being accepted as a role hint. |
| `backend/app/api/questions.py` | Require the teacher to own the parent exam for question creation, update, and deletion. | Prevent cross-teacher question access/modification. |
| `backend/app/api/test_cases.py` | Require the teacher to own the parent exam for test-case creation and deletion. | Prevent cross-teacher test-case modification. |
| `backend/app/services/submission_service.py` | Limit teacher submission lookup/listing to exams they own. | Prevent teachers from reading another teacher's submissions. |
| `backend/app/api/results.py` | Limit teacher result and exam-result access to exams they own. | Prevent cross-teacher result disclosure. |
| `backend/tests/test_teacher_resource_authorization.py` | Add wrong-role and cross-teacher resource-access tests. | Verify backend enforcement rather than relying on client navigation. |
| `AUTH_FIX_LOG.md` | Append Phase 2 findings, endpoint audit, validation, and remaining risks. | Preserve Phase 1 and record this phase as requested. |

`frontend/components/auth/ProtectedRoute.tsx`, `backend/app/services/dependencies.py`, and `backend/app/models/user.py` were reviewed and not changed: the route guard already waits for auth initialization, and the existing dependency reloads the user from the JWT subject and compares the database role. Public registration in `backend/app/api/auth.py` was reviewed and deliberately left unchanged by owner direction.

### Backend endpoints audited
| Endpoint | Intended role | Backend authorization | Test/result |
|---|---|---|---|
| `POST /auth/register` | Public registration | No authentication; payload accepts `student` or `teacher`. Left unchanged per owner direction; teacher self-provisioning remains a risk. | Existing registration test is affected by persistent database state; see tests below. |
| `POST /auth/login` | Public login | Validates credentials and signs a token from the database user's role. | Phase 1 API smoke check covered credential error status; Phase 2 `test_api.py` login test passed in the filtered run. |
| `GET /auth/me` | Any authenticated user | `get_current_user` validates JWT and reloads the database user. | Existing `test_api.py` session tests passed in the filtered run. |
| `POST /exams` | Teacher | `require_role(teacher)`. | Existing student-denial test passed in filtered run. |
| `GET /exams` | Authenticated teacher/student | `get_current_user`; teachers see their exams, students see published/started exams. | Existing exam API tests passed in filtered run. |
| `GET /exams/{exam_id}` | Authenticated user | `get_current_user`; no exam-visibility/ownership check. | Inspected; draft/other-teacher exam visibility remains for follow-up. |
| `PUT /exams/{exam_id}` | Owning teacher | `require_role(teacher)` plus `teacher_id` ownership check. | Existing exam API tests passed in filtered run. |
| `POST /exams/{exam_id}/join` | Student | `require_role(student)`. | Inspected; no change in this phase. |
| `POST /exams/{exam_id}/announcements` | Owning teacher | `require_role(teacher)` plus exam ownership. | Inspected; no change in this phase. |
| `POST /exams/{exam_id}/verify-password` | Authenticated user | `get_current_user`; no exam-visibility check. | Inspected; no change in this phase. |
| `DELETE /exams/{exam_id}` | Owning teacher | `require_role(teacher)` plus `teacher_id` ownership check. | Existing exam API tests passed in filtered run. |
| `POST /questions` | Owning teacher | `require_role(teacher)` plus parent exam ownership (added). | New authorization test passed. |
| `GET /questions` | Authenticated user | `get_current_user`; no exam visibility/ownership filter. | Inspected; broader question visibility remains for follow-up. |
| `GET /questions/{question_id}` | Authenticated user | `get_current_user`; no exam visibility/ownership filter. | Inspected; broader question visibility remains for follow-up. |
| `PUT /questions/{question_id}` | Owning teacher | `require_role(teacher)` plus parent exam ownership (added). | New wrong-role and cross-teacher tests passed. |
| `DELETE /questions/{question_id}` | Owning teacher | `require_role(teacher)` plus parent exam ownership (added). | New cross-teacher test passed. |
| `POST /test-cases` | Owning teacher | `require_role(teacher)` plus parent question/exam ownership (added). | New cross-teacher test passed; existing test-case test passed. |
| `GET /test-cases/question/{question_id}` | Authenticated user | `get_current_user`; currently returns hidden and sample cases to any authenticated user. | Inspected; hidden-case disclosure is a known unresolved risk from the broader project plan. |
| `DELETE /test-cases/{test_case_id}` | Owning teacher | `require_role(teacher)` plus parent question/exam ownership (added). | New cross-teacher test passed. |
| `POST /submissions` | Student | Requires authentication; service rejects non-students, though as a business-validation 400 rather than a role-dependency 403. | Existing submission tests inspected; not run in this phase's focused test command. |
| `GET /submissions/{submission_id}` | Owning student or owning teacher | Authenticated; service filters student ownership and now teacher exam ownership (added). | New cross-teacher read test passed. |
| `GET /submissions` | Student or teacher | Authenticated; service filters students to their own and now teachers to owned exams (added). | New teacher-list isolation test passed. |
| `POST /submissions/{submission_id}/regrade` | Owning teacher | `require_role(teacher)` plus service ownership check. | Existing student/other-teacher denial tests passed in filtered run. |
| `GET /results/{submission_id}` | Owning student or owning teacher | Authenticated; students restricted to their own submission and teachers now restricted to owned exams (added). | New cross-teacher result test passed. |
| `GET /results/exam/{exam_id}` | Owning teacher | `require_role(teacher)` plus exam ownership (added). | New cross-teacher result test passed. |
| `WebSocket /ws/realtime` | Authenticated user | Validates JWT and reloads the database user/role before registration; client messages are limited to heartbeats. | Inspected; websocket test suite not run in this phase. |
| `GET /health` | Public health check | No authentication by design. | Inspected in `backend/app/main.py`; no change. |

### Tests run
| Command/test | Result | Notes |
|---|---|---|
| `Set-Location backend; .\.venv\Scripts\python.exe -m pytest tests\test_teacher_resource_authorization.py tests\test_api.py tests\test_regrade.py` | 19 passed, 1 failed | The failure was the pre-existing `test_register` assertion expecting HTTP 201; the persistent database already contained `fresh_user`, so registration correctly returned 400. |
| `Set-Location backend; .\.venv\Scripts\python.exe -m pytest tests\test_teacher_resource_authorization.py tests\test_api.py tests\test_regrade.py -k "not test_register"` | Passed: 18 passed, 2 deselected | Includes the new ownership tests, API tests except both fixed-username registration cases, and regrade authorization regression tests. |
| `Set-Location backend; .\.venv\Scripts\python.exe -m pytest tests\test_teacher_resource_authorization.py tests\test_submission_api.py` | Passed: 10 passed | Rechecked submission ownership behavior and the existing submission API suite. |
| Inline Node middleware smoke checks | Passed | Tested no cookie, unknown role, valid teacher/student roles, and preservation of the `next` path. |
| `Set-Location frontend; .\node_modules\.bin\tsc.cmd --noEmit` | Passed | Frontend type check. |
| `Set-Location frontend; npm.cmd run build` | Passed | Production build and Next.js type validation. |
| `npm.cmd run lint` | Not rerun | Phase 1 already confirmed lint cannot proceed without creating ESLint configuration; no config was created. |
| `git diff --check` | Passed | No whitespace errors. |

The initial backend test invocation used the wrong working directory and did not run; the corrected command above ran from `backend`. The full backend suite, websocket suite, and browser-level route tests were not run.

### Remaining risks / not verified
- Public `POST /auth/register` still allows a caller to request `role: teacher`, as explicitly deferred by the project owner. Swagger exposure is not authorization. A trusted teacher-provisioning flow is still needed before treating teacher accounts as secure.
- `GET /test-cases/question/{question_id}` currently returns hidden case inputs/answers to any authenticated user. Question list/detail and exam detail/password-verification routes also lack resource visibility checks. These are identified gaps but were not changed in this route/teacher-operation phase.
- Frontend middleware and `ProtectedRoute` are navigation/presentation safeguards only. Backend JWT and endpoint checks are the security boundary.
- `ProtectedRoute.tsx` was verified by code inspection and the production build, but not by browser automation. Frontend lint remains unavailable until an ESLint config is intentionally added.
- Backend tests use a persistent local database; fixed usernames can cause registration tests to fail on later runs as observed. The new authorization tests passed.
