# Exam UI Empty States and Mock-Data Audit

## Summary

The Teacher Exam Management page and Student Exam Dashboard both read their
exam arrays from `useSocket()` (the shared `SocketProvider` context). Although
the provider initially seeds exams and questions with bundled demo data and
hydrates exam/question caches from `localStorage`, authenticated data loading
clears those values before requesting the backend. The UI now has an explicit
load state and does not render these seeded/cached lists while the backend
request is pending, after it fails, or while a retry is pending.

A successful `200` with `[]` is stored as an empty list and rendered with
user-facing empty states. Fetch errors remain errors, clear the list, and
continue to expose the provider's retry action; they are not treated as an
empty success or replaced with bundled exams.

The teacher question workbench uses the same context and additionally fetches
questions/test cases for each exam over HTTP. Its empty-question prompt is now
shown only after a successful load for a real exam. The page no longer
substitutes the first exam in the context when the requested exam id is absent.

No exam-list WebSocket feed was found in the inspected frontend path.

## Data flow and evidence

### Shared provider, mock initialization, and browser cache

[`frontend/app/layout.tsx`](./frontend/app/layout.tsx), lines 20-24, wraps the
application in `AuthProvider` and then `SocketProvider`. The provider reads
the access token from auth state in
[`frontend/lib/socket-context.tsx`](./frontend/lib/socket-context.tsx), line
111.

`socket-context.tsx` lines 131-132 initialize the shared arrays:

```tsx
const [exams, setExams] = useState<Exam[]>(MOCK_EXAMS);
const [questions, setQuestions] = useState<Record<number, Question[]>>(MOCK_QUESTIONS);
```

The mock definitions are in
[`frontend/lib/api.ts`](./frontend/lib/api.ts), lines 250-284 (`MOCK_EXAMS`)
and lines 289 onward (`MOCK_QUESTIONS`). The `MOCK_QUESTIONS` definition
continues after line 289.

The provider's `STORAGE_KEYS.exams` and `STORAGE_KEYS.questions` are defined
at `socket-context.tsx` lines 102-104. On initialization, lines 153-209 read
`lan_exam_exams_v1` and `lan_exam_questions_v1`; valid parsed values are put
into React state. If storage parsing fails, the catch leaves the seeded demo
state in place. Lines 267-277 persist the current arrays back to localStorage
once storage initialization completes.

The new `isLoadingExamData` state is declared at
`socket-context.tsx` line 146, initialized to `true`, and exposed through the
context at line 1151. The teacher and student list pages use it to hide their
exam arrays and counts until the data load has completed.

### Authenticated backend load and error handling

In `socket-context.tsx`, lines 213-261:

1. If there is no verified access token, the effect clears the API error,
   marks loading complete, and returns (lines 215-219). It does not fetch
   backend exam data in that branch.
2. With a token, it sets loading, clears the previous error, and clears exams,
   questions, and test cases before issuing requests (lines 221-228).
3. It calls `fetchExams(token)` (line 230), then
   `fetchQuestionsByExam(exam.id, token)` for every exam (line 235), followed
   by test-case requests for the returned questions (lines 236-238).
4. On success it stores exactly the backend exam array and related results
   (lines 243-247). A valid empty array therefore remains empty; the loops
   simply perform no question/test-case requests.
5. On any request failure, it clears all three data collections and stores an
   error (lines 249-257). It then ends loading in `finally` (lines 258-260).
6. Retry increments `examDataRetryCount` and sets loading again in the
   `retryExamData` callback at lines 150-153; the provider renders an alert and
   Retry button at lines 1171-1184.

`fetchExams()` in
[`frontend/lib/api.ts`](./frontend/lib/api.ts), lines 805-819, performs an
authenticated HTTP request to `${API_BASE_URL}/exams`, validates that the
response is an array, returns that array unchanged, and throws an `ApiError`
for HTTP, invalid-response, or network failures. It does not return
`MOCK_EXAMS` as a fallback.

`fetchQuestionsByExam()` starts at `api.ts` line 836 and likewise requests
backend question data and rejects non-array/error responses. Therefore a
question-fetch failure enters the shared provider's catch and clears the exam
and question arrays instead of leaving demo questions displayed.

### Teacher Exam Management page

[`frontend/app/teacher/exams/page.tsx`](./frontend/app/teacher/exams/page.tsx):

- Lines 31-42 obtain `exams`, `isLoadingExamData`, and `dataApiError` from
  `useSocket()`.
- Lines 69-73 derive the selected status filter and determine whether
  backend data is ready.
- Lines 169-190 show metrics only when data is ready; otherwise they show an
  em dash rather than seeded demo counts.
- Lines 224-273 render distinct table states:
  - loading while a request is pending;
  - an error-specific status when loading failed (the shared provider alert
    provides the retry button);
  - an empty-list message and “Create your first exam” action when the
    successful data array is empty;
  - a separate no-filter-match message when exams exist but none match the
    selected status;
  - exam rows only when data is ready.
- The header continues to provide the existing “Create New Examination”
  action.

### Student Exam Dashboard

[`frontend/app/dashboard/page.tsx`](./frontend/app/dashboard/page.tsx):

- Lines 22-24 obtain the shared exam state and loading/error flags.
- Lines 48-51 derive active, upcoming, and completed categories; category
  counts are hidden until backend data is ready.
- Lines 115-132 render loading, error, and empty states for active exams and
  render active cards only after a successful load.
- Lines 217-222 render upcoming rows or a successful-empty message.
- Lines 285-290 render completed rows or a successful-empty message.

For a successful empty backend list, the active section says no exams are
currently available and recommends checking again later. A failed request
shows an error-specific message and the shared retry alert, not an empty
success state.

### Teacher Question & Test Case workbench

[`frontend/app/teacher/exams/[id]/questions/page.tsx`](./frontend/app/teacher/exams/%5Bid%5D/questions/page.tsx):

- Lines 37-57 read `exams`, `questions`, and load/error status from context.
  The selected exam is now found by the requested id only; it no longer falls
  back to `exams[0]`.
- Lines 346-382 distinguish loading, API error, missing exam, successful
  empty-question list, and populated question list.
- The existing “No Questions Configured Yet” action remains for a successful
  empty question list on a loaded exam.

Questions begin as demo state and can be hydrated from `lan_exam_questions_v1`
in the shared provider, but with a verified token the provider clears them and
loads backend questions before exposing the workbench's empty/populated list.

## Local mutation and cache caveats

The exam and question mock definitions and localStorage persistence remain in
the application; they were not globally removed. Their impact on these
authenticated list pages is now gated during backend loading.

The shared provider has demo-mode local creation paths when there is no token.
For a token-authenticated teacher, the prior context behavior could fall back
to creating a local exam/question when the corresponding HTTP create helper
returned `null`. That would display an unsaved record after an API failure.
This was corrected in `socket-context.tsx` lines 484-522 (exam create) and
lines 618-674 (question create): authenticated create failure now throws
instead of inserting a local record. The teacher forms catch and display these
errors in `frontend/app/teacher/exams/page.tsx` lines 87-126 and
`frontend/app/teacher/exams/[id]/questions/page.tsx` lines 134-182.

Other edit/status/delete actions still update shared React state locally as
part of their existing optimistic behavior. Some existing API helpers return
failure indicators that those actions do not consistently surface or roll
back. This is not a mock-list fallback for initial load or a valid empty
response, but an edit request failure may leave an optimistic value visible
until a later successful reload. That behavior was not redesigned in this
task.

## Confirmed findings and remaining runtime uncertainty

### Confirmed by source inspection

- Both requested exam list pages get their arrays from `SocketProvider`, not
  directly from a page-local HTTP call.
- Backend exam fetch is HTTP through `fetchExams()`; it has no mock fallback.
- A valid empty response remains `[]`.
- Fetch failure clears exam/question data and exposes an error/retry control.
- Mock/cache list state is hidden while data is loading or failed.
- The teacher question list only shows its existing empty prompt after a
  successful load for the requested exam.
- No exam-list WebSocket event handler was found in the frontend provider.
- Authenticated exam/question create failures no longer insert local demo
  records.

### Requires runtime verification

No browser session or live backend response was exercised for these UI changes.
Verify manually with a teacher and student account for:

1. Delayed requests: loading messages should remain visible until all
   exam/question/test-case fetches complete.
2. HTTP `200` with `[]`: teacher should see the create-first-exam action;
   student should see the check-again-later message.
3. HTTP/network failure: the error message and shared Retry action should
   appear, with no mock exam cards/rows.
4. A prepopulated `lan_exam_exams_v1` / `lan_exam_questions_v1` cache: cached
   demo rows/questions should not be shown after verified backend loading
   starts or completes.
5. Failed authenticated exam/question create requests: the form should stay
   open and show its error without adding a local row/question.

Exact paint timing and browser storage contents can vary by session and should
be confirmed in the browser's Network and Application panels.
