import enum

from sqlalchemy import Column, Integer, String, Enum, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship

from app.database import Base


class ExamStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    started = "started"
    ended = "ended"


class Exam(Base):
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False)
    description = Column(String(1000), default="")
    status = Column(Enum(ExamStatus), default=ExamStatus.draft, nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    access_password_hash = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    teacher = relationship("User")
    questions = relationship("Question", back_populates="exam", cascade="all, delete-orphan")

    @property
    def has_password(self) -> bool:
        return bool(self.access_password_hash)