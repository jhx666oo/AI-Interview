from sqlalchemy.orm import Session
from sqlalchemy import func, desc, and_, or_
from app.models.models import (
    Position, Resume, Interview, QuestionBank, User, InterviewPanel,
    PositionStatus, ResumeStatus, InterviewStatus, InterviewResult, UserRole
)
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
import statistics

def get_dashboard_stats(db: Session):
    active_positions_count = db.query(Position).filter(
        (Position.status == PositionStatus.OPEN) | (Position.status == PositionStatus.PUBLISHED)
    ).count()
    
    pending_resumes_count = db.query(Resume).filter(
        (Resume.status == ResumeStatus.PENDING_SCREENING) | 
        (Resume.status == ResumeStatus.PENDING_REVIEW) |
        (Resume.status == ResumeStatus.PENDING_DEPT_REVIEW) |
        (Resume.status == ResumeStatus.PENDING_HR_DECISION)
    ).count()
    
    # 使用UTC时间进行比较
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    today_interviews_count = db.query(Interview).filter(
        Interview.interview_time >= today_start,
        Interview.interview_time < today_end,
        Interview.status != InterviewStatus.CANCELLED
    ).count()
    
    total_questions_count = db.query(QuestionBank).count()

    last_week = datetime.now(timezone.utc) - timedelta(days=7)
    last_week_positions = db.query(Position).filter(Position.created_at >= last_week).count()
    last_week_resumes = db.query(Resume).filter(Resume.created_at >= last_week).count()
    last_week_interviews = db.query(Interview).filter(Interview.created_at >= last_week).count()
    last_week_questions = db.query(QuestionBank).filter(QuestionBank.created_at >= last_week).count()

    trends = {
        "active_positions": last_week_positions,
        "pending_resumes": last_week_resumes,
        "today_interviews": last_week_interviews,
        "total_questions": last_week_questions
    }

    return {
        "active_positions": active_positions_count,
        "pending_resumes": pending_resumes_count,
        "today_interviews": today_interviews_count,
        "total_questions": total_questions_count,
        "trends": trends
    }

def get_recent_activities(db: Session, limit: int = 10):
    activities = []
    
    recent_interviews = db.query(Interview).order_by(desc(Interview.created_at)).limit(limit).all()
    for interview in recent_interviews:
        status_text = "待进行"
        color = "#F59E0B"
        if interview.status == InterviewStatus.COMPLETED:
            status_text = "已完成"
            color = "#10B981"
        elif interview.status == InterviewStatus.CANCELLED:
            status_text = "已取消"
            color = "#EF4444"
        elif interview.status == InterviewStatus.IN_PROGRESS:
            status_text = "进行中"
            color = "#3B82F6"
            
        activities.append({
            "id": str(interview.id),
            "title": f"面试：{interview.position.title if interview.position else '未知岗位'}",
            "time": interview.created_at,
            "status": status_text,
            "avatar_color": color,
            "type": "interview"
        })
        
    recent_resumes = db.query(Resume).order_by(desc(Resume.created_at)).limit(limit).all()
    for resume in recent_resumes:
        status_text = "新简历"
        color = "#3B82F6"
        if resume.status == ResumeStatus.REJECTED:
            status_text = "已淘汰"
            color = "#EF4444"
        elif resume.status == ResumeStatus.PENDING_INTERVIEW:
            status_text = "待面试"
            color = "#F59E0B"
        elif resume.status in [ResumeStatus.OFFER_ACCEPTED, ResumeStatus.COMPLETED]:
            status_text = "已录用"
            color = "#10B981"
            
        activities.append({
            "id": str(resume.id),
            "title": f"{resume.candidate_name or '候选人'} 投递 {resume.position.title if resume.position else '岗位'}",
            "time": resume.created_at,
            "status": status_text,
            "avatar_color": color,
            "type": "resume"
        })

    activities.sort(key=lambda x: x['time'], reverse=True)
    return activities[:limit]

def get_interview_trends(db: Session, days: int = 7):
    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=days)
    
    interviews = db.query(Interview.created_at).filter(
        Interview.created_at >= start_date,
        Interview.created_at <= end_date
    ).all()
    
    counts = {}
    current = start_date
    while current <= end_date:
        date_str = current.strftime("%Y-%m-%d")
        counts[date_str] = 0
        current += timedelta(days=1)
        
    for interview in interviews:
        date_str = interview[0].strftime("%Y-%m-%d")
        if date_str in counts:
            counts[date_str] += 1
            
    trends = [{"date": date, "count": count} for date, count in counts.items()]
    trends.sort(key=lambda x: x['date'])
    
    return trends

def get_recruitment_funnel(db: Session) -> Dict[str, Any]:
    stage_mapping = [
        ("resume_received", "简历投递", ResumeStatus),
        ("pending_screening", "待初筛", [ResumeStatus.PENDING_SCREENING]),
        ("screening_passed", "初筛通过", [ResumeStatus.PENDING_INTERVIEW, ResumeStatus.INTERVIEW_PASSED]),
        ("interview_scheduled", "面试安排", [ResumeStatus.PENDING_INTERVIEW]),
        ("interview_completed", "面试完成", [ResumeStatus.INTERVIEW_PASSED, ResumeStatus.INTERVIEW_FAILED, ResumeStatus.OFFER_PENDING]),
        ("offer_sent", "Offer发放", [ResumeStatus.OFFER_PENDING, ResumeStatus.OFFER_ACCEPTED, ResumeStatus.OFFER_REJECTED]),
        ("hired", "入职", [ResumeStatus.OFFER_ACCEPTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED]),
    ]
    
    stages = []
    total_resumes = db.query(Resume).count()
    
    if total_resumes == 0:
        return {
            "stages": [{"stage": s[0], "stage_name": s[1], "count": 0, "percentage": 0} for s in stage_mapping],
            "total_resumes": 0,
            "conversion_rate": 0
        }
    
    resume_received_count = total_resumes
    stages.append({
        "stage": "resume_received",
        "stage_name": "简历投递",
        "count": resume_received_count,
        "percentage": 100.0
    })
    
    pending_screening = db.query(Resume).filter(
        Resume.status.in_([ResumeStatus.PENDING_SCREENING, ResumeStatus.PENDING_REVIEW, 
                          ResumeStatus.PENDING_DEPT_REVIEW, ResumeStatus.PENDING_HR_DECISION,
                          ResumeStatus.AUTO_REJECTED_PENDING_REVIEW])
    ).count()
    stages.append({
        "stage": "pending_screening",
        "stage_name": "待初筛",
        "count": pending_screening,
        "percentage": round(pending_screening / total_resumes * 100, 1) if total_resumes > 0 else 0
    })
    
    screening_passed = db.query(Resume).filter(
        Resume.status.in_([ResumeStatus.PENDING_INTERVIEW, ResumeStatus.INTERVIEW_PASSED,
                          ResumeStatus.INTERVIEW_FAILED, ResumeStatus.OFFER_PENDING,
                          ResumeStatus.OFFER_ACCEPTED, ResumeStatus.OFFER_REJECTED,
                          ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED])
    ).count()
    stages.append({
        "stage": "screening_passed",
        "stage_name": "初筛通过",
        "count": screening_passed,
        "percentage": round(screening_passed / total_resumes * 100, 1) if total_resumes > 0 else 0
    })
    
    interview_scheduled = db.query(Resume).filter(
        Resume.status == ResumeStatus.PENDING_INTERVIEW
    ).count()
    stages.append({
        "stage": "interview_scheduled",
        "stage_name": "面试安排",
        "count": interview_scheduled,
        "percentage": round(interview_scheduled / total_resumes * 100, 1) if total_resumes > 0 else 0
    })
    
    interview_completed = db.query(Resume).filter(
        Resume.status.in_([ResumeStatus.INTERVIEW_PASSED, ResumeStatus.INTERVIEW_FAILED,
                          ResumeStatus.OFFER_PENDING, ResumeStatus.OFFER_ACCEPTED,
                          ResumeStatus.OFFER_REJECTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED])
    ).count()
    stages.append({
        "stage": "interview_completed",
        "stage_name": "面试完成",
        "count": interview_completed,
        "percentage": round(interview_completed / total_resumes * 100, 1) if total_resumes > 0 else 0
    })
    
    offer_sent = db.query(Resume).filter(
        Resume.status.in_([ResumeStatus.OFFER_PENDING, ResumeStatus.OFFER_ACCEPTED,
                          ResumeStatus.OFFER_REJECTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED])
    ).count()
    stages.append({
        "stage": "offer_sent",
        "stage_name": "Offer发放",
        "count": offer_sent,
        "percentage": round(offer_sent / total_resumes * 100, 1) if total_resumes > 0 else 0
    })
    
    hired = db.query(Resume).filter(
        Resume.status.in_([ResumeStatus.OFFER_ACCEPTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED])
    ).count()
    stages.append({
        "stage": "hired",
        "stage_name": "入职",
        "count": hired,
        "percentage": round(hired / total_resumes * 100, 1) if total_resumes > 0 else 0
    })
    
    conversion_rate = round(hired / total_resumes * 100, 1) if total_resumes > 0 else 0
    
    return {
        "stages": stages,
        "total_resumes": total_resumes,
        "conversion_rate": conversion_rate
    }

def get_position_analytics(db: Session) -> Dict[str, Any]:
    positions = db.query(Position).all()
    position_analytics = []
    
    total_all_resumes = 0
    total_all_hired = 0
    
    for position in positions:
        resumes = db.query(Resume).filter(Resume.position_id == position.id).all()
        total_resumes = len(resumes)
        total_all_resumes += total_resumes
        
        pending_screening = sum(1 for r in resumes if r.status in [
            ResumeStatus.PENDING_SCREENING, ResumeStatus.PENDING_REVIEW,
            ResumeStatus.PENDING_DEPT_REVIEW, ResumeStatus.PENDING_HR_DECISION,
            ResumeStatus.AUTO_REJECTED_PENDING_REVIEW
        ])
        
        pending_interview = sum(1 for r in resumes if r.status == ResumeStatus.PENDING_INTERVIEW)
        
        interview_completed = sum(1 for r in resumes if r.status in [
            ResumeStatus.INTERVIEW_PASSED, ResumeStatus.INTERVIEW_FAILED,
            ResumeStatus.OFFER_PENDING, ResumeStatus.OFFER_ACCEPTED,
            ResumeStatus.OFFER_REJECTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED
        ])
        
        offer_sent = sum(1 for r in resumes if r.status in [
            ResumeStatus.OFFER_PENDING, ResumeStatus.OFFER_ACCEPTED,
            ResumeStatus.OFFER_REJECTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED
        ])
        
        hired = sum(1 for r in resumes if r.status in [
            ResumeStatus.OFFER_ACCEPTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED
        ])
        total_all_hired += hired
        
        rejected = sum(1 for r in resumes if r.status == ResumeStatus.REJECTED)
        
        match_scores = [r.match_score for r in resumes if r.match_score is not None]
        avg_match_score = round(statistics.mean(match_scores), 1) if match_scores else None
        
        processing_times = []
        for r in resumes:
            if r.status in [ResumeStatus.OFFER_ACCEPTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED]:
                if r.parsed_at:
                    parsed_at = r.parsed_at.replace(tzinfo=timezone.utc) if r.parsed_at.tzinfo is None else r.parsed_at
                    days = (datetime.now(timezone.utc) - parsed_at).days
                    processing_times.append(days)
        avg_processing_days = round(statistics.mean(processing_times), 1) if processing_times else None
        
        conversion_rate = round(hired / total_resumes * 100, 1) if total_resumes > 0 else 0
        
        position_analytics.append({
            "id": str(position.id),
            "title": position.title,
            "department": position.department or "未分配",
            "status": position.status.value,
            "total_resumes": total_resumes,
            "pending_screening": pending_screening,
            "pending_interview": pending_interview,
            "interview_completed": interview_completed,
            "offer_sent": offer_sent,
            "hired": hired,
            "rejected": rejected,
            "avg_match_score": avg_match_score,
            "avg_processing_days": avg_processing_days,
            "conversion_rate": conversion_rate
        })
    
    position_analytics.sort(key=lambda x: x['total_resumes'], reverse=True)
    
    summary = {
        "total_positions": len(positions),
        "active_positions": sum(1 for p in positions if p.status in [PositionStatus.OPEN, PositionStatus.PUBLISHED]),
        "total_resumes": total_all_resumes,
        "total_hired": total_all_hired,
        "overall_conversion_rate": round(total_all_hired / total_all_resumes * 100, 1) if total_all_resumes > 0 else 0
    }
    
    return {
        "positions": position_analytics,
        "summary": summary
    }

def get_interviewer_analytics(db: Session) -> Dict[str, Any]:
    interviewers = db.query(User).filter(User.role.in_([UserRole.ADMIN, UserRole.HR, UserRole.INTERVIEWER])).all()
    interviewer_stats = []
    
    total_all_interviews = 0
    total_all_completed = 0
    
    for interviewer in interviewers:
        as_main = db.query(Interview).filter(Interview.interviewer_id == interviewer.id).all()
        as_panel = db.query(InterviewPanel).filter(InterviewPanel.interviewer_id == interviewer.id).all()
        
        interview_ids = set()
        for i in as_main:
            interview_ids.add(i.id)
        for p in as_panel:
            interview_ids.add(p.interview_id)
        
        total_interviews = len(interview_ids)
        total_all_interviews += total_interviews
        
        completed = 0
        pending = 0
        all_scores = []
        
        for interview_id in interview_ids:
            interview = db.query(Interview).filter(Interview.id == interview_id).first()
            if interview:
                if interview.status == InterviewStatus.COMPLETED:
                    completed += 1
                    if interview.total_score is not None:
                        all_scores.append(interview.total_score)
                elif interview.status in [InterviewStatus.SCHEDULED, InterviewStatus.IN_PROGRESS]:
                    pending += 1
        
        total_all_completed += completed
        completion_rate = round(completed / total_interviews * 100, 1) if total_interviews > 0 else 0
        avg_score = round(statistics.mean(all_scores), 1) if all_scores else None
        score_std = round(statistics.stdev(all_scores), 2) if len(all_scores) > 1 else None
        
        if score_std is None:
            consistency_rating = "数据不足"
        elif score_std < 1:
            consistency_rating = "非常一致"
        elif score_std < 2:
            consistency_rating = "较为一致"
        else:
            consistency_rating = "波动较大"
        
        interviewer_stats.append({
            "id": str(interviewer.id),
            "name": interviewer.full_name or interviewer.email,
            "total_interviews": total_interviews,
            "completed_interviews": completed,
            "pending_interviews": pending,
            "completion_rate": completion_rate,
            "avg_score": avg_score,
            "score_std": score_std,
            "consistency_rating": consistency_rating
        })
    
    interviewer_stats.sort(key=lambda x: x['total_interviews'], reverse=True)
    
    summary = {
        "total_interviewers": len(interviewers),
        "total_interviews": total_all_interviews,
        "total_completed": total_all_completed,
        "overall_completion_rate": round(total_all_completed / total_all_interviews * 100, 1) if total_all_interviews > 0 else 0
    }
    
    return {
        "interviewers": interviewer_stats,
        "summary": summary
    }

def get_timeline_analytics(db: Session, days: int = 30) -> Dict[str, Any]:
    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=days)
    
    timeline_data = []
    current = start_date
    
    total_resumes = 0
    total_interviews = 0
    total_completed = 0
    total_offers = 0
    total_hires = 0
    
    while current <= end_date:
        date_str = current.strftime("%Y-%m-%d")
        next_day = current + timedelta(days=1)
        
        resumes_count = db.query(Resume).filter(
            Resume.created_at >= current,
            Resume.created_at < next_day
        ).count()
        
        interviews_scheduled = db.query(Interview).filter(
            Interview.created_at >= current,
            Interview.created_at < next_day
        ).count()
        
        interviews_completed = db.query(Interview).filter(
            Interview.status == InterviewStatus.COMPLETED,
            Interview.created_at >= current,
            Interview.created_at < next_day
        ).count()
        
        offers_sent = db.query(Resume).filter(
            Resume.status.in_([ResumeStatus.OFFER_PENDING, ResumeStatus.OFFER_ACCEPTED,
                              ResumeStatus.OFFER_REJECTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED]),
            Resume.created_at >= current,
            Resume.created_at < next_day
        ).count()
        
        hires = db.query(Resume).filter(
            Resume.status.in_([ResumeStatus.OFFER_ACCEPTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED]),
            Resume.created_at >= current,
            Resume.created_at < next_day
        ).count()
        
        timeline_data.append({
            "date": date_str,
            "resumes_received": resumes_count,
            "interviews_scheduled": interviews_scheduled,
            "interviews_completed": interviews_completed,
            "offers_sent": offers_sent,
            "hires": hires
        })
        
        total_resumes += resumes_count
        total_interviews += interviews_scheduled
        total_completed += interviews_completed
        total_offers += offers_sent
        total_hires += hires
        
        current = next_day
    
    summary = {
        "period_days": days,
        "total_resumes_received": total_resumes,
        "total_interviews_scheduled": total_interviews,
        "total_interviews_completed": total_completed,
        "total_offers_sent": total_offers,
        "total_hires": total_hires,
        "avg_resumes_per_day": round(total_resumes / days, 1) if days > 0 else 0,
        "avg_interviews_per_day": round(total_interviews / days, 1) if days > 0 else 0
    }
    
    return {
        "timeline": timeline_data,
        "summary": summary
    }

def get_overview(db: Session) -> Dict[str, Any]:
    total_positions = db.query(Position).count()
    active_positions = db.query(Position).filter(
        Position.status.in_([PositionStatus.OPEN, PositionStatus.PUBLISHED])
    ).count()
    
    total_resumes = db.query(Resume).count()
    pending_resumes = db.query(Resume).filter(
        Resume.status.in_([ResumeStatus.PENDING_SCREENING, ResumeStatus.PENDING_REVIEW,
                          ResumeStatus.PENDING_DEPT_REVIEW, ResumeStatus.PENDING_HR_DECISION])
    ).count()
    
    total_interviews = db.query(Interview).count()
    completed_interviews = db.query(Interview).filter(
        Interview.status == InterviewStatus.COMPLETED
    ).count()
    
    total_offers = db.query(Resume).filter(
        Resume.status.in_([ResumeStatus.OFFER_PENDING, ResumeStatus.OFFER_ACCEPTED,
                          ResumeStatus.OFFER_REJECTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED])
    ).count()
    
    accepted_offers = db.query(Resume).filter(
        Resume.status.in_([ResumeStatus.OFFER_ACCEPTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED])
    ).count()
    
    hired_resumes = db.query(Resume).filter(
        Resume.status.in_([ResumeStatus.OFFER_ACCEPTED, ResumeStatus.ONBOARDING, ResumeStatus.COMPLETED])
    ).all()
    
    time_to_hire_list = []
    for resume in hired_resumes:
        if resume.parsed_at:
            parsed_at = resume.parsed_at.replace(tzinfo=timezone.utc) if resume.parsed_at.tzinfo is None else resume.parsed_at
            days = (datetime.now(timezone.utc) - parsed_at).days
            time_to_hire_list.append(days)
    avg_time_to_hire = round(statistics.mean(time_to_hire_list), 1) if time_to_hire_list else None
    
    match_scores = db.query(Resume.match_score).filter(Resume.match_score.isnot(None)).all()
    avg_match_score = round(statistics.mean([s[0] for s in match_scores]), 1) if match_scores else None
    
    passed_interviews = db.query(Interview).filter(
        Interview.result == InterviewResult.PASSED
    ).count()
    interview_pass_rate = round(passed_interviews / completed_interviews * 100, 1) if completed_interviews > 0 else 0
    
    offer_accept_rate = round(accepted_offers / total_offers * 100, 1) if total_offers > 0 else 0
    
    metrics = {
        "total_positions": total_positions,
        "active_positions": active_positions,
        "total_resumes": total_resumes,
        "pending_resumes": pending_resumes,
        "total_interviews": total_interviews,
        "completed_interviews": completed_interviews,
        "total_offers": total_offers,
        "accepted_offers": accepted_offers,
        "avg_time_to_hire": avg_time_to_hire,
        "avg_match_score": avg_match_score,
        "interview_pass_rate": interview_pass_rate,
        "offer_accept_rate": offer_accept_rate
    }
    
    funnel = get_recruitment_funnel(db)
    recent_activities = get_recent_activities(db, limit=5)
    
    return {
        "metrics": metrics,
        "funnel": funnel,
        "recent_activities": recent_activities
    }
