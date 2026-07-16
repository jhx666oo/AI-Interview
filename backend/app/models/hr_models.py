from sqlalchemy import Column, String, Boolean, DateTime, Text, Enum, JSON, Integer, ForeignKey, Float
from sqlalchemy.dialects.postgresql import UUID, ARRAY
import uuid
from datetime import datetime
from app.models.base import Base
import enum
from sqlalchemy.orm import relationship

# ==================== HR Full-Cycle Modules ====================
# New models for comprehensive recruitment workflow

class RequisitionStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CLOSED = "closed"

class RequisitionUrgency(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"

class JobRequisition(Base):
    """人力需求提报"""
    __tablename__ = "job_requisitions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String, nullable=False)
    department = Column(String, nullable=False)
    headcount = Column(Integer, default=1)
    employment_type = Column(String, default="full_time")
    salary_range = Column(String)
    budget = Column(Float)
    urgency = Column(Enum(RequisitionUrgency, values_callable=lambda obj: [e.value for e in obj]), default=RequisitionUrgency.MEDIUM)
    expected_date = Column(DateTime)
    description = Column(Text)
    requirements = Column(Text)
    reporting_to = Column(String)
    requested_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"), nullable=True)
    status = Column(Enum(RequisitionStatus, values_callable=lambda obj: [e.value for e in obj]), default=RequisitionStatus.DRAFT)
    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    channel_plan = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    requester = relationship("User", foreign_keys=[requested_by])
    approver = relationship("User", foreign_keys=[approved_by])
    position = relationship("Position")


class ChannelType(str, enum.Enum):
    INTERNAL_REFERRAL = "internal_referral"
    JOB_PLATFORM = "job_platform"
    CAMPUS = "campus"
    HEADHUNTER = "headhunter"
    OFFLINE = "offline"
    SHORT_VIDEO = "short_video"
    TALENT_POOL = "talent_pool"

class RecruitmentChannel(Base):
    """招聘渠道管理"""
    __tablename__ = "recruitment_channels"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    channel_type = Column(Enum(ChannelType, values_callable=lambda obj: [e.value for e in obj]), default=ChannelType.JOB_PLATFORM)
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"), nullable=True)
    url = Column(String, nullable=True)
    contact = Column(String, nullable=True)
    cost = Column(Float, default=0)
    is_active = Column(Boolean, default=True)
    resumes_count = Column(Integer, default=0)
    hired_count = Column(Integer, default=0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    position = relationship("Position")


class TalentPoolStatus(str, enum.Enum):
    AVAILABLE = "available"
    CONTACTED = "contacted"
    PLACED = "placed"
    BLACKLISTED = "blacklisted"

class TalentPoolEntry(Base):
    """人才库沉淀"""
    __tablename__ = "talent_pool"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id"), nullable=True)
    candidate_name = Column(String, nullable=False)
    email = Column(String, index=True)
    phone = Column(String)
    current_title = Column(String)
    skills = Column(ARRAY(String))
    experience_years = Column(Integer)
    education = Column(String)
    expected_salary = Column(String)
    source = Column(String)
    tags = Column(ARRAY(String))
    status = Column(Enum(TalentPoolStatus, values_callable=lambda obj: [e.value for e in obj]), default=TalentPoolStatus.AVAILABLE)
    notes = Column(Text)
    last_contacted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    resume = relationship("Resume")


class BackgroundCheckStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"

class BackgroundCheckResult(str, enum.Enum):
    PASSED = "passed"
    FAILED = "failed"
    CONCERNS = "concerns"

class BackgroundCheck(Base):
    """背景调查"""
    __tablename__ = "background_checks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id"), nullable=False)
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"), nullable=True)
    candidate_name = Column(String, nullable=False)
    status = Column(Enum(BackgroundCheckStatus, values_callable=lambda obj: [e.value for e in obj]), default=BackgroundCheckStatus.PENDING)
    work_verification = Column(JSON)
    education_verification = Column(JSON)
    reference_check = Column(JSON)
    criminal_check = Column(Text, nullable=True)
    overall_result = Column(Enum(BackgroundCheckResult, values_callable=lambda obj: [e.value for e in obj]), nullable=True)
    conducted_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    conducted_at = Column(DateTime, nullable=True)
    report_path = Column(String, nullable=True)
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    resume = relationship("Resume")
    position = relationship("Position")
    conductor = relationship("User")


class OnboardingStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    WITHDRAWN = "withdrawn"

class OnboardingRecord(Base):
    """入职管理"""
    __tablename__ = "onboarding_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id"), nullable=False)
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"), nullable=True)
    offer_id = Column(UUID(as_uuid=True), ForeignKey("offers.id"), nullable=True)
    candidate_name = Column(String, nullable=False)
    employee_id = Column(String, nullable=True)
    onboard_date = Column(DateTime, nullable=True)
    department = Column(String)
    position_title = Column(String)
    contract_signed = Column(Boolean, default=False)
    contract_type = Column(String, default="fixed_term")
    documents = Column(JSON)
    accounts_created = Column(Boolean, default=False)
    equipment_assigned = Column(Boolean, default=False)
    mentor_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    orientation_completed = Column(Boolean, default=False)
    orientation_date = Column(DateTime, nullable=True)
    status = Column(Enum(OnboardingStatus, values_callable=lambda obj: [e.value for e in obj]), default=OnboardingStatus.PENDING)
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    resume = relationship("Resume")
    position = relationship("Position")
    offer = relationship("Offer")
    mentor = relationship("User")


class ProbationResult(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    EXTENDED = "extended"
    TERMINATED = "terminated"

class ProbationRecord(Base):
    """试用期跟踪与转正"""
    __tablename__ = "probation_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    onboarding_id = Column(UUID(as_uuid=True), ForeignKey("onboarding_records.id"), nullable=True)
    resume_id = Column(UUID(as_uuid=True), ForeignKey("resumes.id"), nullable=True)
    position_id = Column(UUID(as_uuid=True), ForeignKey("positions.id"), nullable=True)
    employee_name = Column(String, nullable=False)
    employee_id = Column(String, nullable=True)
    probation_start = Column(DateTime, nullable=True)
    probation_end = Column(DateTime, nullable=True)
    probation_months = Column(Integer, default=3)
    monthly_reviews = Column(JSON)
    final_assessment = Column(Text, nullable=True)
    result = Column(Enum(ProbationResult, values_callable=lambda obj: [e.value for e in obj]), default=ProbationResult.PENDING)
    confirmed_at = Column(DateTime, nullable=True)
    confirmed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    new_title = Column(String, nullable=True)
    salary_adjustment = Column(Float, nullable=True)
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    onboarding = relationship("OnboardingRecord")
    resume = relationship("Resume")
    position = relationship("Position")
    confirmer = relationship("User")
