from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from decimal import Decimal
from uuid import UUID

class OfferStatus:
    DRAFT = "draft"
    PENDING = "pending"
    SENT = "sent"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"
    WITHDRAWN = "withdrawn"

class OfferBase(BaseModel):
    resume_id: UUID
    position_id: UUID
    candidate_name: str
    candidate_email: str
    
    salary_monthly: Optional[Decimal] = Field(None, description="月薪")
    salary_annual: Optional[Decimal] = Field(None, description="年薪")
    salary_structure: Optional[str] = Field(None, description="薪资结构说明")
    
    position_title: str = Field(..., description="岗位名称")
    department: Optional[str] = Field(None, description="部门")
    report_to: Optional[str] = Field(None, description="汇报对象")
    
    work_location: Optional[str] = Field(None, description="工作地点")
    work_hours: Optional[str] = Field(None, description="工作时间")
    
    onboard_date: Optional[datetime] = Field(None, description="入职日期")
    probation_months: Optional[int] = Field(3, description="试用期月数")
    
    benefits: Optional[str] = Field(None, description="福利待遇")
    bonus: Optional[str] = Field(None, description="奖金说明")
    
    special_terms: Optional[str] = Field(None, description="特殊条款")
    notes: Optional[str] = Field(None, description="备注")
    
    valid_until: Optional[datetime] = Field(None, description="Offer有效期至")

class OfferCreate(OfferBase):
    pass

class OfferUpdate(BaseModel):
    salary_monthly: Optional[Decimal] = None
    salary_annual: Optional[Decimal] = None
    salary_structure: Optional[str] = None
    position_title: Optional[str] = None
    department: Optional[str] = None
    report_to: Optional[str] = None
    work_location: Optional[str] = None
    work_hours: Optional[str] = None
    onboard_date: Optional[datetime] = None
    probation_months: Optional[int] = None
    benefits: Optional[str] = None
    bonus: Optional[str] = None
    special_terms: Optional[str] = None
    notes: Optional[str] = None
    valid_until: Optional[datetime] = None
    status: Optional[str] = None

class OfferResponse(BaseModel):
    id: UUID
    resume_id: UUID
    position_id: UUID
    candidate_name: str
    candidate_email: str
    
    salary_monthly: Optional[Decimal]
    salary_annual: Optional[Decimal]
    salary_structure: Optional[str]
    
    position_title: str
    department: Optional[str]
    report_to: Optional[str]
    
    work_location: Optional[str]
    work_hours: Optional[str]
    
    onboard_date: Optional[datetime]
    probation_months: Optional[int]
    
    benefits: Optional[str]
    bonus: Optional[str]
    
    special_terms: Optional[str]
    notes: Optional[str]
    
    valid_until: Optional[datetime]
    status: str
    
    sent_at: Optional[datetime]
    accepted_at: Optional[datetime]
    rejected_at: Optional[datetime]
    rejected_reason: Optional[str]
    
    created_at: datetime
    updated_at: Optional[datetime]
    created_by: Optional[UUID]
    
    position_info: Optional[Dict[str, Any]] = None
    resume_info: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

class OfferListResponse(BaseModel):
    items: List[OfferResponse]
    total: int
    page: int
    page_size: int
    total_pages: int

class OfferSendRequest(BaseModel):
    send_email: bool = Field(default=True, description="是否发送邮件通知")
    custom_message: Optional[str] = Field(None, description="自定义邮件内容")

class OfferAcceptRequest(BaseModel):
    accepted_salary: Optional[Decimal] = Field(None, description="确认薪资")
    accepted_onboard_date: Optional[datetime] = Field(None, description="确认入职日期")
    notes: Optional[str] = Field(None, description="备注")

class OfferRejectRequest(BaseModel):
    reason: str = Field(..., description="拒绝原因")
    feedback: Optional[str] = Field(None, description="候选人反馈")

class OfferStats(BaseModel):
    total_offers: int
    pending_offers: int
    sent_offers: int
    accepted_offers: int
    rejected_offers: int
    expired_offers: int
    acceptance_rate: float
    avg_response_days: Optional[float]
