from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID
from pydantic import BaseModel
from datetime import datetime
from app.config.database import get_db
from app.schemas.offer import (
    OfferCreate, OfferUpdate, OfferResponse, OfferListResponse,
    OfferSendRequest, OfferAcceptRequest, OfferRejectRequest, OfferStats
)
from app.services import offer_service
from app.core.security import get_current_user_dep
from app.models.models import User

router = APIRouter(
    prefix="/offers",
    tags=["offers"],
    responses={404: {"description": "Not found"}},
)

class OfferConfirmRequest(BaseModel):
    action: str
    reason: Optional[str] = None
    accepted_salary: Optional[float] = None
    accepted_onboard_date: Optional[datetime] = None

@router.post("", response_model=OfferResponse)
def create_offer(
    offer_data: OfferCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep)
):
    try:
        offer = offer_service.create_offer(db, offer_data, current_user.id)
        return offer_service.get_offer(db, offer.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("", response_model=OfferListResponse)
def list_offers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    status: Optional[str] = None,
    position_id: Optional[UUID] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep)
):
    return offer_service.get_offers(db, page, page_size, status, position_id, search)

@router.get("/stats", response_model=OfferStats)
def get_offer_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep)
):
    return offer_service.get_offer_stats(db)

@router.get("/{offer_id}", response_model=OfferResponse)
def get_offer(
    offer_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep)
):
    offer = offer_service.get_offer(db, offer_id)
    if not offer:
        raise HTTPException(status_code=404, detail="Offer不存在")
    return offer

@router.put("/{offer_id}", response_model=OfferResponse)
def update_offer(
    offer_id: UUID,
    offer_data: OfferUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep)
):
    try:
        offer = offer_service.update_offer(db, offer_id, offer_data)
        if not offer:
            raise HTTPException(status_code=404, detail="Offer不存在")
        return offer_service.get_offer(db, offer.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{offer_id}/send")
def send_offer(
    offer_id: UUID,
    request: OfferSendRequest = OfferSendRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep)
):
    try:
        from app.models.models import SystemConfig
        config = db.query(SystemConfig).first()
        base_url = "http://localhost:5173"
        if config and hasattr(config, 'frontend_url') and config.frontend_url:
            base_url = config.frontend_url
        result = offer_service.send_offer(db, offer_id, request.send_email, request.custom_message, base_url)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{offer_id}/accept")
def accept_offer(
    offer_id: UUID,
    request: OfferAcceptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep)
):
    try:
        offer = offer_service.accept_offer(
            db, offer_id, 
            request.accepted_salary,
            request.accepted_onboard_date,
            request.notes
        )
        return {"success": True, "message": "Offer已接受", "offer_id": str(offer.id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{offer_id}/reject")
def reject_offer(
    offer_id: UUID,
    request: OfferRejectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep)
):
    try:
        offer = offer_service.reject_offer(db, offer_id, request.reason, request.feedback)
        return {"success": True, "message": "Offer已拒绝", "offer_id": str(offer.id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{offer_id}/withdraw")
def withdraw_offer(
    offer_id: UUID,
    reason: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep)
):
    try:
        offer = offer_service.withdraw_offer(db, offer_id, reason)
        return {"success": True, "message": "Offer已撤回", "offer_id": str(offer.id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{offer_id}/reopen")
def reopen_offer(
    offer_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep)
):
    try:
        offer = offer_service.reopen_offer(db, offer_id)
        return {"success": True, "message": "Offer已重新打开", "offer_id": str(offer.id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{offer_id}")
def delete_offer(
    offer_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep)
):
    from app.models.models import Offer, OfferStatus
    offer = db.query(Offer).filter(Offer.id == offer_id).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Offer不存在")
    
    if offer.status not in [OfferStatus.DRAFT, OfferStatus.WITHDRAWN]:
        raise HTTPException(status_code=400, detail="只能删除草稿或已撤回的Offer")
    
    db.delete(offer)
    db.commit()
    return {"success": True, "message": "Offer已删除"}

public_router = APIRouter(
    prefix="/public/offers",
    tags=["public-offers"],
)

@public_router.get("/confirm/{token}")
def get_offer_by_token(
    token: str,
    db: Session = Depends(get_db)
):
    offer = offer_service.get_offer_by_token(db, token)
    if not offer:
        raise HTTPException(status_code=404, detail="无效的确认链接")
    return offer

@public_router.post("/confirm/{token}")
def confirm_offer_by_token(
    token: str,
    request: OfferConfirmRequest,
    db: Session = Depends(get_db)
):
    result = offer_service.confirm_offer_by_token(
        db, token, request.action, request.reason,
        request.accepted_salary, request.accepted_onboard_date
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result
