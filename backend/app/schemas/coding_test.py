from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime
from app.models.models import CodingTestStatus, CodingSubmissionStatus


class ChoiceQuestion(BaseModel):
    id: str
    question: str
    options: List[Dict[str, str]]
    correct_answer: str
    is_multiple: bool = False
    explanation: Optional[str] = None


class EssayQuestion(BaseModel):
    id: str
    question: str
    reference_answer: Optional[str] = None
    keywords: Optional[List[str]] = None
    max_score: int = 10


class CodingTestBase(BaseModel):
    title: str
    description: Optional[str] = None
    test_type: Optional[str] = "algorithm"
    difficulty: Optional[str] = "intermediate"
    language: Optional[str] = "javascript"
    starter_code: Optional[str] = None
    test_cases: Optional[List[Dict[str, Any]]] = None
    time_limit_ms: Optional[int] = 3000
    memory_limit_mb: Optional[int] = 256
    question_bank_id: Optional[UUID] = None
    questions: Optional[List[Dict[str, Any]]] = None
    duration_minutes: Optional[int] = 60
    resume_id: Optional[UUID] = None
    position_id: Optional[UUID] = None


class CodingTestCreate(CodingTestBase):
    status: Optional[CodingTestStatus] = CodingTestStatus.DRAFT


class CodingTestUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    test_type: Optional[str] = None
    difficulty: Optional[str] = None
    language: Optional[str] = None
    starter_code: Optional[str] = None
    test_cases: Optional[List[Dict[str, Any]]] = None
    time_limit_ms: Optional[int] = None
    memory_limit_mb: Optional[int] = None
    status: Optional[CodingTestStatus] = None
    question_bank_id: Optional[UUID] = None
    questions: Optional[List[Dict[str, Any]]] = None
    duration_minutes: Optional[int] = None
    resume_id: Optional[UUID] = None
    position_id: Optional[UUID] = None


class CodingTestResponse(CodingTestBase):
    id: UUID
    public_token: str
    status: CodingTestStatus
    question_generation_status: Optional[str] = "pending"
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PublicCodingTestResponse(BaseModel):
    title: str
    description: Optional[str] = None
    test_type: Optional[str] = "algorithm"
    difficulty: Optional[str] = None
    language: Optional[str] = None
    starter_code: Optional[str] = None
    questions: Optional[List[Dict[str, Any]]] = None
    duration_minutes: Optional[int] = 60


class ChoiceAnswer(BaseModel):
    question_id: str
    answer: str


class EssayAnswer(BaseModel):
    question_id: str
    answer: str


class CodingRunRequest(BaseModel):
    code: str
    language: Optional[str] = "javascript"


class ChoiceSubmitRequest(BaseModel):
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    answers: List[ChoiceAnswer]


class EssaySubmitRequest(BaseModel):
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    answers: List[EssayAnswer]


class CodingRunResponse(BaseModel):
    passed: bool
    score: int
    results: List[Dict[str, Any]]
    error: Optional[str] = None
    raw: Optional[str] = None


class CodingSubmitRequest(BaseModel):
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    code: str
    language: Optional[str] = "javascript"


class CodingSubmissionResponse(BaseModel):
    id: UUID
    coding_test_id: UUID
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    language: Optional[str] = None
    code: Optional[str] = None
    answers: Optional[List[Dict[str, Any]]] = None
    run_result: Optional[Dict[str, Any]] = None
    passed: bool
    score: int
    ai_evaluation: Optional[str] = None
    status: CodingSubmissionStatus
    created_at: datetime
    submitted_at: Optional[datetime] = None
    evaluated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PublicCodingSubmissionResponse(BaseModel):
    id: UUID
    coding_test_id: UUID
    language: Optional[str] = None
    run_result: Optional[Dict[str, Any]] = None
    passed: bool
    score: int
    status: CodingSubmissionStatus
    created_at: datetime
    submitted_at: Optional[datetime] = None


class LeetCodeImportRequest(BaseModel):
    url: str


class LeetCodeImportResponse(BaseModel):
    title: str
    description: str
    difficulty: str
    slug: str
    test_cases: List[Dict[str, Any]] = []
