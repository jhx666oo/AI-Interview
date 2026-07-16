from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from app.config.database import get_db
from app.schemas.question_bank import QuestionBankResponse, QuestionCategory, QuestionDifficulty, QuestionBankCreate, QuestionBankUpdate
from app.services.question_bank_service import (
    create_question_bank, get_question_banks, get_question_bank, update_question_bank, delete_question_bank
)
from app.models.models import User, UserRole
from app.core.security import check_roles
from app.routes.auth import get_current_user
from typing import List, Optional
from uuid import UUID

router = APIRouter(
    prefix="/question-banks",
    tags=["question-banks"]
)

@router.post("", response_model=QuestionBankResponse)
def create_question_bank_route(
    name: str = Form(...),
    category: str = Form(...),
    difficulty: str = Form(...),
    tags: str = Form(None),
    position_id: UUID = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    tags_list = tags.split(",") if tags else []
    return create_question_bank(
        db,
        name,
        QuestionCategory(category),
        QuestionDifficulty(difficulty),
        tags_list,
        file,
        position_id
    )

@router.get("", response_model=List[QuestionBankResponse])
def get_question_banks_route(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_question_banks(db, skip=skip, limit=limit)

@router.get("/{question_bank_id}", response_model=QuestionBankResponse)
def get_question_bank_route(
    question_bank_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    question_bank = get_question_bank(db, question_bank_id)
    if not question_bank:
        raise HTTPException(status_code=404, detail="Question bank not found")
    return question_bank

@router.put("/{question_bank_id}", response_model=QuestionBankResponse)
def update_question_bank_route(
    question_bank_id: UUID,
    update_data: QuestionBankUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    """更新题库信息"""
    db_question_bank = update_question_bank(db, question_bank_id, update_data)
    if not db_question_bank:
        raise HTTPException(status_code=404, detail="Question bank not found")
    return db_question_bank

@router.delete("/{question_bank_id}", response_model=QuestionBankResponse)
def delete_question_bank_route(
    question_bank_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    db_question_bank = delete_question_bank(db, question_bank_id)
    if not db_question_bank:
        raise HTTPException(status_code=404, detail="Question bank not found")
    return db_question_bank
