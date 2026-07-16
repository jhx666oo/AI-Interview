from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.config.database import get_db
from app.schemas.position import (
    PositionCreate, PositionUpdate, PositionResponse,
    PositionWithStats, PositionStats, JDGenerateRequest,
    JDGenerateResponse, PositionDetailResponse, QuestionBankBrief,
    JDChatRequest
)
from app.services.position_service import (
    create_position, get_positions, get_positions_with_stats,
    get_position, update_position, delete_position,
    get_position_stats, get_linked_question_banks, generate_position_jd
)
from app.services.ai_service import generate_jd_stream, chat_jd_stream
from app.models.models import User, UserRole
from app.core.security import check_roles
from app.routes.auth import get_current_user
from typing import List
from uuid import UUID

router = APIRouter(
    prefix="/positions",
    tags=["positions"]
)

@router.post("", response_model=PositionResponse)
def create_position_route(
    position: PositionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    return create_position(db, position)

@router.get("", response_model=List[PositionWithStats])
def get_positions_route(
    skip: int = 0,
    limit: int = 100,
    status: str = None,
    title: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_positions_with_stats(db, skip=skip, limit=limit, status=status, title=title)

@router.get("/public", response_model=List[PositionResponse])
def get_public_positions_route(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return get_positions(db, skip=skip, limit=limit, status="published")

@router.post("/generate-jd", response_model=JDGenerateResponse)
def generate_jd_route(
    request: JDGenerateRequest,
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    result = generate_position_jd(
        title=request.title,
        department=request.department,
        location=request.location,
        salary_range=request.salary_range,
        keywords=request.keywords
    )
    return JDGenerateResponse(**result)

@router.post("/generate-jd-stream")
def generate_jd_stream_route(
    request: JDGenerateRequest,
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    return StreamingResponse(
        generate_jd_stream(
            title=request.title,
            department=request.department,
            location=request.location,
            salary_range=request.salary_range,
            keywords=request.keywords
        ),
        media_type="text/event-stream"
    )

@router.post("/chat-jd-stream")
def chat_jd_stream_route(
    request: JDChatRequest,
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    return StreamingResponse(
        chat_jd_stream(
            messages=request.messages,
            current_description=request.current_description,
            current_requirements=request.current_requirements
        ),
        media_type="text/event-stream"
    )

@router.get("/{position_id}", response_model=PositionDetailResponse)
def get_position_route(
    position_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    position = get_position(db, position_id)
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")

    stats = get_position_stats(db, position_id)
    linked_banks = get_linked_question_banks(db, position_id)

    hiring_manager_name = None
    if position.hiring_manager_id:
        from app.models.models import User
        user = db.query(User).filter(User.id == position.hiring_manager_id).first()
        if user:
            hiring_manager_name = user.full_name

    return PositionDetailResponse(
        **{c.name: getattr(position, c.name) for c in position.__table__.columns},
        stats=stats.model_dump(),
        hiring_manager_name=hiring_manager_name,
        linked_question_banks=[b.model_dump() for b in linked_banks]
    )

@router.get("/{position_id}/stats", response_model=PositionStats)
def get_position_stats_route(
    position_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    position = get_position(db, position_id)
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")
    return get_position_stats(db, position_id)

@router.get("/{position_id}/question-banks", response_model=List[QuestionBankBrief])
def get_position_question_banks_route(
    position_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    position = get_position(db, position_id)
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")
    return get_linked_question_banks(db, position_id)

@router.put("/{position_id}", response_model=PositionResponse)
def update_position_route(
    position_id: UUID,
    position: PositionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    db_position = update_position(db, position_id, position)
    if not db_position:
        raise HTTPException(status_code=404, detail="Position not found")
    return db_position

@router.delete("/{position_id}", response_model=PositionResponse)
def delete_position_route(
    position_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    db_position = delete_position(db, position_id)
    if not db_position:
        raise HTTPException(status_code=404, detail="Position not found")
    return db_position