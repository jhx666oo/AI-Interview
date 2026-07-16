from sqlalchemy.orm import Session
from app.models.models import QuestionBank, QuestionCategory, QuestionDifficulty, CodingTest
from app.schemas.question_bank import QuestionBankCreate, QuestionBankUpdate
from uuid import UUID
from fastapi import UploadFile, HTTPException
from app.utils.file_storage import save_upload_file
import json

from typing import List

def create_question_bank(
    db: Session,
    name: str,
    category: QuestionCategory,
    difficulty: QuestionDifficulty,
    tags: List[str],
    file: UploadFile,
    position_id: UUID
):
    file_path = save_upload_file(file, "question_banks")

    # TODO: 解析文件内容，提取题目
    # 这里先模拟解析结果
    questions = []

    db_question_bank = QuestionBank(
        name=name,
        category=category,
        difficulty=difficulty,
        tags=tags,
        source_file=file_path,
        questions=questions,
        position_id=position_id
    )
    db.add(db_question_bank)
    db.commit()
    db.refresh(db_question_bank)
    return db_question_bank

def get_question_banks(db: Session, skip: int = 0, limit: int = 100):
    return db.query(QuestionBank).offset(skip).limit(limit).all()

def get_question_bank(db: Session, question_bank_id: UUID):
    return db.query(QuestionBank).filter(QuestionBank.id == question_bank_id).first()

def update_question_bank(db: Session, question_bank_id: UUID, update_data: QuestionBankUpdate):
    """更新题库"""
    db_question_bank = db.query(QuestionBank).filter(QuestionBank.id == question_bank_id).first()
    if not db_question_bank:
        return None

    data = update_data.dict(exclude_unset=True)
    for key, value in data.items():
        setattr(db_question_bank, key, value)

    db.commit()
    db.refresh(db_question_bank)
    return db_question_bank

def delete_question_bank(db: Session, question_bank_id: UUID):
    db_question_bank = db.query(QuestionBank).filter(QuestionBank.id == question_bank_id).first()
    if not db_question_bank:
        return None

    linked_tests = db.query(CodingTest).filter(CodingTest.question_bank_id == question_bank_id).count()
    if linked_tests > 0:
        raise HTTPException(
            status_code=400,
            detail=f"无法删除：该题库已关联 {linked_tests} 个笔试题，请先解除关联"
        )

    db.delete(db_question_bank)
    db.commit()
    return db_question_bank
