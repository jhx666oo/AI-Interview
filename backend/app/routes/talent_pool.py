from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from app.config.database import get_db
from app.schemas.hr_modules import TalentPoolCreate, TalentPoolUpdate, TalentPoolResponse
from app.models.hr_models import TalentPoolEntry, TalentPoolStatus
from app.models.models import User, UserRole
from app.core.security import check_roles
from app.routes.auth import get_current_user

router = APIRouter(prefix="/talent-pool", tags=["talent-pool"])


@router.get("", response_model=List[TalentPoolResponse])
def list_talent(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(TalentPoolEntry)
    # 默认过滤掉待初筛和已淘汰的简历，人才库只展示已入库的
    if status:
        q = q.filter(TalentPoolEntry.status == status)
    else:
        q = q.filter(TalentPoolEntry.status.notin_(["pending_screening", "rejected"]))
    if search:
        q = q.filter(TalentPoolEntry.candidate_name.ilike(f"%{search}%"))
    return q.order_by(TalentPoolEntry.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=TalentPoolResponse)
def create_talent(data: TalentPoolCreate, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = TalentPoolEntry(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{entry_id}", response_model=TalentPoolResponse)
def get_talent(entry_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    obj = db.query(TalentPoolEntry).filter(TalentPoolEntry.id == entry_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Entry not found")
    return obj


@router.put("/{entry_id}", response_model=TalentPoolResponse)
def update_talent(entry_id: UUID, data: TalentPoolUpdate, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(TalentPoolEntry).filter(TalentPoolEntry.id == entry_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Entry not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        if k == "status" and v:
            setattr(obj, k, TalentPoolStatus(v))
        else:
            setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.post("/{entry_id}/contact", response_model=TalentPoolResponse)
def mark_contacted(entry_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(TalentPoolEntry).filter(TalentPoolEntry.id == entry_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Entry not found")
    obj.status = TalentPoolStatus.CONTACTED
    obj.last_contacted_at = datetime.utcnow()
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{entry_id}")
def delete_talent(entry_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(TalentPoolEntry).filter(TalentPoolEntry.id == entry_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(obj)
    db.commit()
    return {"detail": "Deleted"}
