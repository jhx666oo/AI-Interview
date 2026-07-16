from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from app.config.database import get_db
from app.models.models import Resume, DepartmentReview, User, ResumeStatus
from app.schemas.resume import DepartmentReviewUpdate
from typing import Optional
from uuid import UUID

router = APIRouter(
    prefix="/public/review",
    tags=["public-review"]
)


@router.get("/{resume_id}")
def get_resume_for_review(
    resume_id: UUID,
    reviewer_id: UUID = Query(...),
    db: Session = Depends(get_db)
):
    resume = db.query(Resume).options(
        joinedload(Resume.position),
        joinedload(Resume.department_reviews)
    ).filter(Resume.id == resume_id).first()
    
    if not resume:
        raise HTTPException(status_code=404, detail="简历不存在")
    
    existing_review = None
    for review in resume.department_reviews:
        if review.reviewer_id == reviewer_id:
            existing_review = {
                "id": str(review.id),
                "technical_score": review.technical_score,
                "experience_score": review.experience_score,
                "overall_score": review.overall_score,
                "recommendation": review.recommendation,
                "comment": review.comment,
                "is_completed": review.is_completed,
            }
            break
    
    return {
        "resume": {
            "id": str(resume.id),
            "candidate_name": resume.candidate_name,
            "email": resume.email,
            "contact": resume.contact,
            "match_score": resume.match_score,
            "ai_review": resume.ai_review,
            "resume_markdown": resume.resume_markdown,
            "parsed_data": resume.parsed_data,
            "status": resume.status.value if resume.status else None,
            "position": {
                "id": str(resume.position.id) if resume.position else None,
                "title": resume.position.title if resume.position else None,
                "description": resume.position.description if resume.position else None,
                "requirements": resume.position.requirements if resume.position else None,
            } if resume.position else None,
        },
        "existing_review": existing_review,
    }


@router.post("/{resume_id}/submit")
def submit_review(
    resume_id: UUID,
    reviewer_id: UUID = Query(...),
    technical_score: int = Query(None),
    experience_score: int = Query(None),
    overall_score: int = Query(None),
    recommendation: str = Query(None),
    comment: str = Query(None),
    db: Session = Depends(get_db)
):
    resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="简历不存在")
    
    review = db.query(DepartmentReview).filter(
        DepartmentReview.resume_id == resume_id,
        DepartmentReview.reviewer_id == reviewer_id
    ).first()
    
    if not review:
        review = DepartmentReview(
            resume_id=resume_id,
            reviewer_id=reviewer_id,
        )
        db.add(review)
    
    if review.is_completed:
        raise HTTPException(status_code=400, detail="该评审已完成，不可修改")
    
    review.technical_score = technical_score
    review.experience_score = experience_score
    review.overall_score = overall_score
    review.recommendation = recommendation
    review.comment = comment
    review.is_completed = True
    
    db.commit()
    db.refresh(review)
    
    all_reviews = db.query(DepartmentReview).filter(
        DepartmentReview.resume_id == resume_id
    ).all()
    
    if all(r.is_completed for r in all_reviews):
        resume.status = ResumeStatus.PENDING_HR_DECISION
        db.commit()
    
    return {"message": "审核已提交", "review_id": str(review.id)}