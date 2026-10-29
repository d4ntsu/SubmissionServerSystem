import enum

from sqlalchemy import Column, Integer, String, Float, Enum, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship

from app.database import Base


class SubmissionStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    error = "error"


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    language = Column(String(20), nullable=False)
    source_code = Column(Text, nullable=False)
    status = Column(Enum(SubmissionStatus), default=SubmissionStatus.queued, nullable=False)
    score = Column(Float, nullable=True)
    max_score = Column(Float, nullable=False)
    error_summary = Column(Text, nullable=True)
    submitted_at = Column(DateTime, server_default=func.now())
    graded_at = Column(DateTime, nullable=True)

    student = relationship("User")
    question = relationship("Question")
    test_results = relationship("SubmissionTestResult", back_populates="submission", cascade="all, delete-orphan")

    @property
    def student_name(self) -> str | None:
        return self.student.full_name if self.student else None

    @property
    def student_username(self) -> str | None:
        return self.student.username if self.student else None

    @property
    def question_title(self) -> str | None:
        return self.question.title if self.question else None

    @property
    def exam_id(self) -> int | None:
        return self.question.exam_id if self.question else None

    @property
    def exam_title(self) -> str | None:
        return self.question.exam.title if self.question and self.question.exam else None


class SubmissionTestResult(Base):
    __tablename__ = "submission_test_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    submission_id = Column(Integer, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False)
    test_case_id = Column(Integer, ForeignKey("test_cases.id"), nullable=False)
    passed = Column(Integer, default=0)
    stdout = Column(Text, nullable=True)
    stderr = Column(Text, nullable=True)
    compile_output = Column(Text, nullable=True)
    exit_code = Column(Integer, nullable=True)
    time = Column(Float, nullable=True)
    memory = Column(Float, nullable=True)

    submission = relationship("Submission", back_populates="test_results")
    test_case = relationship("TestCase")