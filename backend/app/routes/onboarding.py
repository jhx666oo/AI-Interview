from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from app.config.database import get_db
from app.schemas.hr_modules import OnboardingCreate, OnboardingUpdate, OnboardingResponse
from app.models.hr_models import OnboardingRecord, OnboardingStatus
from app.models.models import User, UserRole
from app.core.security import check_roles
from app.routes.auth import get_current_user

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


@router.get("", response_model=List[OnboardingResponse])
def list_onboarding(skip: int = 0, limit: int = 100, status: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(OnboardingRecord)
    if status:
        q = q.filter(OnboardingRecord.status == status)
    return q.order_by(OnboardingRecord.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=OnboardingResponse)
def create_onboarding(data: OnboardingCreate, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = OnboardingRecord(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{record_id}", response_model=OnboardingResponse)
def get_onboarding(record_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    obj = db.query(OnboardingRecord).filter(OnboardingRecord.id == record_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Onboarding record not found")
    return obj


@router.put("/{record_id}", response_model=OnboardingResponse)
def update_onboarding(record_id: UUID, data: OnboardingUpdate, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(OnboardingRecord).filter(OnboardingRecord.id == record_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Onboarding record not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        if k == "status" and v:
            setattr(obj, k, OnboardingStatus(v))
        else:
            setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{record_id}")
def delete_onboarding(record_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(OnboardingRecord).filter(OnboardingRecord.id == record_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Onboarding record not found")
    db.delete(obj)
    db.commit()
    return {"detail": "Deleted"}
