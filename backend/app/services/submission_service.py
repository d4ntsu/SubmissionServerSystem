from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.exam import Exam, ExamStatus
from app.models.question import Question
from app.models.submission import Submission, SubmissionStatus, SubmissionTestResult
from app.models.user import User, UserRole


class SubmissionValidationError(ValueError):
    """Raised when a submission request fails business-rule validation."""


class SubmissionPermissionError(PermissionError):
    """Raised when a teacher tries to act on another teacher's submission."""


class SubmissionStateError(RuntimeError):
    """Raised when a submission cannot be re-graded in its current state."""


def validate_submission(
    db: Session,
    student: User,
    question_id: int,
    language: str,
) -> Question:
    """Check that the student is allowed to submit to this question.

    Returns the validated Question on success, raises SubmissionValidationError otherwise.
    """
    if student.role != UserRole.student:
        raise SubmissionValidationError("Only students can submit code")

    question = db.get(Question, question_id)
    if not question:
        raise SubmissionValidationError("Question not found")

    exam = db.get(Exam, question.exam_id)
    if not exam:
        raise SubmissionValidationError("Exam not found")

    if exam.status != ExamStatus.started:
        raise SubmissionValidationError("Exam is not currently active")

    now = datetime.now(timezone.utc)
    if exam.start_time and now < exam.start_time.replace(tzinfo=timezone.utc):
        raise SubmissionValidationError("Exam has not started yet")
    if exam.end_time and now > exam.end_time.replace(tzinfo=timezone.utc):
        raise SubmissionValidationError("Exam has ended")

    allowed = [lang.strip().lower() for lang in question.allowed_languages.split(",")]
    if language.lower() not in allowed:
        raise SubmissionValidationError(
            f"Language '{language}' is not allowed for this question. "
            f"Allowed: {', '.join(allowed)}"
        )

    return question


def create_submission(
    db: Session,
    student: User,
    question_id: int,
    language: str,
    source_code: str,
) -> Submission:
    """Validate and persist a new submission with status 'queued'."""
    question = validate_submission(db, student, question_id, language)

    submission = Submission(
        student_id=student.id,
        question_id=question.id,
        language=language.lower(),
        source_code=source_code,
        status=SubmissionStatus.queued,
        max_score=question.max_score,
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)
    return submission


def get_submission(db: Session, submission_id: int, current_user: User) -> Submission | None:
    """Fetch a submission, enforcing student ownership and teacher exam ownership."""
    submission = db.get(Submission, submission_id)
    if not submission:
        return None
    if current_user.role == UserRole.student and submission.student_id != current_user.id:
        return None
    if current_user.role == UserRole.teacher:
        question = db.get(Question, submission.question_id)
        exam = db.get(Exam, question.exam_id) if question else None
        if not exam or exam.teacher_id != current_user.id:
            return None
    return submission


def list_submissions(
    db: Session,
    current_user: User,
    exam_id: int | None = None,
) -> list[Submission]:
    """List submissions. Students see their own; teachers see submissions for their exams."""
    query = db.query(Submission)
    if current_user.role == UserRole.student:
        query = query.filter(Submission.student_id == current_user.id)
    elif current_user.role == UserRole.teacher:
        query = query.join(Question, Submission.question_id == Question.id).join(
            Exam, Question.exam_id == Exam.id
        ).filter(Exam.teacher_id == current_user.id)
    if exam_id is not None:
        query = query.filter(Submission.question.has(Question.exam_id == exam_id))
    return query.order_by(Submission.submitted_at.desc()).all()


def request_regrade(
    db: Session,
    submission_id: int,
    teacher: User,
) -> Submission | None:
    """Requeue a submission for grading, clearing stale results and score."""
    submission = db.get(Submission, submission_id)
    if not submission:
        return None

    question = db.get(Question, submission.question_id)
    exam = db.get(Exam, question.exam_id) if question else None
    if not exam or exam.teacher_id != teacher.id:
        raise SubmissionPermissionError("Not your exam")

    if submission.status in (SubmissionStatus.queued, SubmissionStatus.running):
        raise SubmissionStateError("Submission is already queued or being graded")

    db.query(SubmissionTestResult).filter(
        SubmissionTestResult.submission_id == submission.id
    ).delete(synchronize_session=False)
    submission.status = SubmissionStatus.queued
    submission.score = None
    submission.error_summary = None
    submission.graded_at = None
    db.commit()
    db.refresh(submission)
    return submission