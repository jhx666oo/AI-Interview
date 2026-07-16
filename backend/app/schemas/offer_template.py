from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from decimal import Decimal
from uuid import UUID

class OfferTemplateBase(BaseModel):
    name: str = Field(..., description="模板名称")
    position_id: Optional[UUID] = Field(None, description="关联岗位ID，为空表示通用模板")
    
    salary_monthly: Optional[Decimal] = Field(None, description="月薪")
    salary_annual: Optional[Decimal] = Field(None, description="年薪")
    salary_structure: Optional[str] = Field(None, description="薪资结构说明")
    
    department: Optional[str] = Field(None, description="部门")
    report_to: Optional[str] = Field(None, description="汇报对象")
    
    work_location: Optional[str] = Field(None, description="工作地点")
    work_hours: Optional[str] = Field(None, description="工作时间")
    
    probation_months: Optional[int] = Field(3, description="试用期月数")
    
    benefits: Optional[str] = Field(None, description="福利待遇")
    bonus: Optional[str] = Field(None, description="奖金说明")
    
    special_terms: Optional[str] = Field(None, description="特殊条款")
    notes: Optional[str] = Field(None, description="备注")
    
    valid_days: Optional[int] = Field(7, description="Offer有效天数")
    is_default: Optional[bool] = Field(False, description="是否默认模板")

class OfferTemplateCreate(OfferTemplateBase):
    pass

class OfferTemplateUpdate(BaseModel):
    name: Optional[str] = None
    position_id: Optional[UUID] = None
    
    salary_monthly: Optional[Decimal] = None
    salary_annual: Optional[Decimal] = None
    salary_structure: Optional[str] = None
    
    department: Optional[str] = None
    report_to: Optional[str] = None
    
    work_location: Optional[str] = None
    work_hours: Optional[str] = None
    
    probation_months: Optional[int] = None
    
    benefits: Optional[str] = None
    bonus: Optional[str] = None
    
    special_terms: Optional[str] = None
    notes: Optional[str] = None
    
    valid_days: Optional[int] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None

class OfferTemplateResponse(BaseModel):
    id: UUID
    name: str
    position_id: Optional[UUID]
    
    salary_monthly: Optional[float]
    salary_annual: Optional[float]
    salary_structure: Optional[str]
    
    department: Optional[str]
    report_to: Optional[str]
    
    work_location: Optional[str]
    work_hours: Optional[str]
    
    probation_months: Optional[int]
    
    benefits: Optional[str]
    bonus: Optional[str]
    
    special_terms: Optional[str]
    notes: Optional[str]
    
    valid_days: Optional[int]
    is_default: Optional[bool]
    is_active: Optional[bool]
    
    created_at: datetime
    updated_at: Optional[datetime]
    created_by: Optional[UUID]
    
    position_info: Optional[dict] = None

    class Config:
        from_attributes = True

class OfferTemplateListResponse(BaseModel):
    items: List[OfferTemplateResponse]
    total: int
