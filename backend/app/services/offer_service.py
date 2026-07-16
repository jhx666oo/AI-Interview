from sqlalchemy.orm import Session
from sqlalchemy import desc, and_, or_
from app.models.models import (
    Offer, OfferStatus, Resume, ResumeStatus, Position, PositionStatus, User
)
from app.schemas.offer import OfferCreate, OfferUpdate, OfferStats
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from uuid import UUID
import logging
import secrets

from app.services.mail_service import MailService

logger = logging.getLogger(__name__)

def create_offer(db: Session, offer_data: OfferCreate, user_id: UUID) -> Offer:
    resume = db.query(Resume).filter(Resume.id == offer_data.resume_id).first()
    if not resume:
        raise ValueError("简历不存在")
    
    position = db.query(Position).filter(Position.id == offer_data.position_id).first()
    if not position:
        raise ValueError("岗位不存在")
    
    existing_offer = db.query(Offer).filter(
        Offer.resume_id == offer_data.resume_id,
        Offer.status.in_([OfferStatus.DRAFT, OfferStatus.PENDING, OfferStatus.SENT])
    ).first()
    if existing_offer:
        raise ValueError("该候选人已有进行中的Offer")
    
    offer = Offer(
        resume_id=offer_data.resume_id,
        position_id=offer_data.position_id,
        candidate_name=offer_data.candidate_name,
        candidate_email=offer_data.candidate_email,
        salary_monthly=float(offer_data.salary_monthly) if offer_data.salary_monthly else None,
        salary_annual=float(offer_data.salary_annual) if offer_data.salary_annual else None,
        salary_structure=offer_data.salary_structure,
        position_title=offer_data.position_title,
        department=offer_data.department,
        report_to=offer_data.report_to,
        work_location=offer_data.work_location,
        work_hours=offer_data.work_hours,
        onboard_date=offer_data.onboard_date,
        probation_months=offer_data.probation_months or 3,
        benefits=offer_data.benefits,
        bonus=offer_data.bonus,
        special_terms=offer_data.special_terms,
        notes=offer_data.notes,
        valid_until=offer_data.valid_until,
        status=OfferStatus.DRAFT,
        created_by=user_id
    )
    
    db.add(offer)
    db.commit()
    db.refresh(offer)
    
    return offer

def get_offers(
    db: Session,
    page: int = 1,
    page_size: int = 10,
    status: Optional[str] = None,
    position_id: Optional[UUID] = None,
    search: Optional[str] = None
) -> Dict[str, Any]:
    query = db.query(Offer)
    
    if status:
        query = query.filter(Offer.status == status)
    
    if position_id:
        query = query.filter(Offer.position_id == position_id)
    
    if search:
        query = query.filter(
            or_(
                Offer.candidate_name.ilike(f"%{search}%"),
                Offer.candidate_email.ilike(f"%{search}%"),
                Offer.position_title.ilike(f"%{search}%")
            )
        )
    
    total = query.count()
    total_pages = (total + page_size - 1) // page_size
    
    offers = query.order_by(desc(Offer.created_at)).offset((page - 1) * page_size).limit(page_size).all()
    
    items = []
    for offer in offers:
        item = {
            "id": str(offer.id),
            "resume_id": str(offer.resume_id),
            "position_id": str(offer.position_id),
            "candidate_name": offer.candidate_name,
            "candidate_email": offer.candidate_email,
            "salary_monthly": offer.salary_monthly,
            "salary_annual": offer.salary_annual,
            "salary_structure": offer.salary_structure,
            "position_title": offer.position_title,
            "department": offer.department,
            "report_to": offer.report_to,
            "work_location": offer.work_location,
            "work_hours": offer.work_hours,
            "onboard_date": offer.onboard_date,
            "probation_months": offer.probation_months,
            "benefits": offer.benefits,
            "bonus": offer.bonus,
            "special_terms": offer.special_terms,
            "notes": offer.notes,
            "valid_until": offer.valid_until,
            "status": offer.status.value,
            "sent_at": offer.sent_at,
            "accepted_at": offer.accepted_at,
            "rejected_at": offer.rejected_at,
            "rejected_reason": offer.rejected_reason,
            "created_at": offer.created_at,
            "updated_at": offer.updated_at,
            "created_by": str(offer.created_by) if offer.created_by else None,
            "position_info": {
                "id": str(offer.position.id),
                "title": offer.position.title,
                "department": offer.position.department,
                "location": offer.position.location,
                "salary_range": offer.position.salary_range
            } if offer.position else None,
            "resume_info": {
                "id": str(offer.resume.id),
                "candidate_name": offer.resume.candidate_name,
                "email": offer.resume.email,
                "match_score": offer.resume.match_score
            } if offer.resume else None
        }
        items.append(item)
    
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages
    }

def get_offer(db: Session, offer_id: UUID) -> Optional[Dict[str, Any]]:
    offer = db.query(Offer).filter(Offer.id == offer_id).first()
    if not offer:
        return None
    
    return {
        "id": str(offer.id),
        "resume_id": str(offer.resume_id),
        "position_id": str(offer.position_id),
        "candidate_name": offer.candidate_name,
        "candidate_email": offer.candidate_email,
        "salary_monthly": offer.salary_monthly,
        "salary_annual": offer.salary_annual,
        "salary_structure": offer.salary_structure,
        "position_title": offer.position_title,
        "department": offer.department,
        "report_to": offer.report_to,
        "work_location": offer.work_location,
        "work_hours": offer.work_hours,
        "onboard_date": offer.onboard_date,
        "probation_months": offer.probation_months,
        "benefits": offer.benefits,
        "bonus": offer.bonus,
        "special_terms": offer.special_terms,
        "notes": offer.notes,
        "valid_until": offer.valid_until,
        "status": offer.status.value,
        "sent_at": offer.sent_at,
        "accepted_at": offer.accepted_at,
        "rejected_at": offer.rejected_at,
        "rejected_reason": offer.rejected_reason,
        "created_at": offer.created_at,
        "updated_at": offer.updated_at,
        "created_by": str(offer.created_by) if offer.created_by else None,
        "position_info": {
            "id": str(offer.position.id),
            "title": offer.position.title,
            "department": offer.position.department,
            "location": offer.position.location,
            "salary_range": offer.position.salary_range
        } if offer.position else None,
        "resume_info": {
            "id": str(offer.resume.id),
            "candidate_name": offer.resume.candidate_name,
            "email": offer.resume.email,
            "match_score": offer.resume.match_score
        } if offer.resume else None
    }

def update_offer(db: Session, offer_id: UUID, offer_data: OfferUpdate) -> Optional[Offer]:
    offer = db.query(Offer).filter(Offer.id == offer_id).first()
    if not offer:
        return None
    
    if offer.status not in [OfferStatus.DRAFT, OfferStatus.PENDING]:
        raise ValueError("当前状态不允许修改")
    
    update_fields = [
        'salary_monthly', 'salary_annual', 'salary_structure', 'position_title',
        'department', 'report_to', 'work_location', 'work_hours', 'onboard_date',
        'probation_months', 'benefits', 'bonus', 'special_terms', 'notes', 'valid_until', 'status'
    ]
    
    for field in update_fields:
        value = getattr(offer_data, field, None)
        if value is not None:
            if field in ['salary_monthly', 'salary_annual'] and value is not None:
                value = float(value)
            setattr(offer, field, value)
    
    db.commit()
    db.refresh(offer)
    
    return offer

def send_offer(db: Session, offer_id: UUID, send_email: bool = True, custom_message: Optional[str] = None, base_url: str = "http://localhost:5173") -> Dict[str, Any]:
    offer = db.query(Offer).filter(Offer.id == offer_id).first()
    if not offer:
        raise ValueError("Offer不存在")
    
    if offer.status not in [OfferStatus.DRAFT, OfferStatus.PENDING]:
        raise ValueError("当前状态不允许发送")
    
    token = secrets.token_urlsafe(32)
    offer.token = token
    offer.status = OfferStatus.SENT
    offer.sent_at = datetime.utcnow()
    db.commit()
    
    resume = db.query(Resume).filter(Resume.id == offer.resume_id).first()
    if resume:
        resume.status = ResumeStatus.OFFER_PENDING
        db.commit()
    
    result = {
        "success": True,
        "email_sent": False,
        "error": None,
        "token": token
    }
    
    if send_email:
        try:
            mail_service = MailService(db)
            confirm_url = f"{base_url}/offer-confirm/{token}"
            email_result = mail_service.send_offer_email(
                offer=offer,
                custom_message=custom_message,
                confirm_url=confirm_url
            )
            result["email_sent"] = email_result
        except Exception as e:
            logger.error(f"Failed to send offer email: {e}")
            result["error"] = str(e)
    
    return result

def accept_offer(db: Session, offer_id: UUID, accepted_salary: Optional[float] = None, 
                 accepted_onboard_date: Optional[datetime] = None, notes: Optional[str] = None) -> Offer:
    offer = db.query(Offer).filter(Offer.id == offer_id).first()
    if not offer:
        raise ValueError("Offer不存在")
    
    if offer.status != OfferStatus.SENT:
        raise ValueError("当前状态不允许接受")
    
    if offer.valid_until and datetime.utcnow() > offer.valid_until:
        offer.status = OfferStatus.EXPIRED
        db.commit()
        raise ValueError("Offer已过期")
    
    offer.status = OfferStatus.ACCEPTED
    offer.accepted_at = datetime.utcnow()
    
    if accepted_salary:
        offer.salary_monthly = accepted_salary
    if accepted_onboard_date:
        offer.onboard_date = accepted_onboard_date
    if notes:
        offer.notes = notes
    
    db.commit()
    
    resume = db.query(Resume).filter(Resume.id == offer.resume_id).first()
    if resume:
        resume.status = ResumeStatus.OFFER_ACCEPTED
        db.commit()
    
    return offer

def reject_offer(db: Session, offer_id: UUID, reason: str, feedback: Optional[str] = None) -> Offer:
    offer = db.query(Offer).filter(Offer.id == offer_id).first()
    if not offer:
        raise ValueError("Offer不存在")
    
    if offer.status not in [OfferStatus.SENT, OfferStatus.PENDING]:
        raise ValueError("当前状态不允许拒绝")
    
    offer.status = OfferStatus.REJECTED
    offer.rejected_at = datetime.utcnow()
    offer.rejected_reason = reason
    if feedback:
        offer.notes = (offer.notes or "") + f"\n候选人反馈: {feedback}"
    
    db.commit()
    
    resume = db.query(Resume).filter(Resume.id == offer.resume_id).first()
    if resume:
        resume.status = ResumeStatus.OFFER_REJECTED
        db.commit()
    
    return offer

def withdraw_offer(db: Session, offer_id: UUID, reason: Optional[str] = None) -> Offer:
    offer = db.query(Offer).filter(Offer.id == offer_id).first()
    if not offer:
        raise ValueError("Offer不存在")
    
    if offer.status not in [OfferStatus.DRAFT, OfferStatus.PENDING, OfferStatus.SENT]:
        raise ValueError("当前状态不允许撤回")
    
    offer.status = OfferStatus.WITHDRAWN
    if reason:
        offer.notes = (offer.notes or "") + f"\n撤回原因: {reason}"
    
    db.commit()
    
    return offer

def reopen_offer(db: Session, offer_id: UUID) -> Offer:
    offer = db.query(Offer).filter(Offer.id == offer_id).first()
    if not offer:
        raise ValueError("Offer不存在")
    
    if offer.status not in [OfferStatus.ACCEPTED, OfferStatus.REJECTED, OfferStatus.WITHDRAWN, OfferStatus.EXPIRED]:
        raise ValueError("当前状态不允许重新打开")
    
    old_status = offer.status.value
    offer.status = OfferStatus.SENT
    offer.token = secrets.token_urlsafe(32)
    offer.notes = (offer.notes or "") + f"\n重新打开（原状态：{old_status}）"
    
    db.commit()
    
    resume = db.query(Resume).filter(Resume.id == offer.resume_id).first()
    if resume:
        resume.status = ResumeStatus.OFFER_PENDING
        db.commit()
    
    return offer

def get_offer_stats(db: Session) -> Dict[str, Any]:
    total_offers = db.query(Offer).count()
    pending_offers = db.query(Offer).filter(Offer.status == OfferStatus.PENDING).count()
    sent_offers = db.query(Offer).filter(Offer.status == OfferStatus.SENT).count()
    accepted_offers = db.query(Offer).filter(Offer.status == OfferStatus.ACCEPTED).count()
    rejected_offers = db.query(Offer).filter(Offer.status == OfferStatus.REJECTED).count()
    expired_offers = db.query(Offer).filter(Offer.status == OfferStatus.EXPIRED).count()
    
    total_decided = accepted_offers + rejected_offers
    acceptance_rate = round(accepted_offers / total_decided * 100, 1) if total_decided > 0 else 0
    
    accepted_offers_list = db.query(Offer).filter(
        Offer.status == OfferStatus.ACCEPTED,
        Offer.sent_at.isnot(None),
        Offer.accepted_at.isnot(None)
    ).all()
    
    response_days = []
    for offer in accepted_offers_list:
        if offer.sent_at and offer.accepted_at:
            days = (offer.accepted_at - offer.sent_at).days
            response_days.append(days)
    
    avg_response_days = round(sum(response_days) / len(response_days), 1) if response_days else None
    
    return {
        "total_offers": total_offers,
        "pending_offers": pending_offers,
        "sent_offers": sent_offers,
        "accepted_offers": accepted_offers,
        "rejected_offers": rejected_offers,
        "expired_offers": expired_offers,
        "acceptance_rate": acceptance_rate,
        "avg_response_days": avg_response_days
    }

def get_pending_offers_for_resume(db: Session, resume_id: UUID) -> List[Offer]:
    return db.query(Offer).filter(
        Offer.resume_id == resume_id,
        Offer.status.in_([OfferStatus.DRAFT, OfferStatus.PENDING, OfferStatus.SENT])
    ).all()

def mark_expired_offers(db: Session) -> int:
    expired_count = db.query(Offer).filter(
        Offer.status == OfferStatus.SENT,
        Offer.valid_until < datetime.utcnow()
    ).update({"status": OfferStatus.EXPIRED})
    
    db.commit()
    return expired_count

def get_offer_by_token(db: Session, token: str) -> Optional[Dict[str, Any]]:
    offer = db.query(Offer).filter(Offer.token == token).first()
    if not offer:
        return None
    
    return {
        "id": str(offer.id),
        "resume_id": str(offer.resume_id),
        "position_id": str(offer.position_id),
        "candidate_name": offer.candidate_name,
        "candidate_email": offer.candidate_email,
        "salary_monthly": offer.salary_monthly,
        "salary_annual": offer.salary_annual,
        "salary_structure": offer.salary_structure,
        "position_title": offer.position_title,
        "department": offer.department,
        "report_to": offer.report_to,
        "work_location": offer.work_location,
        "work_hours": offer.work_hours,
        "onboard_date": offer.onboard_date,
        "probation_months": offer.probation_months,
        "benefits": offer.benefits,
        "bonus": offer.bonus,
        "special_terms": offer.special_terms,
        "notes": offer.notes,
        "valid_until": offer.valid_until,
        "status": offer.status.value,
        "sent_at": offer.sent_at,
        "created_at": offer.created_at,
        "position_info": {
            "id": str(offer.position.id),
            "title": offer.position.title,
            "department": offer.position.department,
            "location": offer.position.location,
            "salary_range": offer.position.salary_range
        } if offer.position else None,
        "resume_info": {
            "id": str(offer.resume.id),
            "candidate_name": offer.resume.candidate_name,
            "email": offer.resume.email,
            "match_score": offer.resume.match_score
        } if offer.resume else None
    }

def confirm_offer_by_token(db: Session, token: str, action: str, reason: Optional[str] = None, 
                           accepted_salary: Optional[float] = None, accepted_onboard_date: Optional[datetime] = None) -> Dict[str, Any]:
    offer = db.query(Offer).filter(Offer.token == token).first()
    if not offer:
        return {"success": False, "error": "无效的确认链接"}
    
    if offer.status != OfferStatus.SENT:
        status_text = {
            OfferStatus.ACCEPTED: "已接受",
            OfferStatus.REJECTED: "已拒绝",
            OfferStatus.EXPIRED: "已过期",
            OfferStatus.WITHDRAWN: "已撤回",
            OfferStatus.DRAFT: "未发送",
            OfferStatus.PENDING: "待发送"
        }.get(offer.status, "未知状态")
        return {"success": False, "error": f"Offer当前状态为：{status_text}"}
    
    if offer.valid_until and datetime.utcnow() > offer.valid_until:
        offer.status = OfferStatus.EXPIRED
        db.commit()
        return {"success": False, "error": "Offer已过期"}
    
    if action == "accept":
        offer.status = OfferStatus.ACCEPTED
        offer.accepted_at = datetime.utcnow()
        if accepted_salary:
            offer.salary_monthly = accepted_salary
        if accepted_onboard_date:
            offer.onboard_date = accepted_onboard_date
        
        resume = db.query(Resume).filter(Resume.id == offer.resume_id).first()
        if resume:
            resume.status = ResumeStatus.OFFER_ACCEPTED
        
        db.commit()
        return {"success": True, "action": "accepted", "message": "您已成功接受Offer！"}
    
    elif action == "reject":
        offer.status = OfferStatus.REJECTED
        offer.rejected_at = datetime.utcnow()
        if reason:
            offer.rejected_reason = reason
        
        resume = db.query(Resume).filter(Resume.id == offer.resume_id).first()
        if resume:
            resume.status = ResumeStatus.OFFER_REJECTED
        
        db.commit()
        return {"success": True, "action": "rejected", "message": "您已拒绝此Offer。"}
    
    else:
        return {"success": False, "error": "无效的操作"}
