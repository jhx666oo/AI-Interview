from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Response, File, UploadFile, Form
from sqlalchemy.orm import Session
from app.config.database import get_db
from app.schemas.interview import InterviewResponse, InterviewCreate, InterviewUpdate, InterviewScore
from app.services.interview_service import (
    create_interview, get_interviews, get_interview, update_interview, delete_interview,
    submit_interview_score, update_interview_questions, export_interview_result, confirm_interview_result,
    submit_interview_panel_score, aggregate_panel_scores, start_interview, cancel_interview, get_submission_status
)
from app.schemas.interview import InterviewResponse, InterviewCreate, InterviewUpdate, InterviewScore, InterviewPanelResponse
from app.models.models import User, UserRole, Resume, Position, InterviewStatus, InterviewResult, InterviewPanel
from app.routes.auth import get_current_user
from app.core.security import check_roles

from typing import List, Optional
from uuid import UUID
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

router = APIRouter(
    prefix="/interviews",
    tags=["interviews"]
)

class ConfirmResult(BaseModel):
    result: str

class CancelRequest(BaseModel):
    reason: str = None

class EmailSendRequest(BaseModel):
    subject: str
    content: str

class EmailPreviewRequest(BaseModel):
    resume_id: UUID
    position_id: UUID
    interview_time: str = None
    round: int = 1
    interview_type: str = 'onsite'
    interview_category: str = 'technical'
    interview_location: str = None
    meeting_link: str = None

@router.post("/{interview_id}/panel-score", response_model=InterviewPanelResponse)
def submit_panel_score_route(
    interview_id: UUID, 
    score_data: InterviewScore, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    panel, all_submitted = submit_interview_panel_score(db, interview_id, current_user.id, score_data)
    
    if not panel:
        raise HTTPException(status_code=404, detail="Interview not found")
    
    from app.models.models import Interview, InterviewPanel
    
    db_interview = db.query(Interview).get(interview_id)
    
    if all_submitted and db_interview:
        print(f"All panel members submitted. Triggering aggregation for interview {interview_id}")
        aggregate_panel_scores(db, interview_id, background_tasks)
        panel.interview_status = "analyzing"
    else:
        if db_interview:
            panel.interview_status = db_interview.status.value
             
    return panel

@router.post("/{interview_id}/aggregate", response_model=InterviewResponse)
def aggregate_scores_route(
    interview_id: UUID, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) # Only allowed users (HR/Admin) should do this ideally
):
    db_interview = aggregate_panel_scores(db, interview_id, background_tasks)
    if not db_interview:
        raise HTTPException(status_code=404, detail="Interview or panels not found")
    return db_interview

@router.post("/{interview_id}/confirm", response_model=InterviewResponse)
def confirm_interview_result_route(
    interview_id: UUID,
    confirm_data: ConfirmResult,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    db_interview = confirm_interview_result(db, interview_id, confirm_data.result, background_tasks)
    if not db_interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    return db_interview

@router.post("/{interview_id}/cancel", response_model=InterviewResponse)
def cancel_interview_route(
    interview_id: UUID,
    reason: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    """
    取消面试。
    """
    try:
        db_interview = cancel_interview(db, interview_id, reason)
        if not db_interview:
            raise HTTPException(status_code=404, detail="Interview not found")
        return db_interview
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{interview_id}/submission-status")
def get_submission_status_route(
    interview_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取面试评分提交状态。
    返回各面试官是否已提交评分。
    """
    status = get_submission_status(db, interview_id)
    if not status:
        raise HTTPException(status_code=404, detail="Interview not found")
    return status

@router.get("/{interview_id}/export")
def export_interview_route(interview_id: UUID, format: str = "markdown", db: Session = Depends(get_db)):
    content = export_interview_result(db, interview_id, format)
    if not content:
        raise HTTPException(status_code=404, detail="Interview not found")
        
    return PlainTextResponse(content=content)

@router.put("/{interview_id}/questions", response_model=InterviewResponse)
def update_questions_route(interview_id: UUID, questions: List[dict], db: Session = Depends(get_db)):
    db_interview = update_interview_questions(db, interview_id, questions)
    if not db_interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    return db_interview

@router.post("", response_model=InterviewResponse)
def create_interview_route(
    interview: InterviewCreate, 
    background_tasks: BackgroundTasks, 
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    return create_interview(db, interview, background_tasks)

@router.get("", response_model=List[InterviewResponse])
def get_interviews_route(
    skip: int = 0, 
    limit: int = 100, 
    status: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Filter for interviewers: only see interviews where they are panel members
    if current_user.role == UserRole.INTERVIEWER:
        # We need to implement a filter in get_interviews or do it here
        # Since panel_members is a JSON list of UUIDs, it's tricky to query directly in all SQL dialects efficiently without specific JSON operators.
        # But we can fetch all and filter in python for now (assuming not huge volume) or use specific query.
        # Better: Update get_interviews service to handle filtering.
        from app.services.interview_service import get_interviews_for_interviewer
        interviews = get_interviews_for_interviewer(db, current_user.id, skip=0, limit=10000)
        if status:
            interviews = [i for i in interviews if str(i.status) == status or getattr(i.status, "value", None) == status]
        return interviews[skip: skip + limit]
        
    return get_interviews(db, skip=skip, limit=limit, status=status)

@router.post("/email-preview")
def preview_email_before_create(
    preview_data: EmailPreviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """在创建面试前预览邮件内容"""
    from app.services.mail_service import get_mail_service
    from datetime import datetime

    # 获取简历和岗位信息
    resume = db.query(Resume).filter(Resume.id == preview_data.resume_id).first()
    position = db.query(Position).filter(Position.id == preview_data.position_id).first()

    if not resume or not position:
        raise HTTPException(status_code=404, detail="简历或岗位不存在")

    mail_service = get_mail_service(db)

    # 面试类型中文映射
    category_map = {
        "hr": "HR面",
        "technical": "技术面",
        "manager": "主管面",
        "ceo": "CEO面",
        "comprehensive": "综合面"
    }
    interview_category_text = category_map.get(preview_data.interview_category, "面试")

    # 面试形式中文映射
    type_map = {
        "onsite": "现场面试",
        "video": "视频面试",
        "phone": "电话面试"
    }
    interview_type_text = type_map.get(preview_data.interview_type, "现场面试")

    # 格式化面试时间
    time_str = "待定"
    if preview_data.interview_time:
        try:
            dt = datetime.fromisoformat(preview_data.interview_time.replace('Z', '+00:00'))
            time_str = dt.strftime('%Y年%m月%d日 %H:%M')
        except:
            time_str = preview_data.interview_time

    # 渲染邮件模板
    context = {
        "candidate_name": resume.candidate_name or "候选人",
        "position_title": position.title,
        "interview_time": time_str,
        "interview_round": preview_data.round,
        "interview_category": interview_category_text,
        "interview_type": interview_type_text,
        "interview_location": preview_data.interview_location,
        "meeting_link": preview_data.meeting_link,
        "contact_person": "HR",
        "contact_phone": "",
        "company_name": "公司"
    }

    html_content = mail_service._render_template("interview_invitation.html", context)
    subject = f"面试邀请 - {position.title} 岗位"

    return {
        "to_email": resume.email,
        "candidate_name": resume.candidate_name,
        "subject": subject,
        "content": html_content
    }

@router.get("/{interview_id}", response_model=InterviewResponse)
def get_interview_route(interview_id: UUID, db: Session = Depends(get_db)):
    interview = get_interview(db, interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    
    print(f"[Get Interview] interview_id: {interview_id}")
    print(f"[Get Interview] panel_members: {interview.panel_members}")
    print(f"[Get Interview] panel_members type: {type(interview.panel_members)}")
    if interview.panel_members:
        for i, member in enumerate(interview.panel_members):
            print(f"[Get Interview] member[{i}]: {member}, type: {type(member)}")
    
    print(f"[Get Interview] panels count: {len(interview.panels) if interview.panels else 0}")
    if interview.panels:
        for p in interview.panels:
            print(f"[Get Interview] panel: interviewer_id={p.interviewer_id}, is_submitted={p.is_submitted}")
    
    return interview

@router.post("/{interview_id}/start", response_model=InterviewResponse)
def start_interview_route(
    interview_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    开始面试，将状态从 SCHEDULED 改为 IN_PROGRESS。
    """
    db_interview = start_interview(db, interview_id)
    if not db_interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    return db_interview

@router.put("/{interview_id}", response_model=InterviewResponse)
def update_interview_route(interview_id: UUID, interview: InterviewUpdate, db: Session = Depends(get_db)):
    db_interview = update_interview(db, interview_id, interview)
    if not db_interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    return db_interview

@router.post("/{interview_id}/score", response_model=InterviewResponse)
def submit_score_route(
    interview_id: UUID, 
    score_data: InterviewScore, 
    background_tasks: BackgroundTasks, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    db_interview = submit_interview_score(db, interview_id, current_user.id, score_data, background_tasks)
    if not db_interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    return db_interview

from fastapi import UploadFile, File
import shutil
import os
from app.services.audio_service import transcribe_audio

# ...

@router.post("/{interview_id}/audio/{question_index}")
def upload_audio_route(
    interview_id: UUID,
    question_index: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload audio recording for a specific question, transcribe it, and save to panel record.
    """
    # 1. Save file
    upload_dir = f"uploads/audio/{interview_id}"
    os.makedirs(upload_dir, exist_ok=True)
    
    file_extension = file.filename.split(".")[-1] if "." in file.filename else "webm"
    file_name = f"{current_user.id}_{question_index}.{file_extension}"
    file_path = os.path.join(upload_dir, file_name)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # 2. Transcribe
    transcript_data = transcribe_audio(file_path)
    transcript = transcript_data.get("text", "") if isinstance(transcript_data, dict) else str(transcript_data)
    
    # 3. Update DB (InterviewPanel)
    # We need to find or create the panel for this user
    from app.models.models import InterviewPanel
    
    panel = db.query(InterviewPanel).filter(
        InterviewPanel.interview_id == interview_id,
        InterviewPanel.interviewer_id == current_user.id
    ).first()
    
    if not panel:
        # Create provisional panel if not exists
        panel = InterviewPanel(
            interview_id=interview_id,
            interviewer_id=current_user.id,
            scores={},
            comments={},
            audio_records={},
            transcripts={}
        )
        db.add(panel)
    
    # Update JSON fields
    # Note: SQLAlchemy JSON mutation requires re-assignment or flag_modified
    audio_records = dict(panel.audio_records) if panel.audio_records else {}
    transcripts = dict(panel.transcripts) if panel.transcripts else {}
    
    audio_records[question_index] = file_path
    transcripts[question_index] = transcript
    
    panel.audio_records = audio_records
    panel.transcripts = transcripts
    
    db.commit()
    db.refresh(panel)
    
    return {"transcript": transcript, "file_path": file_path}

@router.delete("/{interview_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interview_route(
    interview_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_roles([UserRole.ADMIN, UserRole.HR]))
):
    db_interview = delete_interview(db, interview_id)
    if not db_interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{interview_id}/email-preview")
def get_email_preview(
    interview_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取面试邀请邮件预览"""
    from app.services.mail_service import get_mail_service

    interview = get_interview(db, interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    mail_service = get_mail_service(db)

    # 获取候选人信息
    resume = db.query(Resume).filter(Resume.id == interview.resume_id).first()
    position = db.query(Position).filter(Position.id == interview.position_id).first()

    if not resume or not position:
        raise HTTPException(status_code=404, detail="Resume or position not found")

    # 从 comments 中获取面试类型和地点信息
    comments = interview.comments or {}
    interview_type = comments.get("interview_type", "onsite")
    interview_category = comments.get("interview_category", "technical")
    interview_location = comments.get("interview_location")
    meeting_link = comments.get("meeting_link")

    # 面试类型中文映射
    category_map = {
        "hr": "HR面",
        "technical": "技术面",
        "manager": "主管面",
        "ceo": "CEO面",
        "comprehensive": "综合面"
    }
    interview_category_text = category_map.get(interview_category, "面试")

    # 面试形式中文映射
    type_map = {
        "onsite": "现场面试",
        "video": "视频面试",
        "phone": "电话面试"
    }
    interview_type_text = type_map.get(interview_type, "现场面试")

    # 格式化面试时间
    time_str = interview.interview_time.strftime('%Y年%m月%d日 %H:%M') if interview.interview_time else "待定"

    # 渲染邮件模板
    context = {
        "candidate_name": resume.candidate_name or "候选人",
        "position_title": position.title,
        "interview_time": time_str,
        "interview_round": interview.round or 1,
        "interview_category": interview_category_text,
        "interview_type": interview_type_text,
        "interview_location": interview_location,
        "meeting_link": meeting_link,
        "contact_person": "HR",
        "contact_phone": "",
        "company_name": "公司"
    }

    html_content = mail_service._render_template("interview_invitation.html", context)
    subject = f"面试邀请 - {position.title} 岗位"

    return {
        "to_email": resume.email,
        "candidate_name": resume.candidate_name,
        "subject": subject,
        "content": html_content
    }


@router.post("/{interview_id}/send-email")
def send_interview_email(
    interview_id: UUID,
    email_data: EmailSendRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """发送面试邀请邮件"""
    from app.services.mail_service import get_mail_service

    interview = get_interview(db, interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    mail_service = get_mail_service(db)

    # 获取候选人邮箱
    resume = db.query(Resume).filter(Resume.id == interview.resume_id).first()
    if not resume or not resume.email:
        raise HTTPException(status_code=400, detail="候选人邮箱为空")

    # 发送邮件
    success = mail_service._send_email(
        to_email=resume.email,
        subject=email_data.subject,
        html_content=email_data.content
    )

    if success:
        return {"message": "邮件发送成功"}
    else:
        raise HTTPException(status_code=500, detail="邮件发送失败")


class DirectEvaluationRequest(BaseModel):
    evaluation: str
    suggestion: Optional[str] = None
    score: int = 5
    transcript: Optional[str] = None  # 可选的录音转写内容


@router.post("/{interview_id}/full-audio")
def upload_full_interview_audio(
    interview_id: UUID,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """上传整场面试录音并进行AI分析"""
    from app.services.audio_service import transcribe_audio, format_transcript_for_display

    interview = get_interview(db, interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    upload_dir = f"uploads/full_audio/{interview_id}"
    os.makedirs(upload_dir, exist_ok=True)

    file_extension = file.filename.split(".")[-1] if "." in file.filename else "webm"
    file_name = f"full_interview.{file_extension}"
    file_path = os.path.join(upload_dir, file_name)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        transcript_data = transcribe_audio(file_path)
        transcript_text = transcript_data.get("text", "")
        formatted_transcript = format_transcript_for_display(transcript_data)
    except Exception as e:
        transcript_text = f"转写失败: {str(e)}"
        formatted_transcript = transcript_text
        transcript_data = {"text": transcript_text, "segments": []}

    interview.audio_records = {"full_interview": file_path}
    interview.transcripts = {
        "full_interview": transcript_text,
        "full_interview_data": transcript_data
    }
    db.commit()

    if transcript_text and background_tasks:
        background_tasks.add_task(
            generate_evaluation_from_transcript,
            interview_id,
            transcript_text
        )

    return {
        "message": "上传成功",
        "transcript": transcript_text,
        "formatted_transcript": formatted_transcript,
        "segments": transcript_data.get("segments", [])
    }


@router.post("/{interview_id}/direct-evaluation")
def submit_direct_evaluation(
    interview_id: UUID,
    evaluation_data: DirectEvaluationRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """直接提交面试评价（无需面试题），支持结合录音转写内容"""
    interview = get_interview(db, interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    transcripts = interview.transcripts or {}
    full_transcript_data = transcripts.get("full_interview", "")
    # 处理 transcript 可能是对象或字符串的情况
    if isinstance(full_transcript_data, dict):
        full_transcript = full_transcript_data.get("text", "")
    else:
        full_transcript = full_transcript_data or evaluation_data.transcript

    panel_members = interview.panel_members or []
    is_multi_interviewer = len(panel_members) > 1

    if is_multi_interviewer:
        panel = db.query(InterviewPanel).filter(
            InterviewPanel.interview_id == interview_id,
            InterviewPanel.interviewer_id == current_user.id
        ).first()
        
        if panel:
            panel.scores = {"overall": evaluation_data.score}
            panel.comments = {"overall": evaluation_data.evaluation}
            panel.total_score = evaluation_data.score
            panel.is_submitted = True
            db.commit()
            db.refresh(panel)
        
        submitted_panels = db.query(InterviewPanel).filter(
            InterviewPanel.interview_id == interview_id,
            InterviewPanel.is_submitted == True
        ).all()
        
        submitted_ids = [str(p.interviewer_id) for p in submitted_panels]
        required_ids = [str(uid) for uid in panel_members]
        
        print(f"[Direct Eval] Submitted IDs: {submitted_ids}")
        print(f"[Direct Eval] Required IDs: {required_ids}")
        
        all_submitted = all(uid in submitted_ids for uid in required_ids)
        print(f"[Direct Eval] All submitted: {all_submitted}")
        
        if all_submitted:
            interview.status = InterviewStatus.ANALYZING
            interview.result = InterviewResult.PENDING
            
            all_evaluations = []
            for p in submitted_panels:
                interviewer_name = p.interviewer_user.full_name if p.interviewer_user else str(p.interviewer_id)
                all_evaluations.append(f"**{interviewer_name}**: {p.comments.get('overall', '')} (评分: {p.total_score})")
            
            combined_evaluation = "\n\n".join(all_evaluations)
            avg_score = sum(p.total_score or 0 for p in submitted_panels) // len(submitted_panels)
            
            interview.evaluation = combined_evaluation
            interview.suggestion = "综合多位面试官评价"
            interview.total_score = avg_score
            interview.scores = {"overall": avg_score}
            interview.comments = {"overall": combined_evaluation}
            
            db.commit()
            db.refresh(interview)
            
            if full_transcript:
                background_tasks.add_task(
                    generate_combined_evaluation,
                    interview_id,
                    full_transcript,
                    combined_evaluation,
                    "综合多位面试官评价",
                    avg_score
                )
            else:
                interview.status = InterviewStatus.COMPLETED
                db.commit()
                db.refresh(interview)
        else:
            interview.result = InterviewResult.PENDING
            db.commit()
            db.refresh(interview)
    else:
        interview.evaluation = evaluation_data.evaluation
        interview.suggestion = evaluation_data.suggestion
        interview.total_score = evaluation_data.score
        interview.scores = {"overall": evaluation_data.score}
        interview.comments = {"overall": evaluation_data.evaluation}

        if full_transcript:
            interview.status = InterviewStatus.ANALYZING
            interview.result = InterviewResult.PENDING
            background_tasks.add_task(
                generate_combined_evaluation,
                interview_id,
                full_transcript,
                evaluation_data.evaluation,
                evaluation_data.suggestion,
                evaluation_data.score
            )
        else:
            interview.status = InterviewStatus.COMPLETED
            interview.result = InterviewResult.PENDING

        db.commit()
        db.refresh(interview)

    return interview


@router.post("/{interview_id}/direct-evaluation-with-audio")
def submit_direct_evaluation_with_audio(
    interview_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    evaluation: str = Form(...),
    suggestion: str = Form(None),
    score: int = Form(5),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """同时上传录音和评价，AI综合分析生成最终评价"""
    from app.services.audio_service import transcribe_audio

    interview = get_interview(db, interview_id)
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    upload_dir = f"uploads/full_audio/{interview_id}"
    os.makedirs(upload_dir, exist_ok=True)

    file_extension = file.filename.split(".")[-1] if "." in file.filename else "webm"
    file_name = f"full_interview.{file_extension}"
    file_path = os.path.join(upload_dir, file_name)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        transcript_data = transcribe_audio(file_path)
        transcript = transcript_data.get("text", "") if isinstance(transcript_data, dict) else str(transcript_data)
    except Exception as e:
        transcript = f"转写失败: {str(e)}"
        transcript_data = {"text": transcript, "segments": []}

    interview.audio_records = {"full_interview": file_path}
    interview.transcripts = {
        "full_interview": transcript,
        "full_interview_data": transcript_data
    }

    panel_members = interview.panel_members or []
    is_multi_interviewer = len(panel_members) > 1

    if is_multi_interviewer:
        panel = db.query(InterviewPanel).filter(
            InterviewPanel.interview_id == interview_id,
            InterviewPanel.interviewer_id == current_user.id
        ).first()
        
        if panel:
            panel.scores = {"overall": score}
            panel.comments = {"overall": evaluation}
            panel.total_score = score
            panel.is_submitted = True
            db.commit()
            db.refresh(panel)
        
        submitted_panels = db.query(InterviewPanel).filter(
            InterviewPanel.interview_id == interview_id,
            InterviewPanel.is_submitted == True
        ).all()
        
        submitted_ids = [str(p.interviewer_id) for p in submitted_panels]
        required_ids = [str(uid) for uid in panel_members]
        
        print(f"[Direct Eval Audio] Submitted IDs: {submitted_ids}")
        print(f"[Direct Eval Audio] Required IDs: {required_ids}")
        
        all_submitted = all(uid in submitted_ids for uid in required_ids)
        print(f"[Direct Eval Audio] All submitted: {all_submitted}")
        
        if all_submitted:
            interview.status = InterviewStatus.ANALYZING
            interview.result = InterviewResult.PENDING
            
            all_evaluations = []
            for p in submitted_panels:
                interviewer_name = p.interviewer_user.full_name if p.interviewer_user else str(p.interviewer_id)
                all_evaluations.append(f"**{interviewer_name}**: {p.comments.get('overall', '')} (评分: {p.total_score})")
            
            combined_evaluation = "\n\n".join(all_evaluations)
            avg_score = sum(p.total_score or 0 for p in submitted_panels) // len(submitted_panels)
            
            interview.evaluation = combined_evaluation
            interview.suggestion = "综合多位面试官评价"
            interview.total_score = avg_score
            interview.scores = {"overall": avg_score}
            interview.comments = {"overall": combined_evaluation}
            
            db.commit()
            db.refresh(interview)
            
            if transcript:
                background_tasks.add_task(
                    generate_combined_evaluation,
                    interview_id,
                    transcript,
                    combined_evaluation,
                    "综合多位面试官评价",
                    avg_score
                )
            else:
                interview.status = InterviewStatus.COMPLETED
                db.commit()
                db.refresh(interview)
        else:
            interview.result = InterviewResult.PENDING
            db.commit()
            db.refresh(interview)
    else:
        interview.evaluation = evaluation
        interview.suggestion = suggestion
        interview.total_score = score
        interview.scores = {"overall": score}
        interview.comments = {"overall": evaluation}

        if transcript:
            interview.status = InterviewStatus.ANALYZING
            interview.result = InterviewResult.PENDING
            background_tasks.add_task(
                generate_combined_evaluation,
                interview_id,
                transcript,
                evaluation,
                suggestion,
                score
            )
        else:
            interview.status = InterviewStatus.COMPLETED
            interview.result = InterviewResult.PENDING

        db.commit()
        db.refresh(interview)

    return interview


def generate_evaluation_from_transcript(interview_id: UUID, transcript: str):
    """根据转写内容生成评价（后台任务）"""
    generate_combined_evaluation(interview_id, transcript, None, None, None)


def generate_combined_evaluation(
    interview_id: UUID,
    transcript: str,
    interviewer_evaluation: str = None,
    interviewer_suggestion: str = None,
    interviewer_score: int = None
):
    """根据录音转写和面试官评价综合生成评价（后台任务）"""
    from app.config.database import SessionLocal
    from app.services.ai_service import generate_text
    from app.models.models import Interview as InterviewModel, Resume, Position

    db = SessionLocal()
    try:
        interview = db.query(InterviewModel).filter(InterviewModel.id == interview_id).first()
        if not interview:
            return

        # 获取简历和岗位信息
        resume = db.query(Resume).filter(Resume.id == interview.resume_id).first()
        position = db.query(Position).filter(Position.id == interview.position_id).first()

        # 构建提示词
        if interviewer_evaluation:
            # 有面试官评价，结合录音分析
            prompt = f"""请根据面试录音转写内容和面试官的评价，生成一份综合面试评价报告。

候选人：{resume.candidate_name if resume else '未知'}
应聘岗位：{position.title if position else '未知'}

## 面试录音转写内容：
{transcript}

## 面试官填写的评价：
{interviewer_evaluation}

## 面试官的录用建议：
{interviewer_suggestion or '无'}

## 面试官评分：{interviewer_score or '未打分'}分

请结合以上信息，生成一份综合评价报告，要求：
1. 总结面试录音中的关键信息（技术能力、项目经验、沟通能力等）
2. 分析面试官评价的准确性，如有出入请指出
3. 给出最终的综合评价和录用建议
4. 格式清晰，使用Markdown格式"""
        else:
            # 只有录音，没有面试官评价
            prompt = f"""请根据以下面试录音转写内容，对候选人进行综合评价。

候选人：{resume.candidate_name if resume else '未知'}
应聘岗位：{position.title if position else '未知'}

面试录音转写内容：
{transcript}

请从以下几个方面进行评价：
1. 技术能力评估
2. 沟通表达能力
3. 项目经验分析
4. 综合素质评价
5. 录用建议

请用中文回答，格式清晰。"""

        # 调用AI生成评价
        evaluation = generate_text(prompt)

        if evaluation:
            interview.evaluation = evaluation
            interview.status = InterviewStatus.COMPLETED
            interview.result = InterviewResult.PENDING

            # 如果有面试官评分，保留
            if interviewer_score:
                interview.total_score = interviewer_score
                interview.scores = {"overall": interviewer_score}

            # 保存综合建议
            if interviewer_suggestion:
                interview.suggestion = interviewer_suggestion

            db.commit()

    except Exception as e:
        print(f"生成评价失败: {e}")
    finally:
        db.close()
