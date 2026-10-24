# CODEX GLOBAL RULES — REALTIME & SOCKET

These rules are mandatory for every implementation task.

==================================================
RULE 1 — READ BEFORE MODIFY
==================================================

Before modifying any file:

1. Read the existing file.
2. Understand its current responsibility.
3. Search the repository for usages.
4. Search for duplicate implementations.
5. Identify tests covering the file.
6. Only then modify it.

Never modify a file based only on its filename.

==================================================
RULE 2 — PRESERVE EXISTING FUNCTIONALITY
==================================================

Existing functionality has priority over new functionality.

The project already contains a working Submission & Grading Pipeline.

Do not rewrite it.

Do not replace it.

Do not redesign it.

Only add the minimum integration required for realtime events.

==================================================
RULE 3 — DO NOT CREATE DUPLICATE SYSTEMS
==================================================

Before creating a new:

- service
- manager
- client
- router
- model
- utility
- protocol class
- event dispatcher
- WebSocket manager
- TCP client
- TCP receiver

search the repository first.

If an equivalent implementation already exists:

- reuse it
- extend it
- refactor minimally only if necessary

Do not create a second implementation of the same responsibility.

==================================================
RULE 4 — DO NOT CREATE UNNECESSARY FILES
==================================================

Only create a new file when:

1. no existing file has the correct responsibility, AND
2. placing the implementation in an existing file would violate separation of concerns, AND
3. the new file is consistent with the existing project structure.

Every new file must have a clear reason.

Before creating a file, explicitly state:

- why it is necessary
- why existing files cannot be reused
- what responsibility it owns

==================================================
RULE 5 — NO UNRELATED REFACTORING
==================================================

Do not refactor unrelated code.

Do not:

- rename unrelated classes
- rename unrelated functions
- reorganize directories
- change formatting of entire files
- update dependencies
- change architecture outside realtime
- change database configuration
- rewrite working code

unless strictly required by the current task.

==================================================
RULE 6 — MINIMAL DIFF
==================================================

Prefer the smallest safe change.

Do not rewrite entire files when a localized change is sufficient.

Avoid:

- unnecessary formatting changes
- import reordering unrelated to the task
- renaming
- moving code
- replacing working implementations

Keep diffs reviewable.

==================================================
RULE 7 — NO SPECULATIVE IMPLEMENTATION
==================================================

Never implement functionality based only on assumptions.

If the repository does not confirm something:

1. inspect more code
2. inspect tests
3. inspect configuration
4. inspect models
5. inspect documentation

If still unknown, report the uncertainty.

Do not invent architecture.

==================================================
RULE 8 — EXISTING CONTRACTS HAVE PRIORITY
==================================================

Preserve existing:

- API paths
- request schemas
- response schemas
- database models
- enum values
- authentication
- environment variables
- configuration names
- test assumptions

unless the current task explicitly requires changing them.

==================================================
RULE 9 — SUBMISSION STATUS IS FIXED
==================================================

Use existing submission states:

queued
running
completed
error

Do not introduce:

failed

unless the existing repository already uses it consistently.

Realtime event names do not require changing database status names.

==================================================
RULE 10 — DATABASE SAFETY
==================================================

Do not change database schema unless explicitly required.

Do not add migration files unless the current task specifically requires persistence.

Do not modify existing migrations.

Do not change existing relationships.

==================================================
RULE 11 — AUTHENTICATION SAFETY
==================================================

Never trust:

user_id
role
exam_id

provided by an unauthenticated client.

Authentication must be based on the project's existing authentication mechanism or an explicitly designed service credential.

Identity claims are not authentication.

==================================================
RULE 12 — AUTHORIZATION
==================================================

Realtime events must only be delivered to authorized recipients.

Never broadcast private submission/result information globally.

Examples:

Student A submission event
→ Student B MUST NOT receive it.

Teacher A exam announcement
→ Students outside the exam MUST NOT receive it.

==================================================
RULE 13 — TRANSACTION SAFETY
==================================================

Database-backed events should be emitted only after the relevant database operation succeeds.

Never:

emit event
→ DB commit fails

unless the architecture explicitly implements reliable event/outbox semantics.

==================================================
RULE 14 — TCP SAFETY
==================================================

TCP implementation must correctly handle:

- partial reads
- multiple messages in one read
- newline framing
- malformed JSON
- oversized messages
- disconnects
- timeouts
- reconnects
- shutdown

Never assume one recv/read call equals one message.

==================================================
RULE 15 — CONCURRENCY
==================================================

Realtime code must support multiple clients.

Never use global mutable state for:

- current socket
- current user
- current session
- current client

unless it is explicitly thread-safe and represents shared infrastructure.

==================================================
RULE 16 — ERROR ISOLATION
==================================================

One bad client must not crash the entire server.

One malformed message must not terminate unrelated connections.

One failed WebSocket send must not corrupt the entire connection manager.

==================================================
RULE 17 — LOGGING
==================================================

Use the project's existing logging mechanism when available.

Do not introduce random print statements for production logic.

Logs must not expose:

- passwords
- JWT tokens
- secrets
- private source code
- sensitive grading information

==================================================
RULE 18 — TEST FIRST, THEN IMPLEMENT
==================================================

Before implementation:

1. inspect existing tests
2. identify missing coverage
3. implement
4. run focused tests
5. run related regression tests

Do not immediately run the entire repository test suite after every tiny edit if focused tests are available.

==================================================
RULE 19 — NEVER DELETE TESTS
==================================================

Never delete or weaken a test simply because implementation currently fails it.

If an existing test conflicts with a new requirement:

- analyze it
- explain why
- modify only if the requirement genuinely supersedes it

==================================================
RULE 20 — NO DEPENDENCY CHANGES WITHOUT JUSTIFICATION
==================================================

Do not install or upgrade packages unless:

1. existing dependencies cannot support the required functionality, AND
2. the change is explicitly justified.

==================================================
RULE 21 — VERIFY AFTER EVERY TASK
==================================================

After implementation:

- run focused tests
- run relevant existing tests
- inspect changed files
- inspect git diff
- verify no unrelated files changed

==================================================
RULE 22 — GIT SAFETY
==================================================

Never:

- reset the user's branch
- checkout another branch
- delete commits
- force push
- discard unrelated local changes
- overwrite uncommitted user work

unless explicitly instructed.

==================================================
RULE 23 — USER CHANGES HAVE PRIORITY
==================================================

If working tree contains modifications that were not created by you:

DO NOT overwrite them.

Inspect and preserve them.

If a required modification overlaps with an existing user change:

stop and report the conflict before destructive modification.

==================================================
RULE 24 — NO FAKE COMPLETION
==================================================

Never claim a task is complete merely because:

- code compiles
- unit tests pass
- individual FastAPI tests pass
- individual Java tests pass

Realtime completion requires integration evidence.

==================================================
RULE 25 — END-TO-END VALIDATION
==================================================

For realtime milestones, prefer proving:

Browser
→ FastAPI
→ Java
→ FastAPI
→ Browser

rather than only testing isolated components.

==================================================
RULE 26 — DOCUMENT SIGNIFICANT CHANGES
==================================================

After each milestone report:

- files changed
- files created
- files intentionally not changed
- tests added
- tests executed
- test results
- remaining risks

==================================================
RULE 27 — STOP WHEN SCOPE IS COMPLETE
==================================================

Once the requested task is complete:

STOP.

Do not automatically continue implementing future tasks.

Do not "improve" unrelated parts.

==================================================
RULE 28 — ASK BEFORE MAJOR ARCHITECTURAL CHANGE
==================================================

If completing the task requires:

- database redesign
- major dependency change
- replacing an existing architecture
- changing public API contracts
- rewriting the submission pipeline
- replacing authentication

stop and report the issue before implementing.

==================================================
RULE 29 — CODE QUALITY
==================================================

Implementation must prioritize:

- clear responsibility
- type safety where applicable
- validation
- predictable error handling
- testability
- concurrency safety
- maintainability

==================================================
RULE 30 — FINAL DIFF AUDIT
==================================================

Before declaring completion:

1. inspect git diff
2. list every modified file
3. list every created file
4. verify each change belongs to the task
5. remove accidental changes
6. run tests
7. report final status