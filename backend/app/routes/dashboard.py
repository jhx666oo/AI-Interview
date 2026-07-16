from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from app.config.database import get_db
from app.schemas.dashboard import (
    DashboardData, DashboardStats, Activity, TrendData,
    RecruitmentFunnel, PositionAnalyticsResponse, InterviewerAnalyticsResponse,
    TimelineAnalyticsResponse, OverviewResponse
)
from app.services.dashboard_service import (
    get_dashboard_stats, get_recent_activities, get_interview_trends,
    get_recruitment_funnel, get_position_analytics, get_interviewer_analytics,
    get_timeline_analytics, get_overview
)
from app.models.models import User
from app.models.hr_models import (
    JobRequisition, RequisitionStatus,
    RecruitmentChannel,
    TalentPoolEntry, TalentPoolStatus,
    BackgroundCheck, BackgroundCheckStatus,
    OnboardingRecord, OnboardingStatus,
    ProbationRecord, ProbationResult
)
from app.routes.auth import get_current_user

router = APIRouter(
    prefix="/dashboard",
    tags=["dashboard"],
    responses={404: {"description": "Not found"}},
)

@router.get("/stats", response_model=DashboardData)
def read_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    stats = get_dashboard_stats(db)
    activities = get_recent_activities(db)
    trends = get_interview_trends(db)

    return {
        "stats": stats,
        "recent_activities": activities,
        "interview_trends": trends
    }

@router.get("/overview", response_model=OverviewResponse)
def read_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_overview(db)

@router.get("/funnel", response_model=RecruitmentFunnel)
def read_funnel(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_recruitment_funnel(db)

@router.get("/positions", response_model=PositionAnalyticsResponse)
def read_position_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_position_analytics(db)

@router.get("/interviewers", response_model=InterviewerAnalyticsResponse)
def read_interviewer_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_interviewer_analytics(db)

@router.get("/timeline", response_model=TimelineAnalyticsResponse)
def read_timeline_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    days: int = Query(default=30, ge=7, le=365, description="Number of days to analyze")
):
    return get_timeline_analytics(db, days)

@router.get("/hr-stats")
def read_hr_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Requisition stats
    req_total = db.query(JobRequisition).count()
    req_pending = db.query(JobRequisition).filter(JobRequisition.status == RequisitionStatus.PENDING).count()
    req_approved = db.query(JobRequisition).filter(JobRequisition.status == RequisitionStatus.APPROVED).count()

    # Channel stats
    channel_total = db.query(RecruitmentChannel).count()
    channel_active = db.query(RecruitmentChannel).filter(RecruitmentChannel.is_active == True).count()
    total_resumes_from_channels = db.query(RecruitmentChannel).count()  # placeholder

    # Talent pool stats
    talent_total = db.query(TalentPoolEntry).count()
    talent_available = db.query(TalentPoolEntry).filter(TalentPoolEntry.status == TalentPoolStatus.AVAILABLE).count()
    talent_contacted = db.query(TalentPoolEntry).filter(TalentPoolEntry.status == TalentPoolStatus.CONTACTED).count()
    talent_placed = db.query(TalentPoolEntry).filter(TalentPoolEntry.status == TalentPoolStatus.PLACED).count()

    # Background check stats
    bg_total = db.query(BackgroundCheck).count()
    bg_pending = db.query(BackgroundCheck).filter(BackgroundCheck.status == BackgroundCheckStatus.PENDING).count()
    bg_in_progress = db.query(BackgroundCheck).filter(BackgroundCheck.status == BackgroundCheckStatus.IN_PROGRESS).count()
    bg_completed = db.query(BackgroundCheck).filter(BackgroundCheck.status == BackgroundCheckStatus.COMPLETED).count()

    # Onboarding stats
    ob_total = db.query(OnboardingRecord).count()
    ob_pending = db.query(OnboardingRecord).filter(OnboardingRecord.status == OnboardingStatus.PENDING).count()
    ob_in_progress = db.query(OnboardingRecord).filter(OnboardingRecord.status == OnboardingStatus.IN_PROGRESS).count()
    ob_completed = db.query(OnboardingRecord).filter(OnboardingRecord.status == OnboardingStatus.COMPLETED).count()

    # Probation stats
    pb_total = db.query(ProbationRecord).count()
    pb_pending = db.query(ProbationRecord).filter(ProbationRecord.result == ProbationResult.PENDING).count()
    pb_confirmed = db.query(ProbationRecord).filter(ProbationRecord.result == ProbationResult.CONFIRMED).count()
    pb_terminated = db.query(ProbationRecord).filter(ProbationRecord.result == ProbationResult.TERMINATED).count()

    return {
        "requisitions": {"total": req_total, "pending": req_pending, "approved": req_approved},
        "channels": {"total": channel_total, "active": channel_active},
        "talent_pool": {"total": talent_total, "available": talent_available, "contacted": talent_contacted, "placed": talent_placed},
        "background_checks": {"total": bg_total, "pending": bg_pending, "in_progress": bg_in_progress, "completed": bg_completed},
        "onboarding": {"total": ob_total, "pending": ob_pending, "in_progress": ob_in_progress, "completed": ob_completed},
        "probation": {"total": pb_total, "pending": pb_pending, "confirmed": pb_confirmed, "terminated": pb_terminated},
    }
