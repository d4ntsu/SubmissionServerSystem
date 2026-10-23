import asyncio
import uuid
from types import SimpleNamespace

import pytest

from app.database import SessionLocal
from app.models.exam import Exam, ExamStatus
from app.models.question import Question, QuestionType
from app.models.submission import Submission, SubmissionStatus, SubmissionTestResult
from app.models import test_case
from app.models.user import User, UserRole
from app.realtime import submission_events
from app.realtime.manager import realtime_manager


@pytest.fixture
def submission_context():
    db = SessionLocal()
    suffix = uuid.uuid4().hex
    teacher = User(
        username=f"rt_teacher_{suffix}",
        hashed_password="unused",
        full_name="Realtime Teacher",
        role=UserRole.teacher,
    )
    student = User(
        username=f"rt_student_{suffix}",
        hashed_password="unused",
        full_name="Realtime Student",
        role=UserRole.student,
    )
    other_student = User(
        username=f"rt_other_student_{suffix}",
        hashed_password="unused",
        full_name="Other Student",
        role=UserRole.student,
    )
    other_teacher = User(
        username=f"rt_other_teacher_{suffix}",
        hashed_password="unused",
        full_name="Other Teacher",
        role=UserRole.teacher,
    )
    db.add_all([teacher, student, other_student, other_teacher])
    db.flush()

    exam = Exam(
        title=f"Realtime Submission Exam {suffix}",
        status=ExamStatus.started,
        teacher_id=teacher.id,
    )
    question = Question(
        title="Realtime Submission Question",
        exam_id=exam.id,
        question_type=QuestionType.stdio,
        max_score=100,
        allowed_languages="java",
    )
    db.add(exam)
    db.flush()
    question.exam_id = exam.id
    db.add(question)
    db.commit()

    context = {
        "teacher_id": teacher.id,
        "student_id": student.id,
        "other_student_id": other_student.id,
        "other_teacher_id": other_teacher.id,
        "exam_id": exam.id,
        "question_id": question.id,
        "submission_ids": [],
        "test_case_ids": [],
        "user_ids": [teacher.id, student.id, other_student.id, other_teacher.id],
    }

    def add_submission(status=SubmissionStatus.queued, *, with_test_case=False):
        if with_test_case:
            test_case_row = test_case.TestCase(
                question_id=context["question_id"],
                input_data="",
                expected_output="accepted",
                is_hidden=1,
                score_weight=1.0,
            )
            db.add(test_case_row)
            db.flush()
            context["test_case_ids"].append(test_case_row.id)
        submission = Submission(
            student_id=context["student_id"],
            question_id=context["question_id"],
            language="java",
            source_code="private source code",
            status=status,
            max_score=100,
        )
        db.add(submission)
        db.commit()
        context["submission_ids"].append(submission.id)
        return submission.id

    context["add_submission"] = add_submission
    db.close()
    yield context

    cleanup = SessionLocal()
    try:
        if context["submission_ids"]:
            cleanup.query(SubmissionTestResult).filter(
                SubmissionTestResult.submission_id.in_(context["submission_ids"])
            ).delete(synchronize_session=False)
            cleanup.query(Submission).filter(
                Submission.id.in_(context["submission_ids"])
            ).delete(synchronize_session=False)
        if context["test_case_ids"]:
            cleanup.query(test_case.TestCase).filter(
                test_case.TestCase.id.in_(context["test_case_ids"])
            ).delete(synchronize_session=False)
        cleanup.query(Question).filter(Question.id == context["question_id"]).delete(
            synchronize_session=False
        )
        cleanup.query(Exam).filter(Exam.id == context["exam_id"]).delete(
            synchronize_session=False
        )
        cleanup.query(User).filter(User.id.in_(context["user_ids"])).delete(
            synchronize_session=False
        )
        cleanup.commit()
    finally:
        cleanup.close()


class FakeWebSocket:
    def __init__(self):
        self.sent = []
        self.closed = []

    async def accept(self):
        pass

    async def send_json(self, event):
        self.sent.append(event)

    async def close(self, code=1000, reason=None):
        self.closed.append((code, reason))


def test_received_event_is_emitted_after_submission_commit_and_kept_private(
    client, monkeypatch
):
    from app.workers import grading_worker

    monkeypatch.setattr(grading_worker, "_recover_stuck_submissions", lambda: None)
    monkeypatch.setattr(grading_worker, "_claim_next_submission", lambda: None)
    suffix = uuid.uuid4().hex

    def create_user(role):
        username = f"received_{role}_{uuid.uuid4().hex}"
        registered = client.post(
            "/auth/register",
            json={
                "username": username,
                "password": "submission-event-pass",
                "full_name": f"Received {role}",
                "role": role,
            },
        )
        assert registered.status_code == 201, registered.text
        login = client.post(
            "/auth/login",
            json={"username": username, "password": "submission-event-pass"},
        )
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
        profile = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert profile.status_code == 200
        return token, profile.json()["id"]

    teacher_token, teacher_id = create_user("teacher")
    student_token, student_id = create_user("student")
    _, other_student_id = create_user("student")
    _, other_teacher_id = create_user("teacher")
    db = SessionLocal()
    teacher_socket = FakeWebSocket()
    student_socket = FakeWebSocket()
    other_socket = FakeWebSocket()
    other_teacher_socket = FakeWebSocket()
    submission_id = None
    exam_id = None
    question_id = None
    captured = []

    async def capture_bridge_event(event, event_db):
        submission = event_db.get(Submission, event["payload"]["submission_id"])
        assert submission is not None
        assert submission.status == SubmissionStatus.queued
        assert set(event["payload"]) == {"submission_id"}
        captured.append(event.copy())
        return 0

    monkeypatch.setattr(submission_events, "publish_bridge_event", capture_bridge_event)
    try:
        exam = Exam(
            title=f"Received event exam {suffix}",
            status=ExamStatus.started,
            teacher_id=teacher_id,
        )
        db.add(exam)
        db.flush()
        question = Question(
            exam_id=exam.id,
            title="Received event question",
            question_type=QuestionType.stdio,
            max_score=100,
            allowed_languages="java",
        )
        db.add(question)
        db.commit()
        exam_id, question_id = exam.id, question.id

        response = client.post(
            "/submissions",
            headers={"Authorization": f"Bearer {student_token}"},
            json={
                "question_id": question_id,
                "language": "java",
                "source_code": "class Main {}",
            },
        )
        assert response.status_code == 201, response.text
        submission_id = response.json()["id"]
        assert response.json()["status"] == "queued"
        assert len(captured) == 2
        assert {event["type"] for event in captured} == {"submission.received"}
        assert {event["recipient"] for event in captured} == {"role:student", "role:teacher"}

        # Exercise the real routing authorization using each captured recipient.
        real_db = SessionLocal()
        try:
            async def route_events():
                await realtime_manager.register(student_socket, student_id, "student")
                await realtime_manager.register(teacher_socket, teacher_id, "teacher")
                await realtime_manager.register(other_socket, other_student_id, "student")
                await realtime_manager.register(
                    other_teacher_socket, other_teacher_id, "teacher"
                )
                for event in captured:
                    assert await realtime_manager.publish_bridge_event(event, real_db) == 1

            asyncio.run(route_events())
        finally:
            real_db.close()
        assert [event["type"] for event in student_socket.sent] == ["submission.received"]
        assert [event["type"] for event in teacher_socket.sent] == ["submission.received"]
        assert other_socket.sent == []
        assert other_teacher_socket.sent == []
    finally:
        async def disconnect_sockets():
            await realtime_manager.unregister(student_socket, student_id)
            await realtime_manager.unregister(teacher_socket, teacher_id)
            await realtime_manager.unregister(other_socket, other_student_id)
            await realtime_manager.unregister(other_teacher_socket, other_teacher_id)

        asyncio.run(disconnect_sockets())
        if submission_id is not None:
            db.query(SubmissionTestResult).filter(
                SubmissionTestResult.submission_id == submission_id
            ).delete(synchronize_session=False)
            db.query(Submission).filter(Submission.id == submission_id).delete(
                synchronize_session=False
            )
        if question_id is not None:
            db.query(Question).filter(Question.id == question_id).delete(
                synchronize_session=False
            )
        if exam_id is not None:
            db.query(Exam).filter(Exam.id == exam_id).delete(synchronize_session=False)
        db.query(User).filter(
            User.id.in_([teacher_id, student_id, other_student_id, other_teacher_id])
        ).delete(
            synchronize_session=False
        )
        db.commit()
        db.close()


def test_worker_emits_running_only_after_claim_commit(submission_context, monkeypatch):
    from app.workers import grading_worker

    submission_id = submission_context["add_submission"]()
    stop_event = asyncio.Event()
    observed = []

    def claim_submission():
        db = SessionLocal()
        try:
            submission = db.get(Submission, submission_id)
            submission.status = SubmissionStatus.running
            db.commit()
            return submission_id
        finally:
            db.close()

    async def capture_event(event_type, actual_id):
        db = SessionLocal()
        try:
            observed.append((event_type, actual_id, db.get(Submission, actual_id).status))
        finally:
            db.close()

    async def finish_grading(_submission_id):
        stop_event.set()

    monkeypatch.setattr(grading_worker, "_recover_stuck_submissions", lambda: None)
    monkeypatch.setattr(grading_worker, "_claim_next_submission", claim_submission)
    monkeypatch.setattr(grading_worker, "publish_submission_event", capture_event)
    monkeypatch.setattr(grading_worker, "grade_submission", finish_grading)
    asyncio.run(grading_worker.run_grading_worker(stop_event))

    assert observed == [("submission.running", submission_id, SubmissionStatus.running)]


def test_completed_event_has_safe_payload_and_realtime_failure_keeps_commit(
    submission_context, monkeypatch
):
    from app.services import grading_service

    submission_id = submission_context["add_submission"](
        SubmissionStatus.running, with_test_case=True
    )
    observed = []

    class FakeExecutor:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def execute(self, **_kwargs):
            return SimpleNamespace(
                compile=None,
                run=SimpleNamespace(stdout="accepted", stderr="", code=0),
            )

    async def fail_delivery(event, db):
        submission = db.get(Submission, submission_id)
        observed.append((event.copy(), submission.status))
        raise RuntimeError("simulated socket outage")

    monkeypatch.setattr(grading_service, "PistonClient", FakeExecutor)
    monkeypatch.setattr(submission_events, "publish_bridge_event", fail_delivery)
    asyncio.run(grading_service.grade_submission(submission_id))

    db = SessionLocal()
    try:
        persisted = db.get(Submission, submission_id)
        assert persisted.status == SubmissionStatus.completed
        assert len(observed) == 1
        event, state_at_delivery = observed[0]
        assert event["type"] == "submission.completed"
        assert event["payload"] == {"submission_id": submission_id}
        assert state_at_delivery == SubmissionStatus.completed
        assert "source_code" not in event["payload"]
        assert "score" not in event["payload"]
        assert "Piston" not in str(event)
    finally:
        db.close()


def test_failed_event_is_normalized_and_omits_executor_details(submission_context, monkeypatch):
    from app.services import grading_service

    submission_id = submission_context["add_submission"](
        SubmissionStatus.running, with_test_case=True
    )
    observed = []

    class FailingExecutor:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def execute(self, **_kwargs):
            from app.services.piston_client import PistonClientError

            raise PistonClientError("private Piston and Docker diagnostics")

    async def capture_bridge_event(event, db):
        observed.append((event.copy(), db.get(Submission, submission_id).status))
        return 0

    monkeypatch.setattr(grading_service, "PistonClient", FailingExecutor)
    monkeypatch.setattr(submission_events, "publish_bridge_event", capture_bridge_event)
    asyncio.run(grading_service.grade_submission(submission_id))

    db = SessionLocal()
    try:
        persisted = db.get(Submission, submission_id)
        assert persisted.status == SubmissionStatus.error
        assert "private Piston and Docker diagnostics" in persisted.error_summary
        assert len(observed) == 2
        for event, state_at_delivery in observed:
            assert event["type"] == "submission.failed"
            assert event["payload"] == {"submission_id": submission_id}
            assert state_at_delivery == SubmissionStatus.error
            assert "Piston" not in str(event)
            assert "Docker" not in str(event)
    finally:
        db.close()
