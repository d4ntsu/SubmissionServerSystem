import enum

from sqlalchemy import Column, Integer, String, Float, Enum, Text, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship

from app.database import Base


class QuestionType(str, enum.Enum):
    stdio = "stdio"
    java_class = "java_class"


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    exam_id = Column(Integer, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, default="")
    question_type = Column(Enum(QuestionType), default=QuestionType.stdio, nullable=False)
    max_score = Column(Float, nullable=False, default=100.0)
    allowed_languages = Column(String(200), default="java")
    # For java_class: the expected class name and method signature
    class_name = Column(String(100), nullable=True)
    method_signature = Column(String(500), nullable=True)
    method_mode = Column(String(10), nullable=False, default="STATIC")
    created_at = Column(DateTime, server_default=func.now())

    exam = relationship("Exam", back_populates="questions")
    test_cases = relationship("TestCase", back_populates="question", cascade="all, delete-orphan")