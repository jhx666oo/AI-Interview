from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any
from uuid import UUID
from datetime import datetime

# ==================== Requisitions ====================
class RequisitionBase(BaseModel):
    title: str
    department: str
    headcount: int = 1
    employment_type: str = "full_time"
    salary_range: Optional[str] = None
    budget: Optional[float] = None
    urgency: str = "medium"
    expected_date: Optional[datetime] = None
    description: Optional[str] = None
    requirements: Optional[str] = None
    reporting_to: Optional[str] = None
    channel_plan: Optional[str] = None

class RequisitionCreate(RequisitionBase):
    pass

class RequisitionUpdate(BaseModel):
    title: Optional[str] = None
    department: Optional[str] = None
    headcount: Optional[int] = None
    employment_type: Optional[str] = None
    salary_range: Optional[str] = None
    budget: Optional[float] = None
    urgency: Optional[str] = None
    expected_date: Optional[datetime] = None
    description: Optional[str] = None
    requirements: Optional[str] = None
    reporting_to: Optional[str] = None
    channel_plan: Optional[str] = None
    status: Optional[str] = None

class RequisitionResponse(RequisitionBase):
    id: UUID
    status: str
    requested_by: Optional[UUID] = None
    position_id: Optional[UUID] = None
    approved_by: Optional[UUID] = None
    approved_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

# ==================== Channels ====================
class ChannelBase(BaseModel):
    name: str
    channel_type: str = "job_platform"
    position_id: Optional[UUID] = None
    url: Optional[str] = None
    contact: Optional[str] = None
    cost: Optional[float] = 0
    is_active: bool = True
    notes: Optional[str] = None

class ChannelCreate(ChannelBase):
    pass

class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    channel_type: Optional[str] = None
    url: Optional[str] = None
    contact: Optional[str] = None
    cost: Optional[float] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None
    resumes_count: Optional[int] = None
    hired_count: Optional[int] = None

class ChannelResponse(ChannelBase):
    id: UUID
    resumes_count: int = 0
    hired_count: int = 0
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

# ==================== Talent Pool ====================
class TalentPoolBase(BaseModel):
    candidate_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    current_title: Optional[str] = None
    skills: Optional[List[str]] = None
    experience_years: Optional[int] = None
    education: Optional[str] = None
    expected_salary: Optional[str] = None
    source: Optional[str] = None
    tags: Optional[List[str]] = None
    status: str = "available"
    notes: Optional[str] = None
    resume_id: Optional[UUID] = None

class TalentPoolCreate(TalentPoolBase):
    pass

class TalentPoolUpdate(BaseModel):
    candidate_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    current_title: Optional[str] = None
    skills: Optional[List[str]] = None
    experience_years: Optional[int] = None
    education: Optional[str] = None
    expected_salary: Optional[str] = None
    source: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class TalentPoolResponse(TalentPoolBase):
    id: UUID
    last_contacted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

# ==================== Background Check ====================
class BackgroundCheckBase(BaseModel):
    resume_id: UUID
    position_id: Optional[UUID] = None
    candidate_name: str

class BackgroundCheckCreate(BackgroundCheckBase):
    pass

class BackgroundCheckUpdate(BaseModel):
    status: Optional[str] = None
    work_verification: Optional[Any] = None
    education_verification: Optional[Any] = None
    reference_check: Optional[Any] = None
    criminal_check: Optional[str] = None
    overall_result: Optional[str] = None
    report_path: Optional[str] = None
    notes: Optional[str] = None

class BackgroundCheckResponse(BackgroundCheckBase):
    id: UUID
    status: str
    work_verification: Optional[Any] = None
    education_verification: Optional[Any] = None
    reference_check: Optional[Any] = None
    criminal_check: Optional[str] = None
    overall_result: Optional[str] = None
    conducted_by: Optional[UUID] = None
    conducted_at: Optional[datetime] = None
    report_path: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

# ==================== Onboarding ====================
class OnboardingBase(BaseModel):
    resume_id: UUID
    position_id: Optional[UUID] = None
    offer_id: Optional[UUID] = None
    candidate_name: str
    employee_id: Optional[str] = None
    onboard_date: Optional[datetime] = None
    department: Optional[str] = None
    position_title: Optional[str] = None
    contract_type: str = "fixed_term"
    mentor_id: Optional[UUID] = None
    notes: Optional[str] = None

class OnboardingCreate(OnboardingBase):
    pass

class OnboardingUpdate(BaseModel):
    employee_id: Optional[str] = None
    onboard_date: Optional[datetime] = None
    department: Optional[str] = None
    position_title: Optional[str] = None
    contract_signed: Optional[bool] = None
    contract_type: Optional[str] = None
    documents: Optional[Any] = None
    accounts_created: Optional[bool] = None
    equipment_assigned: Optional[bool] = None
    mentor_id: Optional[UUID] = None
    orientation_completed: Optional[bool] = None
    orientation_date: Optional[datetime] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class OnboardingResponse(OnboardingBase):
    id: UUID
    contract_signed: bool = False
    documents: Optional[Any] = None
    accounts_created: bool = False
    equipment_assigned: bool = False
    orientation_completed: bool = False
    orientation_date: Optional[datetime] = None
    status: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

# ==================== Probation ====================
class ProbationBase(BaseModel):
    onboarding_id: Optional[UUID] = None
    resume_id: Optional[UUID] = None
    position_id: Optional[UUID] = None
    employee_name: str
    employee_id: Optional[str] = None
    probation_start: Optional[datetime] = None
    probation_months: int = 3

class ProbationCreate(ProbationBase):
    pass

class ProbationUpdate(BaseModel):
    probation_start: Optional[datetime] = None
    probation_end: Optional[datetime] = None
    probation_months: Optional[int] = None
    monthly_reviews: Optional[Any] = None
    final_assessment: Optional[str] = None
    result: Optional[str] = None
    new_title: Optional[str] = None
    salary_adjustment: Optional[float] = None
    notes: Optional[str] = None

class ProbationResponse(ProbationBase):
    id: UUID
    probation_end: Optional[datetime] = None
    monthly_reviews: Optional[Any] = None
    final_assessment: Optional[str] = None
    result: str
    confirmed_at: Optional[datetime] = None
    confirmed_by: Optional[UUID] = None
    new_title: Optional[str] = None
    salary_adjustment: Optional[float] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)
