import enum

from sqlalchemy import Boolean, Column, Integer, String, Float, Enum, Text, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship

from app.database import Base


class QuestionType(str, enum.Enum):
    stdio = "stdio"
    java_class = "java_class"
    multiple_choice = "multiple_choice"
    short_answer = "short_answer"


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    exam_id = Column(Integer, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, default="")
    boilerplate = Column(Text, nullable=False, default="")
    question_type = Column(Enum(QuestionType), default=QuestionType.stdio, nullable=False)
    max_score = Column(Float, nullable=False, default=100.0)
    allowed_languages = Column(String(200), default="java")
    # For java_class: the expected class name and method signature
    class_name = Column(String(100), nullable=True)
    method_signature = Column(String(500), nullable=True)
    method_mode = Column(String(10), nullable=False, default="STATIC")
    # For multiple_choice: JSON array of options, e.g. ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"]
    mc_options = Column(Text, nullable=True)
    # For multiple_choice: the correct option(s) as a JSON array, e.g. ["A"] or ["A", "C"]
    mc_correct_answers = Column(Text, nullable=True)
    mc_allow_multiple = Column(Boolean, nullable=False, default=False)
    # For short_answer: the expected answer text (case-insensitive comparison)
    short_answer = Column(Text, nullable=True)
    show_result_to_student = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now())

    exam = relationship("Exam", back_populates="questions")
    test_cases = relationship("TestCase", back_populates="question", cascade="all, delete-orphan")