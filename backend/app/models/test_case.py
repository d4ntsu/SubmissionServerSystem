from sqlalchemy import Column, Integer, String, Text, Float, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship

from app.database import Base


class TestCase(Base):
    __tablename__ = "test_cases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    question_id = Column(Integer, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    input_data = Column(Text, default="")
    expected_output = Column(Text, default="")
    is_hidden = Column(Integer, default=0)
    score_weight = Column(Float, default=1.0)
    created_at = Column(DateTime, server_default=func.now())

    question = relationship("Question", back_populates="test_cases")