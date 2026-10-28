# Student Exam List Data-Flow Audit

## Scope and finding

The current student exams page does not declare a variable named
`activeExams`. It reads `exams` from `useSocket()` and derives a local
`filtered` array for search/status filters. The cards are rendered from
`filtered`.

In normal authenticated use, the list is loaded from the backend HTTP
`GET /exams` endpoint through `fetchExams()`. The context initially contains
bundled demo exams and can hydrate cached exam state from `localStorage`, but
when an access token becomes available the backend-loading effect first clears
that state. A successful response, including an empty array, replaces it.
Request failures also clear it and expose an error with a retry action; they do
not fall back to `MOCK_EXAMS`.

There is no exam-list WebSocket feed in the inspected frontend path. The
`SocketProvider` name does not mean this list is populated by socket messages.

## Data flow, in order

### 1. Root layout provides auth and shared context

[`frontend/app/layout.tsx`](./frontend/app/layout.tsx), lines 20-24, nests
`SocketProvider` inside `AuthProvider`. The shared provider reads the current
access token from `useAuth()`.

```tsx
<AuthProvider>
  <SocketProvider>{children}</SocketProvider>
</AuthProvider>
```

In [`frontend/lib/socket-context.tsx`](./frontend/lib/socket-context.tsx),
line 111, `SocketProvider` reads `{ token } = useAuth()`.

### 2. Context initializes demo state, then may hydrate a local cache

In `socket-context.tsx`:

- Lines 130-131 initialize `exams` with `MOCK_EXAMS`.
- Lines 102-103 define the cache key `lan_exam_exams_v1`.
- Lines 149-156 read that key and, when it parses as an array, replace the
  initial exam state with the cached array.
- Lines 201-205 catch storage/JSON errors. On corrupted storage, the catch
  leaves the bundled initial demo state in place.

```tsx
const [exams, setExams] = useState<Exam[]>(MOCK_EXAMS);
...
const storedExams = window.localStorage.getItem(STORAGE_KEYS.exams);
if (storedExams) {
  const parsed = JSON.parse(storedExams);
  if (Array.isArray(parsed)) setExams(parsed);
}
```

The provider persists its current exam state back to the same key at lines
258-261:

```tsx
if (!storageReady || typeof window === "undefined") return;
window.localStorage.setItem(STORAGE_KEYS.exams, JSON.stringify(exams));
```

Consequently, a prior demo/cached list can exist during provider initialization;
the cache is not the final source for a verified backend session.

### 3. Verified access token triggers backend loading

`frontend/lib/auth-context.tsx`, lines 64-85, restores a session by calling
`refreshAccessToken()`, verifies the returned access token with
`fetchCurrentUser()`, and only then sets the user and ends auth loading.

In `socket-context.tsx`, lines 208-256, an effect responds to `token`:

- Without a token, it clears the API error and returns; it does not clear the
  current exam state in that branch.
- With a token, lines 215-218 clear the error and immediately set exams,
  questions, and test cases to empty state.
- Line 222 calls `fetchExams(token)`.
- Lines 226-233 load questions and test cases for each returned exam.
- Lines 235-239 set the resulting backend exams and related data, unless the
  request has been cancelled by a token/retry change.
- On failure, lines 240-250 clear those data states and store an error message.

```tsx
if (!token) {
  setDataApiError(null);
  return;
}
...
setExams([]);
...
const realExams = await fetchExams(token);
...
setExams(realExams);
...
setExams([]);
setDataApiError(error instanceof Error ? error.message : ...);
```

The `retryExamData` context value increments `examDataRetryCount` at line 1140,
which reruns this effect. The provider renders the API error and a Retry button
at lines 1158-1168.

### 4. API helper requests HTTP data without a mock fallback

`frontend/lib/api.ts` defines `MOCK_EXAMS` at lines 250-284; that export is used
as the context's initial state. The fetch helper is separate, at lines
805-819:

```ts
const res = await authenticatedFetch(`${API_BASE_URL}/exams`, ...);
if (!res.ok) throw httpError("Loading exams", res);
const data: unknown = await readJson(res, "Loading exams");
if (!Array.isArray(data)) {
  throw new ApiError("Loading exams returned an invalid response.", ...);
}
return data as Exam[];
```

`authenticatedFetch` (lines 155-187) sends the in-memory bearer access token,
includes credentials, and attempts one shared refresh/retry after HTTP 401.
`fetchExams()` propagates HTTP/invalid-response errors and converts network
failures to `ApiError`; it does not return `MOCK_EXAMS` on any failure.

### 5. Page derives and renders the list

In [`frontend/app/student/exams/page.tsx`](./frontend/app/student/exams/page.tsx):

- Lines 20-23 read `exams` from `useSocket()`.
- Lines 43-51 derive `filtered` by applying the user's search and status
  filters.
- Line 103 maps `filtered` to exam cards.

```tsx
const { exams } = useSocket();
...
const filtered = exams.filter((exam) => ...);
...
{filtered.map((exam) => { ... })}
```

There is no `activeExams` identifier in the current page file. The current
equivalent data used for display is `filtered`.

The page is wrapped in `ProtectedRoute`. In
[`frontend/components/auth/ProtectedRoute.tsx`](./frontend/components/auth/ProtectedRoute.tsx),
lines 25-43, auth loading displays a verification screen, and unauthenticated
users get no protected page content and are redirected. This normally prevents
the initial unauthenticated mock state from being shown on this page.

## Socket and cache findings

The inspected frontend `socket-context.tsx` contains no `WebSocket` creation,
socket event subscription, or exam-created/updated/deleted socket handler.
Its `storage` event listener at lines 286-299 handles only the event-log
storage key, not exams. The list is therefore not sourced from exam socket
events.

The list can still be changed locally by context management operations (for
example, `createExam`, `updateExam`, status changes, and deletion around lines
474-606). These are local React state mutations used by the shared teacher UI;
they are not socket-delivered exam updates. The student's normal list load
after a verified token is the HTTP flow described above.

## Empty response and failure behavior

| Condition | State/result | Can this path fall back to mock exams? |
|---|---|---|
| Backend returns a valid non-empty array | Context stores that array; page filters and renders it. | No. |
| Backend returns valid `[]` | Context stores `[]`; the page maps zero cards. No dedicated empty-list message is present in this page. | No. |
| `/exams` or a related question/test-case request fails | Context catch sets exam state to `[]` and exposes an API error/retry control. | No. |
| No token | Data-loading effect returns without replacing current state. ProtectedRoute normally hides the page because there is no verified authenticated session. | The provider state may still contain its initial demo or cached values, but normal protected page content is not rendered. |
| Storage has a valid cached array or malformed JSON | A valid array is initially hydrated; malformed storage leaves initial `MOCK_EXAMS`. Once a token exists, the token effect clears state before fetching. | Demo/cache state exists during initialization; normal authenticated steady-state is replaced by the HTTP result. |

## Conclusion

**The intended authenticated student exam list is backend HTTP data, not socket
data.** Empty backend results remain empty, and API errors clear the list and
show a retryable error rather than showing mock exams.

Bundled mock exams are present as the provider's initial state, and localStorage
can temporarily hydrate a cached list. A missing token also leaves the current
provider state untouched. However, the page's authentication guard hides its
children while authentication is being checked and when the user is
unauthenticated. On token availability, the data effect clears the old state
before its request. Thus the source contains mock/cache state, but it does not
intentionally use it as an API-error fallback for an authenticated student.

## Runtime verification not performed

This is a source audit; no browser session or API server was run. To confirm
render timing in the actual deployment, inspect the student page with:

1. A fresh browser profile with no `lan_exam_exams_v1` entry.
2. A profile containing a cached/demo `lan_exam_exams_v1` entry.
3. A delayed or unavailable `/exams` endpoint.
4. An endpoint returning HTTP 200 with `[]`.

Observe whether any cached/demo card is painted after authentication completes,
and verify the error/retry UI for failure and the blank card grid for a valid
empty response. The code indicates the list is cleared when the token effect
runs, but exact first-paint timing with the actual browser/network should be
confirmed at runtime.
