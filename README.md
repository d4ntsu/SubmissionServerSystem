# LAN Programming Exam System

A teacher-hosted programming exam platform for a local network. Students take exams in a browser, submit Java or Python solutions, and inspect their scores; teachers manage exams, questions, test cases, submissions, and re-grading.

The repository contains two layers:

- **FastAPI backend** with SQLite, JWT auth, a background grading worker, Piston code execution, and persisted test-case results.
- **Next.js frontend** with the teacher and student interfaces. The frontend currently runs on bundled demo data and browser `localStorage`; it is not yet wired to the FastAPI API.

For the full architecture and phased implementation plan, see [`docs/README_LAN_Programming_Exam_System.md`](docs/README_LAN_Programming_Exam_System.md).

## What's New in This Update

### Student Test Results

- **My Results** (`/student/submissions`) now shows one overall result per exam instead of a flat list of individual submissions.
- Each row shows the overall score, percentage, result status, submitted-question progress, test cases passed, and last submission time.
- **New test result page** (`/student/results/[examId]`) displays:
  - Overall test score and percentage.
  - Result status: `PASSED`, `PARTIAL`, `NOT PASSED`, `GRADING`, `ERROR`, `HIDDEN`, or `NOT SUBMITTED`.
  - Questions submitted, fully correct questions, tests passed, and pending/error counts.
  - A per-question score breakdown with progress bars and accepted/failed status.
- Each question links to its **question score detail** page (`/student/submissions/[submissionId]`), which now shows:
  - Input, expected output, and the student's actual output for sample tests.
  - Awarded points and test-case weight.
  - Hidden-test verdicts and points, while withholding hidden input and expected output.
  - Grader messages, stderr, compile output, and grading errors.
- The latest submission for each question is used when building the exam result.
- After a confirmed test submission, students are redirected to their test result page.
- The submission-detail page no longer falls back to an unrelated mock submission. Students can only open their own results; teachers can inspect any result.
- The My Results navigation item stays active on both the result list and result detail pages.

### Exam-Taking Experience

- Multiple-choice questions render labeled options as radio buttons for one answer or checkboxes for select-all questions; students never receive the correct-answer key.
- Short-answer questions show the prompt above a text field and are graded by trimmed, case-insensitive exact match.
- Objective questions do not show programming-language, starter-code, CPU-limit, sample-run, or test-case controls. Their submissions are persisted and graded without Piston.
- Teachers can protect an exam with an **entry password**.
- Students must unlock a protected exam before the question window opens.
- Teachers preview protected exams without entering the password.
- The exam timer and activity log begin only after exam access is granted.
- Students launch active exams in a dedicated popup window and enter fullscreen.
- Leaving the window, switching tabs, or exiting fullscreen records a proctoring warning.
- Warnings appear as a dismissible toast in the top-right corner instead of blocking the entire exam.
- The final-submission flow now uses a **Review & Submit Test** modal:
  - A checkbox confirms the final submission.
  - All questions are submitted together, including unanswered questions.
  - The modal warns about unanswered questions before submission.
  - The success screen reports the number of questions submitted and redirects to the test result.
- The programming language is selected by the teacher and shown read-only to students. Java class/method questions always use Java.
- Per-question memory limits were removed from the teacher question form; memory limits are managed by the execution sandbox.
- The secure exam window hides the normal navbar for students while preserving the question sidebar and exam controls.

### Teacher Tools

- Teachers can author multiple-choice questions with at least two options, an explicit single-answer or select-all mode, and the correct option letter(s). Short-answer questions use a teacher-only expected answer.
- Objective questions retain points, question text, and result-visibility settings, while hiding coding-only configuration and test cases.
- Exam creation and editing includes a password-protection toggle.
- Password-protected exams show a lock badge in the teacher exam list.
- Question creation includes a language selector (`Java` or `Python`).
- Test-case creation is split between:
  - Standard input and expected standard output for `STDIN_STDOUT` questions.
  - Method arguments and expected return value for `JAVA_CLASS_METHOD` questions.
- Expected answers are required. The teacher UI warns when a question has no test cases or a test case has no expected answer.
- The submissions dashboard now shows grading errors and detailed test diagnostics: input, expected output, actual output, awarded points, test weight, stderr, and compile output.
- Teachers can re-grade a submission directly from the dashboard. Re-grading is disabled while a submission is queued or running.

### Persistence and Demo Behavior

The demo frontend now persists its state in `localStorage`:

| Key | Data |
|---|---|
| `lan_exam_user` | Signed-in demo user |
| `lan_exam_passwords` | Demo exam passwords |
| `lan_exam_exams_v1` | Exams |
| `lan_exam_questions_v1` | Questions |
| `lan_exam_test_cases_v1` | Test cases |
| `lan_exam_submissions_v1` | Submissions and grading results |

- Persisted exams, questions, test cases, and submissions survive page reloads and browser restarts.
- A submission saved as `queued` or `running` is converted to `error` on load with an interrupted-grading message.
- Clearing site data resets the frontend to the bundled demo data.

### Backend Changes

- Multiple-choice options and answer keys use validated arrays. Student question responses include the options and selection mode but omit both multiple-choice and short-answer keys; the owning teacher can still edit and inspect them.
- Objective submissions are accepted without test cases or a programming language and are graded by the backend without invoking Piston. Multiple-choice grading requires the exact configured set and rejects duplicate or out-of-range selections.
- Lightweight SQLite migrations add the multiple-selection and result-visibility fields to existing question tables.
- Added exam password storage and verification:
  - `Exam.access_password_hash` stores a bcrypt hash.
  - `Exam.has_password` is exposed in exam responses.
  - `POST /exams/{exam_id}/verify-password` validates a password.
  - Exam create/update accepts `access_password`.
  - A lightweight startup migration adds `access_password_hash` to existing SQLite databases.
- Added teacher-only submission re-grading:
  - `POST /submissions/{submission_id}/regrade`
  - Clears old test results, score, error summary, and graded timestamp.
  - Sets the submission back to `queued`.
  - Rejects submissions that are already queued or running.
- Test cases must now include an expected answer:
  - `POST /test-cases` rejects blank `expected_output` with `422`.
  - The grading service fails a submission with a clear error when any test case lacks an expected answer.
- Result payloads now include:
  - `is_sample`
  - `input_data`
  - `expected_output`
  - `score_weight`
  - `awarded_points`
  - `message`
- Student result responses hide hidden-test input, expected output, stdout, stderr, and compile output. Hidden tests still report verdict and awarded points.
- Exam result responses include detailed test data for teachers.
- Added backend tests for password lifecycle, re-grading, missing test-case answers, and permission checks.

### Compatibility Notes

- Existing SQLite databases are upgraded automatically with `access_password_hash`; existing exams remain open until a password is set.
- Existing test cases with blank expected answers must be fixed before grading, otherwise submissions will fail with a grading error.
- API clients creating test cases must now send a non-blank `expected_output`.
- Only the teacher who owns the exam can re-grade its submissions; other teachers receive `403`.
- The demo frontend uses new `localStorage` keys. Clearing site data resets the demo to bundled data.

## Routes

| Route | Audience | Purpose |
|---|---|---|
| `/login` | All | Demo sign-in; no real password check |
| `/dashboard` | Student | Exam selection dashboard and secure exam launcher |
| `/student/exams` | Student | Exam list |
| `/student/exams/[examId]` | Student / Teacher preview | Secure exam room |
| `/student/submissions` | Student | My Test Results |
| `/student/results/[examId]` | Student | Overall test result and per-question scores |
| `/student/submissions/[submissionId]` | Student / Teacher | Question score and test-case detail |
| `/teacher/server/submissions` | Teacher | Live submissions, diagnostics, and re-grading |
| `/teacher/server/monitoring` | Teacher | Realtime student monitoring |
| `/teacher/exams` | Teacher | Exam management and password protection |
| `/teacher/exams/[examId]/questions` | Teacher | Questions and test cases |
| `/teacher/announcements` | Teacher | Announcements |

## New and Notable Files

| File | Purpose |
|---|---|
| `frontend/lib/exam-results.ts` | Builds exam-level results from per-question submissions |
| `frontend/app/student/results/[id]/page.tsx` | Exam result detail page |
| `frontend/lib/grading.ts` | Browser-side demo grading logic |
| `frontend/components/exam/ExamPasswordGate.tsx` | Exam password prompt |
| `frontend/components/exam/ExamWindowGuard.tsx` | Fullscreen and proctoring-warning flow |
| `frontend/components/exam/QuestionSidebar.tsx` | Collapsible question navigator |
| `frontend/components/exam/SubmitReviewModal.tsx` | Final test submission review |
| `backend/tests/test_exam_password.py` | Exam password lifecycle tests |
| `backend/tests/test_regrade.py` | Re-grade and expected-answer tests |

The largest modifications are in `frontend/app/student/exams/[id]/page.tsx`, `frontend/lib/socket-context.tsx`, `frontend/app/teacher/exams/[id]/questions/page.tsx`, `frontend/app/teacher/server/submissions/page.tsx`, `backend/app/api/exams.py`, `backend/app/api/results.py`, `backend/app/api/submissions.py`, and `backend/app/services/grading_service.py`.

## Getting Started

### Prerequisites

- Windows with PowerShell
- Python 3.11+
- Node.js 18+
- Docker Desktop for Piston (required for real backend grading)

### 1. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item ..\.env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API documentation is available at `http://localhost:8000/docs`.

### 2. Piston

```powershell
docker compose -f deploy/piston/docker-compose.yml up -d
```

Piston must be running at `http://127.0.0.1:2000`, and the Java runtime must be installed before submissions can be graded. See the Piston section in [`docs/README_LAN_Programming_Exam_System.md`](docs/README_LAN_Programming_Exam_System.md).

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

### Demo Login

The frontend uses demo authentication:

- Student: `student_john` / `password123`
- Teacher: `prof_alan` / `password123`
- Anything else is rejected with an on-screen login failure message.

## Verification

Frontend:

```powershell
cd frontend
npx tsc --noEmit
npm run build
```

Backend, using an isolated test database:

```powershell
cd backend
$env:DATABASE_URL="sqlite:///./data/test_verify.db"
python -m pytest tests -q
Remove-Item .\data\test_verify.db* -ErrorAction SilentlyContinue
```

Latest verified result: **38 backend tests passed**, frontend TypeScript check passed, and the Next.js production build succeeded with the new `/student/results/[id]` route.

## Important Notes

- The frontend is still a demo/mock application. It does not call the FastAPI backend yet. Exams, questions, test cases, and submissions are stored in the browser.
- The browser grading logic is a deterministic heuristic for the seeded practice questions (reverse words, calculator, prime factors). It is **not** real code execution and does not grade arbitrary custom questions.
- The demo exam passwords are stored in browser `localStorage`; the backend stores only a bcrypt hash.
- Hidden-test input and expected output are withheld from student result views, but verdicts and awarded points are shown.
- The real grading worker requires Piston. Do not expose Piston's API to student devices; keep it bound to localhost.
- Backend tests create persistent users in the configured database. Use a unique `DATABASE_URL` for clean test runs.

## Related Documentation

- [`docs/README_LAN_Programming_Exam_System.md`](docs/README_LAN_Programming_Exam_System.md) - Project requirements and architecture
- [`docs/backend-code-reference.md`](docs/backend-code-reference.md) - Backend implementation reference
- [`docs/SubmissionGradingTestTutorial.md`](docs/SubmissionGradingTestTutorial.md) - Grading test tutorial
- [`java-socket-server/README.md`](java-socket-server/README.md) - Java socket server notes
