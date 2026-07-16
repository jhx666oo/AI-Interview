from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from app.config.database import get_db
from app.schemas.hr_modules import BackgroundCheckCreate, BackgroundCheckUpdate, BackgroundCheckResponse
from app.models.hr_models import BackgroundCheck, BackgroundCheckStatus, BackgroundCheckResult
from app.models.models import User, UserRole
from app.core.security import check_roles
from app.routes.auth import get_current_user

router = APIRouter(prefix="/background-checks", tags=["background-checks"])


@router.get("", response_model=List[BackgroundCheckResponse])
def list_checks(skip: int = 0, limit: int = 100, status: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(BackgroundCheck)
    if status:
        q = q.filter(BackgroundCheck.status == status)
    return q.order_by(BackgroundCheck.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=BackgroundCheckResponse)
def create_check(data: BackgroundCheckCreate, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = BackgroundCheck(**data.model_dump(), conducted_by=current_user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{check_id}", response_model=BackgroundCheckResponse)
def get_check(check_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    obj = db.query(BackgroundCheck).filter(BackgroundCheck.id == check_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Background check not found")
    return obj


@router.put("/{check_id}", response_model=BackgroundCheckResponse)
def update_check(check_id: UUID, data: BackgroundCheckUpdate, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(BackgroundCheck).filter(BackgroundCheck.id == check_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Background check not found")
    upd = data.model_dump(exclude_unset=True)
    for k, v in upd.items():
        if k == "status" and v:
            setattr(obj, k, BackgroundCheckStatus(v))
            if v == "completed":
                obj.conducted_at = datetime.utcnow()
        elif k == "overall_result" and v:
            setattr(obj, k, BackgroundCheckResult(v))
        else:
            setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{check_id}")
def delete_check(check_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(BackgroundCheck).filter(BackgroundCheck.id == check_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Background check not found")
    db.delete(obj)
    db.commit()
    return {"detail": "Deleted"}
