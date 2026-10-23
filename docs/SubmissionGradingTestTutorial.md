Here are the ways to test the Phase 3 submission & grading pipeline:

---

## 1. Run the automated test suite

From the `backend` directory:

```powershell
D:\CodeProjects\SubmissionServerSystem\backend\.venv311\Scripts\python.exe -m pytest tests\ -v
```

This runs all 32 tests, including the 17 new ones covering:
- Submission validation (exam status, deadlines, language restrictions, role checks)
- Submission ownership (students can't see each other's code)
- Grading logic (full pass, partial score, compile errors, Piston failures)

---

## 2. Manual end-to-end test

Start the server (it launches the grading worker automatically):

```powershell
cd D:\CodeProjects\SubmissionServerSystem\backend
.\.venv311\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then in a separate terminal, run through the full flow:


### Step A — Create a teacher and student, log in

```powershell
# ===== STEP A: Register & Login =====
$body = @{username="teacher1"; password="pass123"; full_name="Teacher One"; role="teacher"} | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/auth/register' -Method Post -Body $body -ContentType 'application/json' | Out-Null

$body = @{username="student1"; password="pass123"; full_name="Student One"; role="student"} | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/auth/register' -Method Post -Body $body -ContentType 'application/json' | Out-Null

$body = @{username="teacher1"; password="pass123"} | ConvertTo-Json
$teacherTok = (Invoke-RestMethod -Uri 'http://127.0.0.1:8000/auth/login' -Method Post -Body $body -ContentType 'application/json').access_token

$body = @{username="student1"; password="pass123"} | ConvertTo-Json
$studentTok = (Invoke-RestMethod -Uri 'http://127.0.0.1:8000/auth/login' -Method Post -Body $body -ContentType 'application/json').access_token

Write-Output "Tokens obtained"

# ===== STEP B: Create exam, question, test cases =====
$body = @{title="Java Sum Exam"; duration_minutes=60} | ConvertTo-Json
$examId = (Invoke-RestMethod -Uri 'http://127.0.0.1:8000/exams' -Method Post -Body $body -ContentType 'application/json' -Headers @{Authorization="Bearer $teacherTok"}).id

$body = @{status="published"} | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8000/exams/$examId" -Method Put -Body $body -ContentType 'application/json' -Headers @{Authorization="Bearer $teacherTok"} | Out-Null

$body = @{status="started"} | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8000/exams/$examId" -Method Put -Body $body -ContentType 'application/json' -Headers @{Authorization="Bearer $teacherTok"} | Out-Null

$body = @{exam_id=$examId; title="Add Two Numbers"; description="Read two ints, print sum"; max_score=100.0; allowed_languages="java"} | ConvertTo-Json
$qId = (Invoke-RestMethod -Uri 'http://127.0.0.1:8000/questions' -Method Post -Body $body -ContentType 'application/json' -Headers @{Authorization="Bearer $teacherTok"}).id

$body = @{question_id=$qId; input_data="3 4"; expected_output="7"; score_weight=1.0} | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/test-cases' -Method Post -Body $body -ContentType 'application/json' -Headers @{Authorization="Bearer $teacherTok"} | Out-Null

$body = @{question_id=$qId; input_data="10 20"; expected_output="30"; score_weight=1.0} | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/test-cases' -Method Post -Body $body -ContentType 'application/json' -Headers @{Authorization="Bearer $teacherTok"} | Out-Null

Write-Output "Exam $examId, Question $qId ready"

# ===== STEP C: Submit & check results =====
$code = @'
import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt();
        int b = sc.nextInt();
        System.out.println(a + b);
    }
}
'@

$body = @{question_id=$qId; language="java"; source_code=$code} | ConvertTo-Json
try {
    $sub = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/submissions' -Method Post -Body $body -ContentType 'application/json' -Headers @{Authorization="Bearer $studentTok"}
    Write-Output "Submission id=$($sub.id), status=$($sub.status)"
} catch {
    Write-Output "SUBMIT FAILED: $($_.Exception.Message)"
    Write-Output "Response: $($_.ErrorDetails.Message)"
    exit
}

# Wait for grading
Start-Sleep -Seconds 5

$result = Invoke-RestMethod -Uri "http://127.0.0.1:8000/submissions/$($sub.id)" -Headers @{Authorization="Bearer $studentTok"}
Write-Output "Status: $($result.status), Score: $($result.score)"

$detail = Invoke-RestMethod -Uri "http://127.0.0.1:8000/results/$($sub.id)" -Headers @{Authorization="Bearer $studentTok"}
$detail.test_results | Format-Table test_case_id, passed, stdout
```

---

## 3. What to expect

| Scenario | Expected |
|----------|----------|
| Correct code, all tests pass | `status=completed`, `score=100.0` |
| Wrong output on some tests | `status=completed`, proportional score (e.g. 50.0) |
| Code with syntax error | `status=completed`, `score=0.0` (compile failed) |
| Submit to draft exam | `400 Bad Request` — "Exam is not currently active" |
| Submit unsupported language | `400 Bad Request` — "not allowed" |
| Student views another's submission | `404 Not Found` |
| Piston is down | `status=error`, `error_summary` contains "Piston error" |

---

## 4. Quick smoke test (one-liner)

If you just want to verify the pipeline works end-to-end without setting up all the data manually, the automated tests already cover it:

```powershell
D:\CodeProjects\SubmissionServerSystem\backend\.venv311\Scripts\python.exe -m pytest tests\test_submission_api.py tests\test_grading_service.py -v
```

This runs 13 tests that mock Piston and validate every code path — submission validation, grading logic, error handling — without needing Piston running.