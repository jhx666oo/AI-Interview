from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional, Any
from uuid import UUID
from datetime import datetime
from app.config.database import get_db
from app.schemas.hr_modules import ProbationCreate, ProbationUpdate, ProbationResponse
from app.models.hr_models import ProbationRecord, ProbationResult
from app.models.models import User, UserRole
from app.core.security import check_roles
from app.routes.auth import get_current_user

router = APIRouter(prefix="/probation", tags=["probation"])


@router.get("", response_model=List[ProbationResponse])
def list_probation(skip: int = 0, limit: int = 100, result: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(ProbationRecord)
    if result:
        q = q.filter(ProbationRecord.result == result)
    return q.order_by(ProbationRecord.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=ProbationResponse)
def create_probation(data: ProbationCreate, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    d = data.model_dump()
    start = d.get("probation_start")
    months = d.get("probation_months", 3)
    end = None
    if start:
        from dateutil.relativedelta import relativedelta
        end = start + relativedelta(months=months)
    obj = ProbationRecord(**d, probation_end=end, monthly_reviews=[])
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{record_id}", response_model=ProbationResponse)
def get_probation(record_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    obj = db.query(ProbationRecord).filter(ProbationRecord.id == record_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Probation record not found")
    return obj


@router.put("/{record_id}", response_model=ProbationResponse)
def update_probation(record_id: UUID, data: ProbationUpdate, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(ProbationRecord).filter(ProbationRecord.id == record_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Probation record not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        if k == "result" and v:
            setattr(obj, k, ProbationResult(v))
            if v in ("confirmed", "terminated"):
                obj.confirmed_at = datetime.utcnow()
                obj.confirmed_by = current_user.id
        elif k == "probation_start" and v:
            setattr(obj, k, v)
            from dateutil.relativedelta import relativedelta
            obj.probation_end = v + relativedelta(months=obj.probation_months or 3)
        elif k == "probation_months" and v:
            setattr(obj, k, v)
            if obj.probation_start:
                from dateutil.relativedelta import relativedelta
                obj.probation_end = obj.probation_start + relativedelta(months=v)
        else:
            setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.post("/{record_id}/review", response_model=ProbationResponse)
def add_monthly_review(record_id: UUID, review: dict, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(ProbationRecord).filter(ProbationRecord.id == record_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Probation record not found")
    reviews = obj.monthly_reviews or []
    review["reviewed_by"] = str(current_user.id)
    review["reviewed_at"] = datetime.utcnow().isoformat()
    reviews.append(review)
    obj.monthly_reviews = reviews
    db.commit()
    db.refresh(obj)
    return obj


@router.post("/{record_id}/confirm", response_model=ProbationResponse)
def confirm_probation(record_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(ProbationRecord).filter(ProbationRecord.id == record_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Probation record not found")
    obj.result = ProbationResult.CONFIRMED
    obj.confirmed_at = datetime.utcnow()
    obj.confirmed_by = current_user.id
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{record_id}")
def delete_probation(record_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(ProbationRecord).filter(ProbationRecord.id == record_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Probation record not found")
    db.delete(obj)
    db.commit()
    return {"detail": "Deleted"}
