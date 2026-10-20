from datetime import datetime

from pydantic import BaseModel, Field


class TestCaseCreate(BaseModel):
    question_id: int
    input_data: str = ""
    expected_output: str = ""
    is_hidden: int = 0
    score_weight: float = Field(default=1.0, gt=0)


class TestCaseResponse(BaseModel):
    id: int
    question_id: int
    input_data: str
    expected_output: str = ""
    is_hidden: int
    score_weight: float
    created_at: datetime | None = None

    model_config = {"from_attributes": True}