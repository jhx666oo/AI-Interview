from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

class DashboardStats(BaseModel):
    active_positions: int
    pending_resumes: int
    today_interviews: int
    total_questions: int
    trends: dict

class Activity(BaseModel):
    id: str
    title: str
    time: datetime
    status: str
    avatar_color: str
    type: str

class TrendData(BaseModel):
    date: str
    count: int

class DashboardData(BaseModel):
    stats: DashboardStats
    recent_activities: List[Activity]
    interview_trends: List[TrendData]

class FunnelStage(BaseModel):
    stage: str
    stage_name: str
    count: int
    percentage: float

class RecruitmentFunnel(BaseModel):
    stages: List[FunnelStage]
    total_resumes: int
    conversion_rate: float

class PositionAnalytics(BaseModel):
    id: str
    title: str
    department: str
    status: str
    total_resumes: int
    pending_screening: int
    pending_interview: int
    interview_completed: int
    offer_sent: int
    hired: int
    rejected: int
    avg_match_score: Optional[float]
    avg_processing_days: Optional[float]
    conversion_rate: float

class PositionAnalyticsResponse(BaseModel):
    positions: List[PositionAnalytics]
    summary: Dict[str, Any]

class InterviewerStats(BaseModel):
    id: str
    name: str
    total_interviews: int
    completed_interviews: int
    pending_interviews: int
    completion_rate: float
    avg_score: Optional[float]
    score_std: Optional[float]
    consistency_rating: str

class InterviewerAnalyticsResponse(BaseModel):
    interviewers: List[InterviewerStats]
    summary: Dict[str, Any]

class TimelineDataPoint(BaseModel):
    date: str
    resumes_received: int
    interviews_scheduled: int
    interviews_completed: int
    offers_sent: int
    hires: int

class TimelineAnalyticsResponse(BaseModel):
    timeline: List[TimelineDataPoint]
    summary: Dict[str, Any]

class OverviewMetrics(BaseModel):
    total_positions: int
    active_positions: int
    total_resumes: int
    pending_resumes: int
    total_interviews: int
    completed_interviews: int
    total_offers: int
    accepted_offers: int
    avg_time_to_hire: Optional[float]
    avg_match_score: Optional[float]
    interview_pass_rate: float
    offer_accept_rate: float

class OverviewResponse(BaseModel):
    metrics: OverviewMetrics
    funnel: RecruitmentFunnel
    recent_activities: List[Activity]
