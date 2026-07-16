from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from app.config.database import get_db
from app.schemas.hr_modules import ChannelCreate, ChannelUpdate, ChannelResponse
from app.models.hr_models import RecruitmentChannel, ChannelType
from app.models.models import User, UserRole
from app.core.security import check_roles
from app.routes.auth import get_current_user

router = APIRouter(prefix="/channels", tags=["channels"])


@router.get("", response_model=List[ChannelResponse])
def list_channels(skip: int = 0, limit: int = 100, active: Optional[bool] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(RecruitmentChannel)
    if active is not None:
        q = q.filter(RecruitmentChannel.is_active == active)
    return q.order_by(RecruitmentChannel.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=ChannelResponse)
def create_channel(data: ChannelCreate, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = RecruitmentChannel(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/{channel_id}", response_model=ChannelResponse)
def get_channel(channel_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    obj = db.query(RecruitmentChannel).filter(RecruitmentChannel.id == channel_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Channel not found")
    return obj


@router.put("/{channel_id}", response_model=ChannelResponse)
def update_channel(channel_id: UUID, data: ChannelUpdate, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(RecruitmentChannel).filter(RecruitmentChannel.id == channel_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Channel not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        if k == "channel_type" and v:
            setattr(obj, k, ChannelType(v))
        else:
            setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{channel_id}")
def delete_channel(channel_id: UUID, db: Session = Depends(get_db), current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))):
    obj = db.query(RecruitmentChannel).filter(RecruitmentChannel.id == channel_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Channel not found")
    db.delete(obj)
    db.commit()
    return {"detail": "Deleted"}
