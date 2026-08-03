from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.config.database import get_db
from app.schemas.resume import (
    ResumeResponse, ResumeCreate, ResumeUpdate,
    DepartmentReviewCreate, DepartmentReviewUpdate, DepartmentReviewResponse,
    HRDecisionCreate, HRDecisionResponse,
    DuplicateCheckRequest, DuplicateCheckResponse, DepartmentReviewSummary
)
from app.services.resume_service import (
    upload_resume, get_resumes, get_resume, update_resume, delete_resume,
    batch_upload_resumes, reparse_resume,
    check_duplicate_resume, create_department_review, get_department_reviews,
    complete_department_review, aggregate_department_reviews, submit_hr_decision,
    confirm_rejection, override_rejection, get_resume_with_reviews, transfer_resume_position
)
from app.models.models import ResumeStatus, RejectReasonCategory, User, UserRole, Resume
from app.core.security import check_roles, get_current_user_dep, SECRET_KEY, ALGORITHM
from app.routes.auth import get_current_user
from typing import List, Dict, Any, Optional
from uuid import UUID
import os
from jose import jwt, JWTError

router = APIRouter(
    prefix="/resumes",
    tags=["resumes"]
)

# ==================== 简历列表 ====================

@router.get("", response_model=List[ResumeResponse])
def get_resumes_route(
    skip: int = 0,
    limit: int = 100,
    candidate_name: str = None,
    status: str = None,
    position_id: Optional[UUID] = None,
    reviewer_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_resumes(db, skip=skip, limit=limit, candidate_name=candidate_name, status=status, position_id=position_id, reviewer_id=reviewer_id)

# ==================== 简历查重 ====================

@router.post("/check-duplicate", response_model=DuplicateCheckResponse)
def check_duplicate_route(
    request: DuplicateCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    检查简历是否重复（基于邮箱/手机号）
    """
    existing = check_duplicate_resume(db, request.email, request.contact, request.position_id)

    if existing:
        return DuplicateCheckResponse(
            is_duplicate=True,
            existing_resume=ResumeResponse.model_validate(existing),
            message=f"发现重复简历：{existing.candidate_name or '未知候选人'}"
        )

    return DuplicateCheckResponse(
        is_duplicate=False,
        existing_resume=None,
        message="未发现重复简历"
    )

# ==================== 简历上传 ====================

def validate_pdf_file(file: UploadFile):
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="只允许上传 PDF 格式的文件")
    if file.content_type and file.content_type != 'application/pdf':
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="只允许上传 PDF 格式的文件")
    return file

# 注意：单简历上传保持公开，因为应聘者可能通过公开链接投递
@router.post("", response_model=ResumeResponse)
def create_resume_route(
    background_tasks: BackgroundTasks,
    position_id: Optional[UUID] = Form(None),
    file: UploadFile = File(...),
    candidate_name: str = Form(None),  # 公开链接上传时由应聘者填写
    email: str = Form(None),
    contact: str = Form(None),
    db: Session = Depends(get_db)
):
    validate_pdf_file(file)
    return upload_resume(db, file, position_id, background_tasks, candidate_name, email, contact)

@router.post("/batch", response_model=List[ResumeResponse])
def batch_upload_resumes_route(
    background_tasks: BackgroundTasks,
    position_id: Optional[UUID] = Form(None),
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    for f in files:
        validate_pdf_file(f)
    return batch_upload_resumes(db, files, position_id, background_tasks)

# ==================== 简历详情与更新 ====================

@router.get("/{resume_id}", response_model=ResumeResponse)
def get_resume_route(
    resume_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    resume = get_resume_with_reviews(db, resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    return resume

@router.put("/{resume_id}", response_model=ResumeResponse)
def update_resume_route(
    resume_id: UUID,
    resume: ResumeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    db_resume = update_resume(db, resume_id, resume)
    if not db_resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    return db_resume

@router.delete("/{resume_id}", response_model=ResumeResponse)
def delete_resume_route(
    resume_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    db_resume = delete_resume(db, resume_id)
    if not db_resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    return db_resume

@router.post("/{resume_id}/reparse", response_model=ResumeResponse)
def reparse_resume_route(
    resume_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    resume = reparse_resume(db, resume_id, background_tasks)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    return resume

@router.post("/batch-reparse")
def batch_reparse_resumes_route(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    """批量重新解析所有状态为 failed 或 success 的简历"""
    from app.models.models import Resume
    resumes = db.query(Resume).filter(
        Resume.parse_status.in_(["failed", "success"]),
        Resume.position_id.isnot(None)
    ).all()
    count = len(resumes)
    for r in resumes:
        r.parse_status = "processing"
        r.parse_error = None
        r.parsed_at = None
        db.commit()
        from app.services.resume_service import process_resume_background
        process_resume_background(r.id, r.position_id)
    return {"success": True, "count": count, "message": f"已提交 {count} 个简历重新解析"}

@router.get("/{resume_id}/file")
def get_resume_file(
    resume_id: UUID,
    request: Request,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """返回简历原始 PDF 文件，用于前端 iframe 内联预览。
    
    认证优先级：
    1. ?token= 查询参数（iframe src 场景）
    2. Authorization: Bearer <token> header（常规 fetch 场景）
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )

    # 确定 token：优先 query param，其次 header
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

    if not token:
        raise credentials_exception

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if not email:
            raise credentials_exception
        user = db.query(User).filter(User.email == email).first()
        if not user or not user.is_active:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    if not resume.file_path or not os.path.exists(resume.file_path):
        raise HTTPException(status_code=404, detail="File not found")

    # download=true → 强制下载；否则浏览器内联预览
    download = request.query_params.get("download", "").lower() == "true"
    filename = (resume.candidate_name or "resume") + ".pdf"
    # URL-encode 中文文件名
    from urllib.parse import quote
    disposition = f'attachment; filename*=UTF-8\'\'{quote(filename)}' if download else 'inline'

    return FileResponse(
        path=resume.file_path,
        media_type="application/pdf",
        headers={
            "Content-Disposition": disposition
        }
    )

# ==================== 部门评审 ====================

@router.get("/{resume_id}/department-reviews", response_model=DepartmentReviewSummary)
def get_department_reviews_route(
    resume_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取部门评审汇总报告
    """
    return aggregate_department_reviews(db, resume_id)


@router.post("/{resume_id}/department-reviews", response_model=DepartmentReviewResponse)
def create_department_review_route(
    resume_id: UUID,
    reviewer_id: UUID = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    """
    指派部门评审人
    """
    return create_department_review(db, resume_id, reviewer_id)


@router.put("/{resume_id}/department-reviews/{review_id}", response_model=DepartmentReviewResponse)
def complete_department_review_route(
    resume_id: UUID,
    review_id: UUID,
    reviewer_id: UUID = Form(...),
    technical_score: int = Form(None),
    experience_score: int = Form(None),
    overall_score: int = Form(None),
    recommendation: str = Form(None),
    comment: str = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    完成部门评审
    """
    review_data = DepartmentReviewUpdate(
        technical_score=technical_score,
        experience_score=experience_score,
        overall_score=overall_score,
        recommendation=recommendation,
        comment=comment
    )
    return complete_department_review(db, review_id, reviewer_id, review_data)

# ==================== HR决策 ====================

@router.post("/{resume_id}/hr-decision", response_model=ResumeResponse)
def submit_hr_decision_route(
    resume_id: UUID,
    decision_data: HRDecisionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    """
    HR提交最终决策
    """
    return submit_hr_decision(db, resume_id, decision_data.hr_id, decision_data)


@router.post("/{resume_id}/confirm-rejection", response_model=ResumeResponse)
def confirm_rejection_route(
    resume_id: UUID,
    reason_category: str = Form(...),
    reason_detail: str = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    """
    确认淘汰低分简历
    """
    try:
        reason_category_enum = RejectReasonCategory(reason_category)
    except ValueError:
        valid_values = [e.value for e in RejectReasonCategory]
        raise HTTPException(status_code=400, detail=f"无效的淘汰原因，有效值为: {valid_values}")
    
    hr_id = current_user.id
    return confirm_rejection(db, resume_id, hr_id, reason_category_enum, reason_detail)


@router.post("/{resume_id}/override-rejection", response_model=ResumeResponse)
def override_rejection_route(
    resume_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    """
    覆盖AI淘汰建议，恢复到评审流程
    """
    hr_id = current_user.id
    return override_rejection(db, resume_id, hr_id)


@router.post("/{resume_id}/transfer", response_model=ResumeResponse)
def transfer_resume_position_route(
    resume_id: UUID,
    background_tasks: BackgroundTasks,
    new_position_id: UUID = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    """
    将简历转岗到其他岗位，并重新解析
    """
    return transfer_resume_position(db, resume_id, new_position_id, background_tasks)


@router.get("/queue/status")
def get_queue_status(
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    from app.services.task_queue import get_task_queue
    queue = get_task_queue()
    return queue.get_stats()


@router.get("/queue/task/{task_id}")
def get_task_status(
    task_id: str,
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    from app.services.task_queue import get_task_queue
    queue = get_task_queue()
    status = queue.get_status(task_id)
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    return status


@router.post("/fix-stuck")
def fix_stuck_resumes(
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    from datetime import datetime, timedelta
    from app.services.task_queue import get_task_queue

    queue = get_task_queue()
    queue_stats = queue.get_stats()

    stuck_resumes = db.query(Resume).filter(
        Resume.parse_status == "processing",
        Resume.updated_at < datetime.utcnow() - timedelta(minutes=10)
    ).all()

    fixed_count = 0
    for resume in stuck_resumes:
        task_status = queue.get_status(str(resume.id))

        if task_status is None or task_status["status"] in ["completed", "failed"]:
            resume.parse_status = "failed"
            resume.parse_error = "解析超时，请重新解析"
            resume.candidate_name = "解析失败"
            fixed_count += 1

    db.commit()

    return {
        "fixed_count": fixed_count,
        "queue_stats": queue_stats
    }