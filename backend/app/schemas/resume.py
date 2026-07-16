from pydantic import BaseModel, ConfigDict, field_validator
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime
from app.models.models import ResumeStatus, ScreeningResult, RejectReasonCategory, ReviewRecommendation
from app.schemas.position import PositionResponse
import re

def _validate_reject_reason_category(v):
    if v is None:
        return None
    if isinstance(v, RejectReasonCategory):
        return v
    if isinstance(v, str):
        try:
            return RejectReasonCategory(v)
        except ValueError:
            valid_values = [e.value for e in RejectReasonCategory]
            raise ValueError(f"无效的淘汰原因，有效值为: {valid_values}")
    return v

def _normalize_email(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return None
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, v):
            return None
    return v

class ResumeBase(BaseModel):
    candidate_name: Optional[str] = None
    contact: Optional[str] = None
    email: Optional[str] = None
    position_id: UUID

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v):
        return _normalize_email(v)
    
class ResumeCreate(ResumeBase):
    pass

class ResumeUpdate(BaseModel):
    screening_result: Optional[ScreeningResult] = None
    hr_review: Optional[str] = None
    status: Optional[ResumeStatus] = None
    candidate_name: Optional[str] = None
    contact: Optional[str] = None
    email: Optional[str] = None
    stage: Optional[str] = None
    # 淘汰相关字段
    reject_reason_category: Optional[RejectReasonCategory] = None
    reject_reason_detail: Optional[str] = None

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v):
        return _normalize_email(v)

class ResumeResponse(ResumeBase):
    id: UUID
    file_path: str
    parsed_data: Optional[Dict[str, Any]] = None
    match_score: Optional[int] = None
    parse_status: Optional[str] = None
    parse_error: Optional[str] = None
    parsed_at: Optional[datetime] = None
    screening_result: ScreeningResult
    ai_review: Optional[str] = None
    hr_review: Optional[str] = None
    status: ResumeStatus
    stage: Optional[str] = "new"
    # 其他岗位匹配信息
    other_position_matches: Optional[List[Dict[str, Any]]] = None
    # 淘汰相关字段
    reject_reason_category: Optional[RejectReasonCategory] = None
    reject_reason_detail: Optional[str] = None
    rejected_at: Optional[datetime] = None
    rejected_by: Optional[UUID] = None
    created_at: datetime
    position: Optional[PositionResponse] = None
    department_reviews: Optional[List["DepartmentReviewResponse"]] = None

    model_config = ConfigDict(from_attributes=True)


# 部门评审相关 Schema
class DepartmentReviewBase(BaseModel):
    technical_score: Optional[int] = None  # 技术评分 1-10
    experience_score: Optional[int] = None  # 经验评分 1-10
    overall_score: Optional[int] = None  # 综合评分 1-10
    recommendation: Optional[ReviewRecommendation] = None
    comment: Optional[str] = None


class DepartmentReviewCreate(DepartmentReviewBase):
    pass


class DepartmentReviewUpdate(BaseModel):
    technical_score: Optional[int] = None
    experience_score: Optional[int] = None
    overall_score: Optional[int] = None
    recommendation: Optional[ReviewRecommendation] = None
    comment: Optional[str] = None


class DepartmentReviewResponse(DepartmentReviewBase):
    id: UUID
    resume_id: UUID
    reviewer_id: UUID
    is_completed: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    reviewer_name: Optional[str] = None  # 评审人姓名

    model_config = ConfigDict(from_attributes=True)


# HR决策相关 Schema
class HRDecisionCreate(BaseModel):
    hr_id: UUID  # HR用户ID
    decision: ResumeStatus  # REJECTED, WAITLIST, PENDING_INTERVIEW 等
    reject_reason_category: Optional[RejectReasonCategory] = None
    reject_reason_detail: Optional[str] = None
    hr_comment: Optional[str] = None

    @field_validator("reject_reason_category", mode="before")
    @classmethod
    def validate_reject_reason(cls, v):
        return _validate_reject_reason_category(v)


class HRDecisionResponse(BaseModel):
    resume_id: UUID
    decision: ResumeStatus
    reject_reason_category: Optional[RejectReasonCategory] = None
    reject_reason_detail: Optional[str] = None
    hr_comment: Optional[str] = None
    decided_at: datetime

    model_config = ConfigDict(from_attributes=True)


# 简历查重检查
class DuplicateCheckRequest(BaseModel):
    email: Optional[str] = None
    contact: Optional[str] = None
    position_id: UUID

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v):
        return _normalize_email(v)


class DuplicateCheckResponse(BaseModel):
    is_duplicate: bool
    existing_resume: Optional[ResumeResponse] = None
    message: Optional[str] = None


# 部门评审聚合报告
class DepartmentReviewSummary(BaseModel):
    resume_id: UUID
    total_reviewers: int
    completed_reviewers: int
    avg_technical_score: Optional[float] = None
    avg_experience_score: Optional[float] = None
    avg_overall_score: Optional[float] = None
    recommend_count: int = 0
    not_recommend_count: int = 0
    pending_count: int = 0
    recommend_ratio: float = 0.0
    comments: List[str] = []
    reviews: List[DepartmentReviewResponse] = []

    model_config = ConfigDict(from_attributes=True)


# Resolve forward references
ResumeResponse.model_rebuild()
