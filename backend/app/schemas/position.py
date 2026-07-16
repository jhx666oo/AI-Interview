from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from app.models.models import PositionStatus, PositionUrgency, PositionType

class PositionBase(BaseModel):
    title: str
    description: str
    requirements: Optional[str] = None
    salary_range: Optional[str] = None
    location: Optional[str] = None
    department: Optional[str] = None
    status: PositionStatus = PositionStatus.OPEN
    urgency: PositionUrgency = PositionUrgency.MEDIUM
    position_type: PositionType = PositionType.FULL_TIME
    headcount: int = 1
    hiring_manager_id: Optional[UUID] = None
    responsible_person: Optional[str] = None
    personalized_requirements: Optional[str] = None
    capability_dimensions: Optional[str] = None

class PositionCreate(PositionBase):
    pass

class PositionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    requirements: Optional[str] = None
    salary_range: Optional[str] = None
    location: Optional[str] = None
    department: Optional[str] = None
    status: Optional[PositionStatus] = None
    urgency: Optional[PositionUrgency] = None
    position_type: Optional[PositionType] = None
    headcount: Optional[int] = None
    hiring_manager_id: Optional[UUID] = None
    responsible_person: Optional[str] = None
    personalized_requirements: Optional[str] = None
    capability_dimensions: Optional[str] = None

class PositionResponse(PositionBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class PositionStats(BaseModel):
    total_resumes: int = 0
    pending_screening: int = 0
    pending_interview: int = 0
    interview_completed: int = 0
    offer_pending: int = 0
    offer_accepted: int = 0
    rejected: int = 0

class PositionWithStats(PositionResponse):
    stats: PositionStats = PositionStats()
    hiring_manager_name: Optional[str] = None

class PositionDetailResponse(PositionResponse):
    stats: PositionStats = PositionStats()
    hiring_manager_name: Optional[str] = None
    linked_question_banks: List['QuestionBankBrief'] = []

class QuestionBankBrief(BaseModel):
    id: UUID
    name: str
    category: str
    question_count: int = 0
    model_config = ConfigDict(from_attributes=True)

class JDGenerateRequest(BaseModel):
    title: str
    department: Optional[str] = None
    location: Optional[str] = None
    salary_range: Optional[str] = None
    keywords: Optional[str] = None

class JDGenerateResponse(BaseModel):
    description: str
    requirements: str

class JDChatMessage(BaseModel):
    role: str
    content: str

class JDChatRequest(BaseModel):
    messages: List[JDChatMessage]
    current_description: str = ""
    current_requirements: str = ""