import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.question import Question, QuestionType
from app.models.submission import (
    Submission,
    SubmissionStatus,
    SubmissionTestResult,
)
from app.models.test_case import TestCase
from app.services.java_method_grader import build_method_harness
from app.services.piston_client import PistonClient, PistonClientError
from app.realtime.submission_events import publish_submission_event

logger = logging.getLogger(__name__)


async def grade_submission(submission_id: int) -> None:
    """Grade a single submission against all its question's test cases.

    Uses its own database session so it never shares state with HTTP request handlers.
    On any failure the submission is marked as 'error' with a summary message.
    """
    db = SessionLocal()
    try:
        submission = db.get(Submission, submission_id)
        if not submission:
            logger.error("Submission %d not found; skipping", submission_id)
            return
        if submission.status != SubmissionStatus.running:
            logger.warning(
                "Submission %d is %s, not running; skipping", submission_id, submission.status.value
            )
            return

        question = db.get(Question, submission.question_id)
        if not question:
            await _fail_submission(db, submission, "Question not found")
            return

        test_cases = (
            db.query(TestCase)
            .filter(TestCase.question_id == question.id)
            .order_by(TestCase.id)
            .all()
        )
        if not test_cases:
            await _fail_submission(db, submission, "No test cases configured for this question")
            return

        missing_answers = [
            index
            for index, test_case in enumerate(test_cases, start=1)
            if not (test_case.expected_output or "").strip()
        ]
        if missing_answers:
            missing_list = ", ".join(f"#{index}" for index in missing_answers)
            await _fail_submission(
                db,
                submission,
                f"Test case {missing_list} has no expected answer configured; "
                "the submission cannot be graded logically.",
            )
            return

        if question.question_type == QuestionType.stdio:
            await _grade_stdio(db, submission, question, test_cases)
        elif question.question_type == QuestionType.java_class:
            await _grade_java_method(db, submission, question, test_cases)
        else:
            await _fail_submission(db, submission, "Unsupported question type")

    except ValueError as exc:
        await _fail_submission(db, submission, str(exc))
    except PistonClientError as exc:
        await _fail_submission(db, submission, f"Piston error: {exc}")
    except Exception:
        logger.exception("Unexpected error grading submission %d", submission_id)
        await _fail_submission(db, submission, "Internal grading error")
    finally:
        db.close()


async def _grade_stdio(
    db: Session,
    submission: Submission,
    question: Question,
    test_cases: list[TestCase],
) -> None:
    total_weight = sum(tc.score_weight for tc in test_cases) or 1.0
    earned_weight = 0.0
    compile_failed = False

    async with PistonClient() as piston:
        for tc in test_cases:
            if compile_failed:
                _create_test_result(db, submission, tc, passed=False, compile_output="Compilation failed")
                continue

            try:
                result = await piston.execute(
                    language=submission.language,
                    files=[
                        {
                            "name": "Main.py" if submission.language == "python" else "Main.java",
                            "content": submission.source_code,
                        }
                    ],
                    stdin=tc.input_data,
                )
            except PistonClientError:
                raise

            if (
                result.run.code is None
                and result.run.signal is None
                and not result.run.stdout
                and not result.run.stderr
                and not result.run.output
                and not (result.compile and result.compile.code not in (None, 0))
            ):
                logger.warning(
                    "Piston returned an empty execution result for submission %d, "
                    "test case %d; retrying once",
                    submission.id,
                    tc.id,
                )
                result = await piston.execute(
                    language=submission.language,
                    files=[
                        {
                            "name": "Main.py" if submission.language == "python" else "Main.java",
                            "content": submission.source_code,
                        }
                    ],
                    stdin=tc.input_data,
                )

            compile_stderr = ""
            if result.compile and result.compile.code != 0:
                compile_failed = True
                compile_stderr = result.compile.stderr or result.compile.output or "Compilation error"
                _create_test_result(
                    db, submission, tc, passed=False, compile_output=compile_stderr
                )
                continue

            if result.run.code != 0:
                runtime_error = result.run.stderr or result.run.output
                if not runtime_error:
                    runtime_error = (
                        f"Program terminated by {result.run.signal}."
                        if result.run.signal
                        else "Execution did not return an exit code or output after retrying."
                    )
                _create_test_result(
                    db,
                    submission,
                    tc,
                    passed=False,
                    stdout=result.run.stdout,
                    stderr=runtime_error,
                    exit_code=result.run.code,
                )
                continue

            actual = (result.run.stdout or "").strip()
            expected = (tc.expected_output or "").strip()
            passed = actual == expected

            _create_test_result(
                db,
                submission,
                tc,
                passed=passed,
                stdout=result.run.stdout,
                stderr=result.run.stderr,
                exit_code=result.run.code,
            )

            if passed:
                earned_weight += tc.score_weight

    score = (earned_weight / total_weight) * question.max_score
    submission.status = SubmissionStatus.completed
    submission.score = round(score, 2)
    submission.graded_at = datetime.now(timezone.utc)
    db.commit()
    await publish_submission_event("submission.completed", submission.id)


async def _grade_java_method(
    db: Session,
    submission: Submission,
    question: Question,
    test_cases: list[TestCase],
) -> None:
    total_weight = sum(tc.score_weight for tc in test_cases) or 1.0
    earned_weight = 0.0

    async with PistonClient() as piston:
        for test_case in test_cases:
            student_file, harness, stdin = build_method_harness(question, test_case)
            result = await piston.execute(
                language="java",
                files=[
                    {"name": student_file, "content": submission.source_code},
                    {"name": "Main.java", "content": harness},
                ],
                stdin=stdin,
            )

            compile_output = ""
            if result.compile and result.compile.code != 0:
                compile_output = result.compile.stderr or result.compile.output or "Compilation error"
                _create_test_result(
                    db,
                    submission,
                    test_case,
                    passed=False,
                    compile_output=compile_output,
                )
                continue

            actual = (result.run.stdout or "").strip()
            expected = (test_case.expected_output or "").strip()
            passed = result.run.code == 0 and actual == expected
            _create_test_result(
                db,
                submission,
                test_case,
                passed=passed,
                stdout=result.run.stdout,
                stderr=result.run.stderr,
                exit_code=result.run.code,
            )
            if passed:
                earned_weight += test_case.score_weight

    submission.status = SubmissionStatus.completed
    submission.score = round((earned_weight / total_weight) * question.max_score, 2)
    submission.graded_at = datetime.now(timezone.utc)
    db.commit()
    await publish_submission_event("submission.completed", submission.id)


def _create_test_result(
    db: Session,
    submission: Submission,
    test_case: TestCase,
    *,
    passed: bool,
    stdout: str = "",
    stderr: str = "",
    compile_output: str = "",
    exit_code: int | None = None,
) -> None:
    db.add(
        SubmissionTestResult(
            submission_id=submission.id,
            test_case_id=test_case.id,
            passed=1 if passed else 0,
            stdout=stdout,
            stderr=stderr,
            compile_output=compile_output,
            exit_code=exit_code,
        )
    )
    db.commit()


async def _fail_submission(db: Session, submission: Submission, message: str) -> None:
    try:
        submission.status = SubmissionStatus.error
        submission.error_summary = message
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to persist error status for submission %d", submission.id)
        return
    await publish_submission_event("submission.error", submission.id)
