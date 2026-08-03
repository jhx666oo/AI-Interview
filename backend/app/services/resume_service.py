from sqlalchemy.orm import Session, joinedload
from app.models.models import (
    Resume, Position, Interview, InterviewPanel, DepartmentReview, User, Offer,
    ResumeStatus, ScreeningResult, RejectReasonCategory, ReviewRecommendation, PositionStatus
)
from app.schemas.resume import (
    ResumeCreate, ResumeUpdate, ScreeningResult as ScreeningResultSchema,
    ResumeStatus as ResumeStatusSchema, DepartmentReviewCreate,
    DepartmentReviewUpdate, HRDecisionCreate, DuplicateCheckRequest
)
from uuid import UUID
from fastapi import UploadFile, HTTPException
from app.utils.file_storage import save_upload_file
from app.services.ai_service import analyze_resume, generate_resume_markdown
from app.services.task_queue import get_task_queue
import docx
import PyPDF2
import os
from typing import List, Optional, Dict, Any
from datetime import datetime
from sqlalchemy import or_, and_, func
import json

import subprocess
import tempfile
import shutil

def _find_mineru():
    """在 PATH 中查找 mineru-open-api 可执行文件路径"""
    return shutil.which("mineru-open-api") or "mineru-open-api"

def read_file_content(file_path: str) -> str:
    """
    读取文件内容，PDF 优先使用 MinerU (flash-extract) 以获得更高质量解析。
    返回 (raw_text, markdown_text)，markdown_text 是 MinerU 输出的结构化 Markdown。
    """
    _, ext = os.path.splitext(file_path)
    ext = ext.lower()
    raw = ""
    md = ""

    try:
        if ext == '.docx':
            doc = docx.Document(file_path)
            raw = '\n'.join([para.text for para in doc.paragraphs])
        elif ext == '.pdf':
            # 尝试用 MinerU flash-extract 解析
            try:
                mineru = _find_mineru()
                result = subprocess.run(
                    [mineru, "flash-extract", file_path, "--language", "ch"],
                    capture_output=True, text=True, timeout=120
                )
                if result.returncode == 0 and result.stdout.strip():
                    md = result.stdout.strip()
                    # 从 Markdown 中提取纯文本作为 raw_text（去掉格式标记）
                    raw = md
                else:
                    print(f"MinerU flash-extract returned non-zero: {result.stderr}")
                    raise RuntimeError("MinerU failed")
            except Exception as mineru_err:
                print(f"MinerU parse failed for {file_path}: {mineru_err}, falling back to PyPDF2")
                with open(file_path, 'rb') as f:
                    reader = PyPDF2.PdfReader(f)
                    for page in reader.pages:
                        raw += page.extract_text()
        elif ext in ('.txt', '.md', '.markdown'):
            with open(file_path, 'r', encoding='utf-8') as f:
                raw = f.read()
        else:
            print(f"Unsupported file type: {ext}")
    except Exception as e:
        print(f"Error reading file {file_path}: {e}")

    return raw, md

from app.config.database import SessionLocal
from fastapi import BackgroundTasks

def process_resume_task(payload: Dict[str, Any]):
    resume_id = payload["resume_id"]
    position_id = payload["position_id"]
    use_user_info = payload.get("use_user_info", False)

    db = SessionLocal()
    try:
        resume = db.query(Resume).filter(Resume.id == resume_id).first()
        if not resume:
            return
        resume.parse_status = "processing"
        resume.parse_error = None
        db.commit()

        raw_text, resume_md = read_file_content(resume.file_path)
        if not raw_text:
            resume.parse_status = "failed"
            resume.parse_error = "读取简历内容失败"
            db.commit()
            return

        resume.raw_text = raw_text
        if resume_md:
            resume.resume_markdown = resume_md

        # 用 Markdown（如有）作为 AI 分析输入，质量更高
        content = resume_md or raw_text

        position = None
        if position_id:
            position = db.query(Position).filter(Position.id == position_id).first()

        position_desc = ""
        other_positions_info = "暂无其他相近岗位"
        if position:
            position_desc = f"{position.title}\n{position.description}\n{position.requirements}"
            # 获取其他相近岗位（状态为 OPEN 或 PUBLISHED，排除当前岗位）
            other_positions = db.query(Position).filter(
                Position.id != position_id,
                Position.status.in_([PositionStatus.OPEN, PositionStatus.PUBLISHED])
            ).limit(5).all()
            if other_positions:
                positions_list = []
                for pos in other_positions:
                    pos_info = {
                        "position_id": str(pos.id),
                        "position_title": pos.title,
                        "description": pos.description[:500] if pos.description else "",
                        "requirements": pos.requirements[:300] if pos.requirements else "",
                        "department": pos.department or "",
                    }
                    positions_list.append(pos_info)
                other_positions_info = json.dumps(positions_list, ensure_ascii=False)

        parsed_data = analyze_resume(content, position_desc, other_positions_info)

        # 解析 AI 返回结果，兼容多种格式
        if not parsed_data:
            resume.parse_status = "failed"
            resume.parse_error = "AI 解析失败"
            db.commit()
            return

        # 提取 match_score（可能在顶层或在 main_job_evaluation/main_position_match 中）
        match_score = parsed_data.get("match_score")
        if match_score is None:
            main_eval = parsed_data.get("main_job_evaluation") or parsed_data.get("main_position_match") or {}
            match_score = main_eval.get("match_score", 0)
        if match_score is None:
            match_score = 0

        # 提取 screening_result
        screening_result = parsed_data.get("screening_result", ScreeningResult.PENDING)

        # 提取 ai_review
        ai_review = parsed_data.get("ai_review", "")
        if not ai_review:
            main_eval = parsed_data.get("main_job_evaluation") or parsed_data.get("main_position_match") or {}
            analysis = main_eval.get("analysis", {})
            if isinstance(analysis, dict):
                advantages = analysis.get("advantages", [])
                disadvantages = analysis.get("disadvantages", [])
                summary = analysis.get("summary", "")
                ai_review_parts = []
                if advantages:
                    ai_review_parts.append("### ✅ 优势\n- " + "\n- ".join(advantages))
                if disadvantages:
                    ai_review_parts.append("### ⚠️ 不足\n- " + "\n- ".join(disadvantages))
                if summary:
                    ai_review_parts.append("### 💡 综合建议\n" + summary)
                ai_review = "\n\n".join(ai_review_parts)
            elif isinstance(analysis, str):
                # analysis 是字符串的情况
                ai_review = f"### 💡 分析\n{analysis}"
            if not ai_review and parsed_data.get("recommendation"):
                ai_review = "### 💡 综合建议\n" + parsed_data.get("recommendation", "")

        # 提取联系方式
        contact_info = parsed_data.get("contact_info", {})
        if isinstance(contact_info, dict):
            contact = contact_info.get("phone", "")
            email = contact_info.get("email", "")
        else:
            contact = parsed_data.get("contact", "")
            email = parsed_data.get("email", "")

        # 提取姓名
        candidate_name = parsed_data.get("candidate_name", "")

        # 提取其他岗位匹配信息
        other_matches = parsed_data.get("other_position_matches", [])

        # 更新简历信息
        resume.parsed_data = parsed_data
        resume.match_score = match_score if isinstance(match_score, int) else 0
        resume.screening_result = screening_result if isinstance(screening_result, str) else ScreeningResult.PENDING
        resume.ai_review = ai_review

        # 存储其他岗位匹配信息
        if other_matches:
            resume.other_position_matches = other_matches

        if not use_user_info:
            resume.candidate_name = candidate_name or "未识别"
            resume.contact = contact
            resume.email = email or None

        resume.parse_status = "success"
        resume.parse_error = None
        resume.parsed_at = datetime.utcnow()

        # 根据主岗位匹配分数和其他岗位匹配情况决定状态
        has_better_match = False
        if other_matches:
            for match in other_matches:
                if match.get("is_better_match") or match.get("match_score", 0) >= 70:
                    has_better_match = True
                    break

        if resume.match_score >= 60:
            resume.status = ResumeStatus.PENDING_REVIEW
        elif has_better_match:
            # 有更适合的其他岗位，设为备选状态
            resume.status = ResumeStatus.WAITLIST
        else:
            resume.status = ResumeStatus.AUTO_REJECTED_PENDING_REVIEW

        db.commit()

    except Exception as e:
        try:
            resume = db.query(Resume).filter(Resume.id == resume_id).first()
            if resume:
                resume.parse_status = "failed"
                resume.parse_error = str(e)[:500]
                db.commit()
        finally:
            pass
    finally:
        db.close()


def on_resume_parse_failure(payload: Dict[str, Any], error: str):
    resume_id = payload["resume_id"]
    db = SessionLocal()
    try:
        resume = db.query(Resume).filter(Resume.id == resume_id).first()
        if resume:
            resume.parse_status = "failed"
            resume.parse_error = f"解析失败（重试后）: {error[:400]}"
            resume.candidate_name = "解析失败"
            db.commit()
            print(f"[TaskQueue] Updated resume {resume_id} status to failed")
    except Exception as e:
        print(f"[TaskQueue] Failed to update resume status: {e}")
    finally:
        db.close()


def process_resume_background(resume_id: UUID, position_id: Optional[UUID], use_user_info: bool = False):
    queue = get_task_queue()
    queue.submit(
        task_id=str(resume_id),
        task_type="resume_parse",
        payload={
            "resume_id": resume_id,
            "position_id": position_id,
            "use_user_info": use_user_info,
        },
        callback=process_resume_task,
        on_failure=on_resume_parse_failure,
    )

def upload_resume(db: Session, file: UploadFile, position_id: Optional[UUID], background_tasks: BackgroundTasks,
                  candidate_name: str = None, email: str = None, contact: str = None):
    """
    上传简历
    - 公开链接上传时，candidate_name/email/contact 由应聘者填写，解析时不会覆盖
    - 后台上传时，这些字段为空，解析时会从简历中提取
    """
    # 1. Save file
    file_path = save_upload_file(file, "resumes")

    # 2. Create initial record
    # 如果有应聘者填写的信息，直接使用；否则显示"解析中..."
    db_resume = Resume(
        file_path=file_path,
        position_id=position_id,
        status=ResumeStatus.PENDING_SCREENING,
        candidate_name=candidate_name or "解析中...",
        email=email or None,
        contact=contact or None,
        parse_status="processing",
    )

    db.add(db_resume)
    db.commit()
    db.refresh(db_resume)

    # 3. Add background task - 传递是否使用用户填写的信息标记
    use_user_info = bool(candidate_name or email or contact)
    background_tasks.add_task(process_resume_background, db_resume.id, position_id, use_user_info)

    return db_resume

def batch_upload_resumes(db: Session, files: List[UploadFile], position_id: Optional[UUID], background_tasks: BackgroundTasks):
    uploaded_resumes = []
    for file in files:
        resume = upload_resume(db, file, position_id, background_tasks)
        uploaded_resumes.append(resume)
    return uploaded_resumes

def reparse_resume(db: Session, resume_id: UUID, background_tasks: BackgroundTasks):
    resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if not resume:
        return None
    if not resume.position_id:
        raise HTTPException(status_code=400, detail="Resume missing position_id")

    resume.parse_status = "processing"
    resume.parse_error = None
    resume.parsed_at = None
    resume.parsed_data = None
    resume.match_score = None
    resume.ai_review = None
    resume.screening_result = ScreeningResult.PENDING
    resume.status = ResumeStatus.PENDING_SCREENING
    resume.candidate_name = "解析中..."
    resume.contact = None
    resume.email = None
    db.commit()
    db.refresh(resume)

    background_tasks.add_task(process_resume_background, resume.id, resume.position_id)
    return resume

def get_resumes(db: Session, skip: int = 0, limit: int = 100, candidate_name: str = None, status: str = None, position_id: UUID = None, reviewer_id: UUID = None):
    query = db.query(Resume).options(joinedload(Resume.position))

    if candidate_name:
        query = query.filter(Resume.candidate_name.ilike(f"%{candidate_name}%"))

    if status:
        query = query.filter(Resume.status == status)

    if position_id:
        query = query.filter(Resume.position_id == position_id)

    if reviewer_id:
        query = query.join(DepartmentReview, Resume.id == DepartmentReview.resume_id)
        query = query.filter(DepartmentReview.reviewer_id == reviewer_id)
        query = query.filter(DepartmentReview.is_completed == False)

    query = query.order_by(Resume.created_at.desc())

    return query.offset(skip).limit(limit).all()

def get_resume(db: Session, resume_id: UUID):
    return db.query(Resume).options(joinedload(Resume.position)).filter(Resume.id == resume_id).first()

def update_resume(db: Session, resume_id: UUID, resume: ResumeUpdate):
    db_resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if not db_resume:
        return None
    
    update_data = resume.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_resume, key, value)
    
    db.commit()
    db.refresh(db_resume)
    return db_resume

def delete_resume(db: Session, resume_id: UUID):
    db_resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if not db_resume:
        return None

    # Get interview IDs for this resume
    interview_ids = [i.id for i in db.query(Interview).filter(Interview.resume_id == resume_id).all()]

    # Delete associated interview panels first (due to foreign key constraint)
    if interview_ids:
        db.query(InterviewPanel).filter(InterviewPanel.interview_id.in_(interview_ids)).delete(synchronize_session=False)

    # Delete associated interviews
    db.query(Interview).filter(Interview.resume_id == resume_id).delete(synchronize_session=False)

    # Delete associated department reviews
    db.query(DepartmentReview).filter(DepartmentReview.resume_id == resume_id).delete(synchronize_session=False)

    # Delete associated offers
    db.query(Offer).filter(Offer.resume_id == resume_id).delete(synchronize_session=False)

    # Solution: Eager load position before deletion, so it's in memory.
    # Re-query with options
    db_resume = db.query(Resume).options(joinedload(Resume.position)).filter(Resume.id == resume_id).first()

    db.delete(db_resume)
    db.commit()
    return db_resume


# ==================== 简历查重 ====================

def check_duplicate_resume(db: Session, email: Optional[str], contact: Optional[str], position_id: UUID) -> Optional[Resume]:
    """
    检查同一岗位下是否存在相同邮箱或手机号的简历
    返回已存在的简历或 None
    """
    conditions = []

    if email:
        conditions.append(Resume.email == email.strip().lower())

    if contact:
        conditions.append(Resume.contact == contact.strip())

    if not conditions:
        return None

    # 查找同一岗位下邮箱或手机号匹配的简历
    existing = db.query(Resume).filter(
        Resume.position_id == position_id,
        or_(*conditions)
    ).first()

    return existing


# ==================== 部门评审 ====================

def create_department_review(db: Session, resume_id: UUID, reviewer_id: UUID) -> DepartmentReview:
    """
    创建部门评审记录（指派评审人）
    """
    # 检查简历是否存在
    resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="简历不存在")

    # 检查是否已经指派过该评审人
    existing = db.query(DepartmentReview).filter(
        DepartmentReview.resume_id == resume_id,
        DepartmentReview.reviewer_id == reviewer_id
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="该评审人已被指派")

    # 创建评审记录
    review = DepartmentReview(
        resume_id=resume_id,
        reviewer_id=reviewer_id,
        is_completed=False
        # 不设置 recommendation 默认值，让它为 None
    )
    db.add(review)
    db.commit()
    db.refresh(review)

    # 更新简历状态为待部门评审
    if resume.status == ResumeStatus.PENDING_REVIEW:
        # 首次指派评审人时，更新状态
        resume.status = ResumeStatus.PENDING_DEPT_REVIEW
        db.commit()

    return review


def get_department_reviews(db: Session, resume_id: UUID) -> List[DepartmentReview]:
    """
    获取简历的所有部门评审记录
    """
    reviews = db.query(DepartmentReview).options(
        joinedload(DepartmentReview.reviewer)
    ).filter(DepartmentReview.resume_id == resume_id).all()
    return reviews


def complete_department_review(db: Session, review_id: UUID, reviewer_id: UUID, review_data: DepartmentReviewUpdate) -> DepartmentReview:
    """
    完成部门评审
    """
    review = db.query(DepartmentReview).filter(
        DepartmentReview.id == review_id,
        DepartmentReview.reviewer_id == reviewer_id
    ).first()

    if not review:
        raise HTTPException(status_code=404, detail="评审记录不存在")

    if review.is_completed:
        raise HTTPException(status_code=400, detail="该评审已完成，不可修改")

    # 更新评审数据
    update_data = review_data.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(review, key, value)

    review.is_completed = True
    review.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(review)

    # 检查是否所有评审人都已完成
    _check_and_update_resume_status(db, review.resume_id)

    return review


def _check_and_update_resume_status(db: Session, resume_id: UUID):
    """
    检查所有评审人是否已完成，如果是则更新简历状态并发送HR通知邮件
    """
    reviews = db.query(DepartmentReview).filter(
        DepartmentReview.resume_id == resume_id
    ).all()

    if not reviews:
        return

    all_completed = all(r.is_completed for r in reviews)

    if all_completed:
        resume = db.query(Resume).filter(Resume.id == resume_id).first()
        if resume:
            resume.status = ResumeStatus.PENDING_HR_DECISION
            db.commit()
            
            _send_hr_review_notification(db, resume, reviews)


def _send_hr_review_notification(db: Session, resume: Resume, reviews: List[DepartmentReview]):
    """
    发送HR审核通知邮件
    """
    try:
        from app.services.mail_service import MailService
        from app.models.models import SystemConfig
        
        hr_users = db.query(User).filter(
            User.role == UserRole.HR,
            User.is_active == True
        ).all()
        
        if not hr_users:
            return
        
        mail_service = MailService(db)
        if not mail_service.config.is_valid():
            return
        
        system_config = db.query(SystemConfig).first()
        frontend_url = system_config.frontend_url if system_config else "http://localhost:5173"
        
        recommend_count = sum(1 for r in reviews if r.recommendation == ReviewRecommendation.RECOMMEND)
        not_recommend_count = sum(1 for r in reviews if r.recommendation == ReviewRecommendation.NOT_RECOMMEND)
        
        overall_scores = [r.overall_score for r in reviews if r.overall_score is not None]
        avg_score = sum(overall_scores) / len(overall_scores) if overall_scores else 0
        
        position = resume.position
        
        for hr in hr_users:
            if not hr.email:
                continue
                
            review_url = f"{frontend_url}/resumes/{resume.id}"
            
            subject = f"【HR审核通知】部门评审完成 - {resume.candidate_name}"
            
            html_content = f"""
            <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #1890ff;">HR 审核通知</h2>
                    <p>尊敬的 {hr.full_name or 'HR'}，</p>
                    <p>候选人 <strong>{resume.candidate_name}</strong> 的部门评审已完成，请进行最终审核：</p>
                    
                    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p><strong>应聘岗位：</strong>{position.title if position else '未知'}</p>
                        <p><strong>匹配度评分：</strong>{resume.match_score}分</p>
                        <p><strong>部门评审结果：</strong></p>
                        <ul>
                            <li>推荐：{recommend_count}人</li>
                            <li>不推荐：{not_recommend_count}人</li>
                            <li>平均综合评分：{avg_score:.1f}分</li>
                        </ul>
                    </div>
                    
                    <p>请点击下方链接查看详情并进行最终决策：</p>
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="{review_url}" style="background-color: #52c41a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">立即审核</a>
                    </p>
                    
                    <p style="color: #999; font-size: 12px;">此邮件由系统自动发送，请勿直接回复。</p>
                </div>
            </body>
            </html>
            """
            
            mail_service._send_email(hr.email, subject, html_content)
            
    except Exception as e:
        import logging
        logging.error(f"Failed to send HR review notification: {e}")


def aggregate_department_reviews(db: Session, resume_id: UUID) -> Dict[str, Any]:
    """
    聚合多人评审结果
    """
    reviews = get_department_reviews(db, resume_id)

    if not reviews:
        return {
            "resume_id": resume_id,
            "total_reviewers": 0,
            "completed_reviewers": 0,
            "avg_technical_score": None,
            "avg_experience_score": None,
            "avg_overall_score": None,
            "recommend_count": 0,
            "not_recommend_count": 0,
            "pending_count": 0,
            "recommend_ratio": 0.0,
            "comments": [],
            "reviews": []
        }

    completed_reviews = [r for r in reviews if r.is_completed]

    # 计算平均分
    technical_scores = [r.technical_score for r in completed_reviews if r.technical_score is not None]
    experience_scores = [r.experience_score for r in completed_reviews if r.experience_score is not None]
    overall_scores = [r.overall_score for r in completed_reviews if r.overall_score is not None]

    # 统计推荐情况
    recommend_count = sum(1 for r in completed_reviews if r.recommendation == ReviewRecommendation.RECOMMEND)
    not_recommend_count = sum(1 for r in completed_reviews if r.recommendation == ReviewRecommendation.NOT_RECOMMEND)
    pending_count = sum(1 for r in completed_reviews if r.recommendation == ReviewRecommendation.PENDING)

    # 汇总评语
    comments = [r.comment for r in completed_reviews if r.comment]

    total_completed = len(completed_reviews)
    recommend_ratio = recommend_count / total_completed if total_completed > 0 else 0.0

    # 构建响应
    review_responses = []
    for r in reviews:
        reviewer_name = r.reviewer.full_name if r.reviewer else None
        review_responses.append({
            "id": r.id,
            "resume_id": r.resume_id,
            "reviewer_id": r.reviewer_id,
            "technical_score": r.technical_score,
            "experience_score": r.experience_score,
            "overall_score": r.overall_score,
            "recommendation": r.recommendation,
            "comment": r.comment,
            "is_completed": r.is_completed,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
            "reviewer_name": reviewer_name
        })

    return {
        "resume_id": resume_id,
        "total_reviewers": len(reviews),
        "completed_reviewers": len(completed_reviews),
        "avg_technical_score": sum(technical_scores) / len(technical_scores) if technical_scores else None,
        "avg_experience_score": sum(experience_scores) / len(experience_scores) if experience_scores else None,
        "avg_overall_score": sum(overall_scores) / len(overall_scores) if overall_scores else None,
        "recommend_count": recommend_count,
        "not_recommend_count": not_recommend_count,
        "pending_count": pending_count,
        "recommend_ratio": recommend_ratio,
        "comments": comments,
        "reviews": review_responses
    }


# ==================== HR决策 ====================

def submit_hr_decision(db: Session, resume_id: UUID, hr_id: UUID, decision_data: HRDecisionCreate) -> Resume:
    """
    HR提交最终决策
    """
    resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="简历不存在")

    # 验证状态流转
    valid_states = [
        ResumeStatus.PENDING_HR_DECISION,
        ResumeStatus.PENDING_DEPT_REVIEW,
        ResumeStatus.PENDING_REVIEW,
        ResumeStatus.AUTO_REJECTED_PENDING_REVIEW
    ]

    if resume.status not in valid_states:
        raise HTTPException(status_code=400, detail=f"当前状态 [{resume.status.value}] 不允许HR决策")

    decision = decision_data.decision

    # 更新简历状态
    resume.status = decision
    resume.hr_review = decision_data.hr_comment

    # 如果是淘汰，记录淘汰原因
    if decision == ResumeStatus.REJECTED:
        if not decision_data.reject_reason_category:
            raise HTTPException(status_code=400, detail="淘汰时必须选择淘汰原因")
        resume.reject_reason_category = decision_data.reject_reason_category
        resume.reject_reason_detail = decision_data.reject_reason_detail
        resume.rejected_at = datetime.utcnow()
        resume.rejected_by = hr_id

    # 如果是备选
    elif decision == ResumeStatus.WAITLIST:
        resume.reject_reason_category = None
        resume.reject_reason_detail = None

    db.commit()
    db.refresh(resume)

    return resume


def confirm_rejection(db: Session, resume_id: UUID, hr_id: UUID,
                      reason_category: RejectReasonCategory, reason_detail: Optional[str] = None) -> Resume:
    """
    确认淘汰低分简历（从 AUTO_REJECTED_PENDING_REVIEW 状态）
    """
    resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="简历不存在")

    if resume.status != ResumeStatus.AUTO_REJECTED_PENDING_REVIEW:
        raise HTTPException(status_code=400, detail="当前状态不允许此操作")

    resume.status = ResumeStatus.REJECTED
    resume.reject_reason_category = reason_category
    resume.reject_reason_detail = reason_detail
    resume.rejected_at = datetime.utcnow()
    resume.rejected_by = hr_id

    db.commit()
    db.refresh(resume)

    return resume


def override_rejection(db: Session, resume_id: UUID, hr_id: UUID) -> Resume:
    """
    覆盖AI淘汰建议（从 AUTO_REJECTED_PENDING_REVIEW 恢复到评审流程）
    """
    resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="简历不存在")

    if resume.status != ResumeStatus.AUTO_REJECTED_PENDING_REVIEW:
        raise HTTPException(status_code=400, detail="当前状态不允许此操作")

    # 恢复到部门评审流程
    resume.status = ResumeStatus.PENDING_DEPT_REVIEW
    resume.reject_reason_category = None
    resume.reject_reason_detail = None

    db.commit()
    db.refresh(resume)

    return resume


def get_resume_with_reviews(db: Session, resume_id: UUID) -> Optional[Resume]:
    """
    获取简历详情（包含部门评审记录）
    """
    resume = db.query(Resume).options(
        joinedload(Resume.position),
        joinedload(Resume.department_reviews).joinedload(DepartmentReview.reviewer)
    ).filter(Resume.id == resume_id).first()

    return resume


def transfer_resume_position(db: Session, resume_id: UUID, new_position_id: UUID, background_tasks) -> Resume:
    """
    将简历转岗到其他岗位，并重新解析
    """
    resume = db.query(Resume).filter(Resume.id == resume_id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="简历不存在")

    # 检查新岗位是否存在
    new_position = db.query(Position).filter(Position.id == new_position_id).first()
    if not new_position:
        raise HTTPException(status_code=404, detail="目标岗位不存在")

    # 更新岗位
    old_position_id = resume.position_id
    resume.position_id = new_position_id

    # 清除之前的解析结果
    resume.parse_status = "processing"
    resume.parse_error = None
    resume.parsed_at = None
    resume.parsed_data = None
    resume.match_score = None
    resume.ai_review = None
    resume.screening_result = ScreeningResult.PENDING
    resume.other_position_matches = None
    resume.status = ResumeStatus.PENDING_SCREENING

    # 清除部门评审记录
    db.query(DepartmentReview).filter(DepartmentReview.resume_id == resume_id).delete()

    # 清除HR评审
    resume.hr_review = None
    resume.reject_reason_category = None
    resume.reject_reason_detail = None
    resume.rejected_at = None
    resume.rejected_by = None

    db.commit()
    db.refresh(resume)

    # 触发重新解析
    background_tasks.add_task(process_resume_background, resume.id, resume.position_id, False)

    return resume
