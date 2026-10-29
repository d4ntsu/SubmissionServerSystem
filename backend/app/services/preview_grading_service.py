"""Run the real grader for a teacher's exam preview without persisting submissions."""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.question import Question, QuestionType
from app.models.submission import Submission, SubmissionStatus, SubmissionTestResult
from app.models.test_case import TestCase
from app.services.grading_service import _grade_stdio
from app.services.java_method_grader import grade_java_method
from app.services.piston_client import PistonClientError

logger = logging.getLogger(__name__)


@dataclass
class PreviewGradeOutcome:
    submission: Submission
    test_cases: list[TestCase]
    results: list[SubmissionTestResult]


class _PreviewSession:
    """Collect test-result rows so the grader can run without a database write."""

    def __init__(self) -> None:
        self.added: list[SubmissionTestResult] = []

    def add(self, record: SubmissionTestResult) -> None:
        self.added.append(record)

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass


def _mark_error(submission: Submission, message: str) -> None:
    submission.status = SubmissionStatus.error
    submission.score = None
    submission.error_summary = message
    submission.graded_at = datetime.now(timezone.utc)


async def grade_question_preview(
    db: Session,
    question: Question,
    language: str,
    source_code: str,
) -> PreviewGradeOutcome:
    """Grade one question's code against its real test cases, in memory only."""
    submission = Submission(
        id=0,
        student_id=0,
        question_id=question.id,
        language=language.casefold(),
        source_code=source_code,
        status=SubmissionStatus.running,
        max_score=question.max_score,
    )
    test_cases = (
        db.query(TestCase)
        .filter(TestCase.question_id == question.id)
        .order_by(TestCase.id)
        .all()
    )
    collector = _PreviewSession()

    if not test_cases:
        if question.question_type == QuestionType.multiple_choice:
            _grade_mc_preview(submission, question)
            return PreviewGradeOutcome(submission, test_cases, collector.added)
        if question.question_type == QuestionType.short_answer:
            _grade_sa_preview(submission, question)
            return PreviewGradeOutcome(submission, test_cases, collector.added)
        _mark_error(submission, "No test cases configured for this question")
        return PreviewGradeOutcome(submission, test_cases, collector.added)

    allowed_languages = {
        item.strip().casefold()
        for item in (question.allowed_languages or "").split(",")
        if item.strip()
    }
    if allowed_languages and language.casefold() not in allowed_languages:
        _mark_error(
            submission,
            f"Language '{language}' is not allowed for this question. "
            f"Allowed: {', '.join(sorted(allowed_languages))}",
        )
        return PreviewGradeOutcome(submission, test_cases, collector.added)

    if question.question_type == QuestionType.stdio:
        missing_answers = [
            index
            for index, test_case in enumerate(test_cases, start=1)
            if not (test_case.expected_output or "").strip()
        ]
        if missing_answers:
            missing_list = ", ".join(f"#{index}" for index in missing_answers)
            _mark_error(
                submission,
                f"Test case {missing_list} has no expected answer configured; "
                "the code cannot be graded logically.",
            )
            return PreviewGradeOutcome(submission, test_cases, collector.added)

        try:
            await _grade_stdio(
                collector,  # type: ignore[arg-type]
                submission,
                question,
                test_cases,
                publish_event=False,
            )
        except PistonClientError as exc:
            _mark_error(submission, f"Piston error: {exc}")
        except Exception:
            logger.exception("Preview grading failed for question %s", question.id)
            _mark_error(submission, "Internal grading error")
    elif question.question_type == QuestionType.java_class:
        try:
            await grade_java_method(
                collector,  # type: ignore[arg-type]
                submission,
                question,
                test_cases,
            )
        except PistonClientError as exc:
            _mark_error(submission, f"Piston error: {exc}")
        except Exception:
            logger.exception("Preview grading failed for question %s", question.id)
            _mark_error(submission, "Internal grading error")
    else:
        _mark_error(submission, "Unsupported question type")

    return PreviewGradeOutcome(submission, test_cases, collector.added)


def _grade_mc_preview(
    submission: Submission,
    question: Question,
) -> None:
    """Grade a multiple-choice answer in preview (no db writes, no events)."""
    if not question.mc_options or not question.mc_correct_answers:
        _mark_error(submission, "No correct answers configured for this question")
        return

    def decode_values(raw: str, separator: str) -> list:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = raw.splitlines() if separator == "\n" else raw.replace(";", ",").split(",")
        if isinstance(parsed, list):
            return parsed
        raise ValueError("Invalid answer format")

    try:
        options = decode_values(question.mc_options, "\n")
        correct_answers = decode_values(question.mc_correct_answers, ",")
        if (
            not all(isinstance(opt, str) and opt.strip() for opt in options)
            or not all(isinstance(ans, str) for ans in correct_answers)
        ):
            raise ValueError("Invalid multiple-choice configuration")
    except (ValueError, TypeError):
        _mark_error(submission, "Invalid correct answers configuration")
        return

    valid_letters = {chr(ord("A") + idx) for idx in range(len(options))}
    normalized_correct = [ans.strip().upper() for ans in correct_answers]
    if (
        len(options) < 2
        or not normalized_correct
        or len(normalized_correct) != len(set(normalized_correct))
        or any(ans not in valid_letters for ans in normalized_correct)
        or (not question.mc_allow_multiple and len(normalized_correct) != 1)
    ):
        _mark_error(submission, "Invalid correct answers configuration")
        return

    student_answer_raw = (submission.source_code or "").strip()
    try:
        student_answers = decode_values(student_answer_raw, ",") if student_answer_raw else []
        if not all(isinstance(ans, str) for ans in student_answers):
            raise ValueError("Invalid answer")
    except (ValueError, TypeError):
        student_answers = []

    normalized_student = [ans.strip().upper() for ans in student_answers]
    passed = (
        bool(normalized_student)
        and len(normalized_student) == len(set(normalized_student))
        and all(ans in valid_letters for ans in normalized_student)
        and (question.mc_allow_multiple or len(normalized_student) == 1)
        and sorted(normalized_student) == sorted(normalized_correct)
    )

    submission.status = SubmissionStatus.completed
    submission.score = question.max_score if passed else 0.0
    submission.graded_at = datetime.now(timezone.utc)


def _grade_sa_preview(
    submission: Submission,
    question: Question,
) -> None:
    """Grade a short-answer by case-insensitive comparison (no db writes, no events)."""
    if not question.short_answer:
        _mark_error(submission, "No expected answer configured for this question")
        return

    student_answer = (submission.source_code or "").strip()
    expected_answer = question.short_answer.strip()
    passed = student_answer.lower() == expected_answer.lower()

    submission.status = SubmissionStatus.completed
    submission.score = question.max_score if passed else 0.0
    submission.graded_at = datetime.now(timezone.utc)