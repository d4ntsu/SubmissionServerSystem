from unittest.mock import AsyncMock, patch

import pytest

from app.models.question import Question, QuestionType
from app.models.submission import Submission, SubmissionStatus, SubmissionTestResult
from app.models.test_case import TestCase
from app.services.grading_service import grade_submission
from app.services.piston_client import PistonClientError, PistonExecutionResult, PistonStageResult


def _make_execution_result(stdout: str, stderr: str = "", exit_code: int = 0, compile_code: int = 0) -> PistonExecutionResult:
    return PistonExecutionResult(
        language="java",
        version="15.0.2",
        run=PistonStageResult(stdout=stdout, stderr=stderr, output=stdout, code=exit_code),
        compile=PistonStageResult(code=compile_code, stdout="", stderr="", output=""),
    )


@pytest.mark.asyncio
async def test_all_test_cases_pass():
    """When every test case matches, the submission gets full score."""
    with patch("app.services.grading_service.SessionLocal") as mock_session_cls, \
         patch("app.services.grading_service.PistonClient") as mock_piston_cls:

        mock_db = mock_session_cls.return_value
        mock_piston = mock_piston_cls.return_value.__aenter__.return_value

        question = Question(id=1, exam_id=1, question_type=QuestionType.stdio, max_score=100.0)
        submission = Submission(
            id=1, student_id=1, question_id=1, language="java",
            source_code="class Main {}", status=SubmissionStatus.running,
            max_score=100.0,
        )
        tc1 = TestCase(id=1, question_id=1, input_data="", expected_output="7", score_weight=1.0)
        tc2 = TestCase(id=2, question_id=1, input_data="3 4", expected_output="7", score_weight=1.0)

        mock_db.get.side_effect = lambda model, pk: {
            Submission: submission,
            Question: question,
        }.get(model)

        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [tc1, tc2]

        mock_piston.execute.side_effect = [
            _make_execution_result("7"),
            _make_execution_result("7"),
        ]

        await grade_submission(1)

        assert submission.status == SubmissionStatus.completed
        assert submission.score == 100.0
        assert mock_db.add.call_count >= 2  # two test results added
        mock_db.commit.assert_called()


@pytest.mark.asyncio
async def test_partial_score():
    """When some test cases fail, the score is proportional."""
    with patch("app.services.grading_service.SessionLocal") as mock_session_cls, \
         patch("app.services.grading_service.PistonClient") as mock_piston_cls:

        mock_db = mock_session_cls.return_value
        mock_piston = mock_piston_cls.return_value.__aenter__.return_value

        question = Question(id=1, exam_id=1, question_type=QuestionType.stdio, max_score=100.0)
        submission = Submission(
            id=1, student_id=1, question_id=1, language="java",
            source_code="class Main {}", status=SubmissionStatus.running,
            max_score=100.0,
        )
        tc1 = TestCase(id=1, question_id=1, input_data="", expected_output="7", score_weight=1.0)
        tc2 = TestCase(id=2, question_id=1, input_data="", expected_output="42", score_weight=1.0)

        mock_db.get.side_effect = lambda model, pk: {
            Submission: submission,
            Question: question,
        }.get(model)
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [tc1, tc2]

        mock_piston.execute.side_effect = [
            _make_execution_result("7"),    # passes
            _make_execution_result("99"),   # fails (expected 42)
        ]

        await grade_submission(1)

        assert submission.status == SubmissionStatus.completed
        assert submission.score == 50.0  # 1/2 * 100


@pytest.mark.asyncio
async def test_compile_error():
    """When compilation fails, all test cases are marked failed and status is error."""
    with patch("app.services.grading_service.SessionLocal") as mock_session_cls, \
         patch("app.services.grading_service.PistonClient") as mock_piston_cls:

        mock_db = mock_session_cls.return_value
        mock_piston = mock_piston_cls.return_value.__aenter__.return_value

        question = Question(id=1, exam_id=1, question_type=QuestionType.stdio, max_score=100.0)
        submission = Submission(
            id=1, student_id=1, question_id=1, language="java",
            source_code="broken code", status=SubmissionStatus.running,
            max_score=100.0,
        )
        tc1 = TestCase(id=1, question_id=1, input_data="", expected_output="7", score_weight=1.0)

        mock_db.get.side_effect = lambda model, pk: {
            Submission: submission,
            Question: question,
        }.get(model)
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [tc1]

        mock_piston.execute.return_value = PistonExecutionResult(
            language="java",
            version="15.0.2",
            run=PistonStageResult(code=None, stdout="", stderr="", output=""),
            compile=PistonStageResult(code=1, stdout="", stderr="syntax error", output="syntax error"),
        )

        await grade_submission(1)

        assert submission.status == SubmissionStatus.completed
        assert submission.score == 0.0


@pytest.mark.asyncio
async def test_piston_client_error():
    """When Piston is unreachable, the submission is marked as error."""
    with patch("app.services.grading_service.SessionLocal") as mock_session_cls, \
         patch("app.services.grading_service.PistonClient") as mock_piston_cls:

        mock_db = mock_session_cls.return_value
        mock_piston = mock_piston_cls.return_value.__aenter__.return_value

        question = Question(id=1, exam_id=1, question_type=QuestionType.stdio, max_score=100.0)
        submission = Submission(
            id=1, student_id=1, question_id=1, language="java",
            source_code="class Main {}", status=SubmissionStatus.running,
            max_score=100.0,
        )
        tc1 = TestCase(id=1, question_id=1, input_data="", expected_output="7", score_weight=1.0)

        mock_db.get.side_effect = lambda model, pk: {
            Submission: submission,
            Question: question,
        }.get(model)
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [tc1]

        mock_piston.execute.side_effect = PistonClientError("Connection refused")

        await grade_submission(1)

        assert submission.status == SubmissionStatus.error
        assert "Connection refused" in (submission.error_summary or "")


@pytest.mark.asyncio
async def test_skips_non_running_submission():
    """If the submission is not 'running', grading is skipped."""
    with patch("app.services.grading_service.SessionLocal") as mock_session_cls, \
         patch("app.services.grading_service.PistonClient") as mock_piston_cls:

        mock_db = mock_session_cls.return_value
        mock_piston = mock_piston_cls.return_value.__aenter__.return_value

        submission = Submission(
            id=1, student_id=1, question_id=1, language="java",
            source_code="class Main {}", status=SubmissionStatus.completed,
            max_score=100.0,
        )
        mock_db.get.return_value = submission

        await grade_submission(1)

        # Piston should never be called
        mock_piston.execute.assert_not_called()

@pytest.mark.asyncio
async def test_missing_expected_answer_fails_submission():
    """A test case without an expected answer must produce a grading error, not a pass."""
    with patch("app.services.grading_service.SessionLocal") as mock_session_cls, \
         patch("app.services.grading_service.PistonClient") as mock_piston_cls:

        mock_db = mock_session_cls.return_value
        mock_piston = mock_piston_cls.return_value.__aenter__.return_value

        question = Question(id=1, exam_id=1, question_type=QuestionType.stdio, max_score=100.0)
        submission = Submission(
            id=1, student_id=1, question_id=1, language="java",
            source_code="class Main {}", status=SubmissionStatus.running,
            max_score=100.0,
        )
        tc1 = TestCase(id=1, question_id=1, input_data="", expected_output="", score_weight=1.0)

        mock_db.get.side_effect = lambda model, pk: {
            Submission: submission,
            Question: question,
        }.get(model)
        mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [tc1]

        await grade_submission(1)

        assert submission.status == SubmissionStatus.error
        assert "no expected answer" in (submission.error_summary or "").lower()
        mock_piston.execute.assert_not_called()
