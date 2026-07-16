from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime
from enum import Enum

class QuestionCategory(str, Enum):
    TECHNICAL = "technical"
    MANAGEMENT = "management"
    HR = "hr"
    OTHER = "other"

class QuestionDifficulty(str, Enum):
    JUNIOR = "junior"
    INTERMEDIATE = "intermediate"
    SENIOR = "senior"

class QuestionBankBase(BaseModel):
    name: str
    category: QuestionCategory
    difficulty: QuestionDifficulty
    tags: Optional[List[str]] = []

class QuestionBankCreate(QuestionBankBase):
    pass

class QuestionBankUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[QuestionCategory] = None
    difficulty: Optional[QuestionDifficulty] = None
    tags: Optional[List[str]] = None

class QuestionBankResponse(QuestionBankBase):
    id: UUID
    source_file: str
    questions: Optional[List[Dict[str, Any]]] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
