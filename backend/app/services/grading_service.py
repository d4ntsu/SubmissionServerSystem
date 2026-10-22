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
from app.services.piston_client import PistonClient, PistonClientError

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
            _fail_submission(db, submission, "Question not found")
            return

        test_cases = (
            db.query(TestCase)
            .filter(TestCase.question_id == question.id)
            .order_by(TestCase.id)
            .all()
        )
        if not test_cases:
            _fail_submission(db, submission, "No test cases configured for this question")
            return

        if question.question_type == QuestionType.stdio:
            await _grade_stdio(db, submission, question, test_cases)
        else:
            _fail_submission(db, submission, "Java class/method grading is not yet implemented")

    except PistonClientError as exc:
        _fail_submission(db, submission, f"Piston error: {exc}")
    except Exception:
        logger.exception("Unexpected error grading submission %d", submission_id)
        _fail_submission(db, submission, "Internal grading error")
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
                    files=[{"name": "Main.java", "content": submission.source_code}],
                    stdin=tc.input_data,
                )
            except PistonClientError:
                raise

            compile_stderr = ""
            if result.compile and result.compile.code != 0:
                compile_failed = True
                compile_stderr = result.compile.stderr or result.compile.output or "Compilation error"
                _create_test_result(
                    db, submission, tc, passed=False, compile_output=compile_stderr
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


def _fail_submission(db: Session, submission: Submission, message: str) -> None:
    try:
        submission.status = SubmissionStatus.error
        submission.error_summary = message
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to persist error status for submission %d", submission.id)
