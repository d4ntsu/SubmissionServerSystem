import logging
from datetime import datetime, timedelta, timezone

import anyio
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.database import get_db
from app.models.announcement import Announcement
from app.models.exam import Exam, ExamParticipant, ExamStatus
from app.models.question import Question
from app.models.submission import Submission, SubmissionStatus
from app.models.user import User, UserRole
from app.schemas.announcement import AnnouncementCreate, AnnouncementResponse
from app.schemas.exam import (
    ExamCreate,
    ExamGradeQuestionResponse,
    ExamGradeRequest,
    ExamGradeResponse,
    ExamMonitorParticipantResponse,
    ExamPasswordVerify,
    ExamPasswordVerifyResponse,
    ExamResponse,
    ExamUpdate,
)
from app.schemas.submission import SubmissionTestResultResponse
from app.services.dependencies import get_current_user, require_role
from app.services.preview_grading_service import grade_question_preview

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/exams", tags=["exams"])

_AUTOMATED_TEST_TEACHER_USERNAMES = {
    "test_teacher",
    "exam_pw_teacher",
    "exam_open_teacher",
    "regrade_teacher",
    "regrade_other_teacher",
    "sub_teacher",
    "lang_teacher",
    "view_teacher",
    "priv_teacher",
}
_AUTOMATED_TEST_TEACHER_PREFIXES = ("rt_teacher_", "tcp_route_teacher_")


def _get_exam_or_404(db: Session, exam_id: int) -> Exam:
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")
    return exam


def _emit_exam_event_best_effort(
    event_type: str,
    exam: Exam,
    request: Request,
    *,
    announcement: Announcement | None = None,
) -> None:
    """Queue an event through Java after commit without changing persisted results."""
    payload = {"exam_id": exam.id}
    if announcement is None:
        payload["title"] = exam.title
    else:
        created_at = announcement.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        payload.update({
            "announcement_id": announcement.id,
            "message": announcement.content,
            "created_at": created_at.isoformat().replace("+00:00", "Z"),
        })
    event = {
        "type": event_type,
        "recipient": f"exam:{exam.id}",
        "payload": payload,
    }
    try:
        queued = anyio.from_thread.run(request.app.state.realtime_bridge.send, event)
        if not queued:
            logger.warning("Realtime bridge did not queue %s for exam %s", event_type, exam.id)
    except Exception:
        logger.exception(
            "Realtime delivery failed for %s on exam %s after the database commit",
            event_type,
            exam.id,
        )


@router.post("", response_model=ExamResponse, status_code=status.HTTP_201_CREATED)
def create_exam(
    data: ExamCreate,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    exam = Exam(
        title=data.title,
        description=data.description,
        teacher_id=current_user.id,
        start_time=data.start_time,
        end_time=data.end_time,
        duration_minutes=data.duration_minutes,
        access_password_hash=(
            hash_password(data.access_password)
            if data.access_password and data.access_password.strip()
            else None
        ),
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam


@router.get("", response_model=list[ExamResponse])
def list_exams(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role == UserRole.teacher:
        return db.query(Exam).filter(Exam.teacher_id == current_user.id).all()
    query = (
        db.query(Exam)
        .join(User, Exam.teacher_id == User.id)
        .filter(Exam.status.in_([ExamStatus.published, ExamStatus.started]))
        .filter(~User.username.in_(_AUTOMATED_TEST_TEACHER_USERNAMES))
    )
    for prefix in _AUTOMATED_TEST_TEACHER_PREFIXES:
        query = query.filter(~User.username.startswith(prefix))
    return query.all()


@router.get("/{exam_id}/monitor", response_model=list[ExamMonitorParticipantResponse])
def monitor_exam(
    exam_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    """Return the teacher's exam-scoped participant and submission overview."""
    exam = _get_exam_or_404(db, exam_id)
    if exam.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")

    submissions = (
        db.query(Submission)
        .join(Question, Submission.question_id == Question.id)
        .filter(Question.exam_id == exam.id)
        .order_by(Submission.submitted_at.desc(), Submission.id.desc())
        .all()
    )
    submissions_by_student: dict[int, list[Submission]] = {}
    for submission in submissions:
        submissions_by_student.setdefault(submission.student_id, []).append(submission)

    participant_ids = {
        student_id
        for (student_id,) in db.query(ExamParticipant.student_id).filter(
            ExamParticipant.exam_id == exam.id
        )
    }
    student_ids = participant_ids | set(submissions_by_student)
    students = (
        db.query(User)
        .filter(User.id.in_(student_ids), User.role == UserRole.student)
        .all()
        if student_ids
        else []
    )

    participants: list[ExamMonitorParticipantResponse] = []
    for student in students:
        student_submissions = submissions_by_student.get(student.id, [])
        latest = student_submissions[0] if student_submissions else None
        online = bool(student.is_online)

        if not online:
            activity_status = "disconnected"
        elif latest and latest.status in {SubmissionStatus.completed, SubmissionStatus.error}:
            activity_status = "submitted"
        elif latest or exam.status == ExamStatus.started:
            activity_status = "in_exam"
        else:
            activity_status = "online"

        participants.append(
            ExamMonitorParticipantResponse(
                student_id=student.id,
                student_name=student.full_name,
                username=student.username,
                client_ip=None,
                status=activity_status,
                current_exam=exam.title,
                current_question=latest.question.title if latest and latest.question else None,
                submissions_count=len(student_submissions),
                online=online,
                last_seen_at=student.last_seen_at,
                latest_submission_status=latest.status.value if latest else None,
                latest_score=latest.score if latest else None,
                latest_max_score=latest.max_score if latest else None,
                latest_submitted_at=latest.submitted_at if latest else None,
            )
        )

    participants.sort(key=lambda item: (not item.online, item.student_name.lower()))
    return participants


@router.post("/{exam_id}/grade", response_model=ExamGradeResponse)
async def grade_exam_preview(
    exam_id: int,
    data: ExamGradeRequest,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    """Grade a teacher's current answers without creating a student submission.

    This reuses the production grader so the teacher sees exactly the same test
    diagnostics, but it never persists a submission or publishes realtime events.
    """
    exam = _get_exam_or_404(db, exam_id)
    if exam.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")

    question_ids = [answer.question_id for answer in data.answers]
    if len(set(question_ids)) != len(question_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Each question can only be graded once per request",
        )

    questions = (
        db.query(Question)
        .filter(Question.exam_id == exam.id, Question.id.in_(question_ids))
        .all()
    )
    question_by_id = {question.id: question for question in questions}
    missing_ids = [
        question_id
        for question_id in question_ids
        if question_id not in question_by_id
    ]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "These questions do not belong to the exam: "
                + ", ".join(str(question_id) for question_id in missing_ids)
            ),
        )

    graded_questions: list[ExamGradeQuestionResponse] = []
    for answer in data.answers:
        question = question_by_id[answer.question_id]
        outcome = await grade_question_preview(
            db,
            question,
            answer.language,
            answer.source_code,
        )
        test_case_by_id = {test_case.id: test_case for test_case in outcome.test_cases}
        total_weight = sum(
            (test_case.score_weight or 0.0) for test_case in outcome.test_cases
        ) or 1.0

        test_results: list[SubmissionTestResultResponse] = []
        for index, result in enumerate(outcome.results, start=1):
            test_case = test_case_by_id.get(result.test_case_id)
            weight = (test_case.score_weight or 0.0) if test_case else 0.0
            message: str | None = None
            if result.passed != 1 and test_case:
                message = (
                    "No expected answer is configured for this test case."
                    if not (test_case.expected_output or "").strip()
                    else "The produced output did not match the expected answer."
                )
            test_results.append(
                SubmissionTestResultResponse(
                    id=index,
                    submission_id=0,
                    test_case_id=result.test_case_id,
                    is_sample=not bool(test_case.is_hidden) if test_case else False,
                    passed=result.passed,
                    stdout=result.stdout,
                    stderr=result.stderr,
                    compile_output=result.compile_output,
                    exit_code=result.exit_code,
                    time=result.time,
                    memory=result.memory,
                    input_data=test_case.input_data if test_case else None,
                    expected_output=test_case.expected_output if test_case else None,
                    score_weight=weight,
                    awarded_points=(
                        round((weight / total_weight) * question.max_score, 2)
                        if result.passed == 1
                        else 0.0
                    ),
                    message=message,
                )
            )

        graded_questions.append(
            ExamGradeQuestionResponse(
                question_id=question.id,
                title=question.title,
                status=outcome.submission.status.value,
                score=outcome.submission.score,
                max_score=question.max_score,
                error_summary=outcome.submission.error_summary,
                test_results=test_results,
            )
        )

    failed_count = sum(1 for question in graded_questions if question.status == "error")
    if failed_count == 0:
        overall_status = "completed"
    elif failed_count == len(graded_questions):
        overall_status = "error"
    else:
        overall_status = "partial"

    return ExamGradeResponse(
        exam_id=exam.id,
        status=overall_status,
        score=round(
            sum(question.score or 0.0 for question in graded_questions),
            2,
        ),
        max_score=round(sum(question.max_score for question in graded_questions), 2),
        questions=graded_questions,
    )


@router.get("/{exam_id}", response_model=ExamResponse)
def get_exam(
    exam_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _get_exam_or_404(db, exam_id)


@router.put("/{exam_id}", response_model=ExamResponse)
def update_exam(
    exam_id: int,
    data: ExamUpdate,
    request: Request,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if exam.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")
    previous_status = exam.status
    update_data = data.model_dump(exclude_unset=True)
    if "access_password" in update_data:
        new_password = update_data.pop("access_password")
        exam.access_password_hash = (
            hash_password(new_password)
            if new_password and new_password.strip()
            else None
        )
    for key, value in update_data.items():
        if key == "status":
            continue
        setattr(exam, key, value)
    if "status" in update_data:
        exam.status = update_data["status"]
        if previous_status != ExamStatus.started and exam.status == ExamStatus.started:
            started_at = datetime.now(timezone.utc).replace(tzinfo=None)
            exam.start_time = started_at
            if exam.duration_minutes is not None and exam.duration_minutes > 0:
                exam.end_time = started_at + timedelta(minutes=exam.duration_minutes)
    db.commit()
    db.refresh(exam)

    if previous_status != exam.status:
        if exam.status == ExamStatus.started:
            _emit_exam_event_best_effort("exam.started", exam, request)
        elif exam.status == ExamStatus.ended:
            _emit_exam_event_best_effort("exam.ended", exam, request)
    return exam


@router.post("/{exam_id}/join", status_code=status.HTTP_204_NO_CONTENT)
def join_exam(
    exam_id: int,
    current_user: User = Depends(require_role(UserRole.student)),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if exam.status not in {ExamStatus.published, ExamStatus.started}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Exam is not available for participation",
        )
    participant_key = (exam.id, current_user.id)
    if db.get(ExamParticipant, participant_key) is None:
        db.add(ExamParticipant(exam_id=exam.id, student_id=current_user.id))
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{exam_id}/announcements",
    response_model=AnnouncementResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_announcement(
    exam_id: int,
    data: AnnouncementCreate,
    request: Request,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if exam.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")

    announcement = Announcement(
        exam_id=exam.id,
        teacher_id=current_user.id,
        content=data.content,
    )
    db.add(announcement)
    db.commit()
    db.refresh(announcement)
    _emit_exam_event_best_effort(
        "announcement.created",
        exam,
        request,
        announcement=announcement,
    )
    return announcement


@router.post("/{exam_id}/verify-password", response_model=ExamPasswordVerifyResponse)
def verify_exam_password(
    exam_id: int,
    data: ExamPasswordVerify,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if not exam.access_password_hash:
        return ExamPasswordVerifyResponse(valid=True)
    return ExamPasswordVerifyResponse(
        valid=verify_password(data.password, exam.access_password_hash)
    )


@router.delete("/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(
    exam_id: int,
    current_user: User = Depends(require_role(UserRole.teacher)),
    db: Session = Depends(get_db),
):
    exam = _get_exam_or_404(db, exam_id)
    if exam.teacher_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your exam")
    db.delete(exam)
    db.commit()
