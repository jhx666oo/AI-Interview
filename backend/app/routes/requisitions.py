from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from app.config.database import get_db
from app.schemas.hr_modules import RequisitionCreate, RequisitionUpdate, RequisitionResponse
from app.models.hr_models import JobRequisition, RequisitionStatus, RequisitionUrgency
from app.models.models import User, UserRole
from app.core.security import check_roles
from app.routes.auth import get_current_user

router = APIRouter(prefix="/requisitions", tags=["requisitions"])


@router.get("", response_model=List[RequisitionResponse])
def list_requisitions(
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
    department: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(JobRequisition)
    if status:
        q = q.filter(JobRequisition.status == status)
    if department:
        q = q.filter(JobRequisition.department.ilike(f"%{department}%"))
    return q.order_by(JobRequisition.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=RequisitionResponse)
def create_requisition(
    data: RequisitionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR])),
):
    obj = JobRequisition(**data.model_dump(), requested_by=current_user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{req_id}", response_model=RequisitionResponse)
def get_requisition(req_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    obj = db.query(JobRequisition).filter(JobRequisition.id == req_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Requisition not found")
    return obj


@router.put("/{req_id}", response_model=RequisitionResponse)
def update_requisition(req_id: UUID, data: RequisitionUpdate, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(JobRequisition).filter(JobRequisition.id == req_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Requisition not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        if k == "urgency" and v:
            setattr(obj, k, RequisitionUrgency(v))
        elif k == "status" and v:
            setattr(obj, k, RequisitionStatus(v))
        else:
            setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.post("/{req_id}/approve", response_model=RequisitionResponse)
def approve_requisition(req_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN]))):
    obj = db.query(JobRequisition).filter(JobRequisition.id == req_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Requisition not found")
    obj.status = RequisitionStatus.APPROVED
    obj.approved_by = current_user.id
    obj.approved_at = datetime.utcnow()
    obj.rejection_reason = None
    db.commit()
    db.refresh(obj)
    return obj


@router.post("/{req_id}/reject", response_model=RequisitionResponse)
def reject_requisition(req_id: UUID, reason: str = "", db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN]))):
    obj = db.query(JobRequisition).filter(JobRequisition.id == req_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Requisition not found")
    obj.status = RequisitionStatus.REJECTED
    obj.approved_by = current_user.id
    obj.approved_at = datetime.utcnow()
    obj.rejection_reason = reason
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{req_id}")
def delete_requisition(req_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(JobRequisition).filter(JobRequisition.id == req_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Requisition not found")
    db.delete(obj)
    db.commit()
    return {"detail": "Deleted"}
