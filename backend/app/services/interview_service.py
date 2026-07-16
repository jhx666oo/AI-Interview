from uuid import UUID
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session, joinedload
from app.models.models import Interview, Resume, Position, InterviewStatus, InterviewResult, QuestionBank, ResumeStatus, ScreeningResult, InterviewPanel, User
from app.schemas.interview import InterviewCreate, InterviewUpdate, InterviewScore
from fastapi import BackgroundTasks
import logging

logger = logging.getLogger(__name__)

# 中国时区 UTC+8
CHINA_TIMEZONE = timezone(timedelta(hours=8))

def format_datetime_cn(dt: datetime) -> str:
    """将UTC时间转换为中国时区并格式化"""
    if not dt:
        return 'N/A'
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt_cn = dt.astimezone(CHINA_TIMEZONE)
    return dt_cn.strftime('%Y-%m-%d %H:%M')

def start_interview(db: Session, interview_id: UUID):
    """
    开始面试，将状态从 SCHEDULED 改为 IN_PROGRESS，并记录开始时间。
    """
    db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not db_interview:
        return None

    if db_interview.status != InterviewStatus.SCHEDULED:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot start interview with status {db_interview.status.value}"
        )

    db_interview.status = InterviewStatus.IN_PROGRESS
    db_interview.started_at = datetime.utcnow()
    db.commit()
    db.refresh(db_interview)

    print(f"Interview {interview_id} status changed to IN_PROGRESS, started_at: {db_interview.started_at}")
    return db_interview

def submit_interview_panel_score(db: Session, interview_id: UUID, interviewer_id: UUID, score_data: InterviewScore):
    """
    Submit score for a specific interviewer (panel member).
    统一的评分提交入口，单面试官和多面试官都使用此函数。
    """
    db_interview = db.query(Interview).get(interview_id)
    if not db_interview:
        return None, False

    if db_interview.status == InterviewStatus.SCHEDULED:
        db_interview.status = InterviewStatus.IN_PROGRESS
        print(f"Interview {interview_id} status auto-changed to IN_PROGRESS on first score submission")
        db.commit()

    if not db_interview.panel_members or len(db_interview.panel_members) == 0:
        db_interview.panel_members = [str(interviewer_id)]
        db.commit()

    panel = db.query(InterviewPanel).filter(
        InterviewPanel.interview_id == interview_id,
        InterviewPanel.interviewer_id == interviewer_id
    ).first()

    avg_score = sum(score_data.scores.values()) // len(score_data.scores) if score_data.scores else 0

    if not panel:
        panel = InterviewPanel(
            interview_id=interview_id,
            interviewer_id=interviewer_id,
            scores=score_data.scores,
            comments=score_data.comments,
            total_score=avg_score,
            is_submitted=True
        )
        db.add(panel)
    else:
        panel.scores = score_data.scores
        panel.comments = score_data.comments
        panel.total_score = avg_score
        panel.is_submitted = True

    db.commit()
    db.refresh(panel)
    
    db_interview = db.query(Interview).get(interview_id)
    all_submitted = False
    if db_interview and db_interview.panel_members:
        submitted_panels = db.query(InterviewPanel).filter(
            InterviewPanel.interview_id == interview_id,
            InterviewPanel.is_submitted == True
        ).all()
        
        submitted_interviewer_ids = [str(p.interviewer_id) for p in submitted_panels]
        required_interviewer_ids = [str(uid) for uid in db_interview.panel_members]
        
        print(f"[Panel Score] Submitted IDs: {submitted_interviewer_ids}")
        print(f"[Panel Score] Required IDs: {required_interviewer_ids}")
        
        all_submitted = all(uid in submitted_interviewer_ids for uid in required_interviewer_ids)
        print(f"[Panel Score] All submitted: {all_submitted}")

    return panel, all_submitted

def get_interview_panels(db: Session, interview_id: UUID):
    return db.query(InterviewPanel).filter(InterviewPanel.interview_id == interview_id).all()

def aggregate_panel_scores(db: Session, interview_id: UUID, background_tasks: BackgroundTasks):
    """
    Aggregate scores from all panels to main interview record and generate AI evaluation.
    """
    panels = db.query(InterviewPanel).filter(
        InterviewPanel.interview_id == interview_id,
        InterviewPanel.is_submitted == True
    ).all()
    
    if not panels:
        return None
        
    # Aggregate logic: Average scores per question
    aggregated_scores = {}
    aggregated_comments = {}
    
    # Assuming all panels use the same question indices
    # We need to collect all scores for each question index
    question_scores_map = {} # { "0": [8, 9], "1": [7, 8] }
    
    # Collect aggregated transcripts
    aggregated_transcripts = {}
    
    for panel in panels:
        if not panel.scores: continue
        for q_idx, score in panel.scores.items():
            if q_idx not in question_scores_map:
                question_scores_map[q_idx] = []
            question_scores_map[q_idx].append(score)
            
        # Collect comments
        if panel.comments:
            for q_idx, comment in panel.comments.items():
                interviewer = db.query(User).get(panel.interviewer_id)
                name = interviewer.full_name if interviewer else "Interviewer"
                if q_idx not in aggregated_comments:
                    aggregated_comments[q_idx] = ""
                aggregated_comments[q_idx] += f"**{name}**: {comment}\n\n"
        
        # Collect transcripts (just concatenate or use first valid one)
        # Ideally, we should group them by question. 
        # If multiple recordings exist for same question (e.g. from different interviewers? unlikely for same candidate unless split),
        # we can append them.
        if panel.transcripts:
            for q_idx, transcript in panel.transcripts.items():
                if q_idx not in aggregated_transcripts:
                    aggregated_transcripts[q_idx] = ""
                # Avoid duplicate transcript if multiple panels upload same? 
                # Usually only one interviewer records, or they record sequentially.
                # Let's append with interviewer name if needed, or just append.
                if transcript:
                    interviewer = db.query(User).get(panel.interviewer_id)
                    name = interviewer.full_name if interviewer else "Interviewer"
                    aggregated_transcripts[q_idx] += f"[{name}记录]: {transcript}\n"

    # Calculate averages
    for q_idx, scores_list in question_scores_map.items():
        if scores_list:
            aggregated_scores[q_idx] = round(sum(scores_list) / len(scores_list))
            
    # Update main interview record
    db_interview = db.query(Interview).get(interview_id)
    if db_interview:
        db_interview.scores = aggregated_scores
        db_interview.comments = aggregated_comments
        db_interview.transcripts = aggregated_transcripts
        
        # Trigger AI evaluation with detailed panel comments AND transcripts
        # Convert aggregated_comments to a string format for AI
        panel_details_str = ""
        for q_idx, comment_str in aggregated_comments.items():
            panel_details_str += f"Question {q_idx} Comments:\n{comment_str}\n"
            
        # Add transcripts to context
        transcript_context = ""
        for q_idx, trans in aggregated_transcripts.items():
             transcript_context += f"Question {q_idx} Candidate Answer:\n{trans}\n"

        background_tasks.add_task(
            generate_evaluation_background,
            db_interview.id,
            {
                "scores": aggregated_scores,
                "panel_details": panel_details_str,
                "transcripts": transcript_context
            }
        )

        db_interview.status = InterviewStatus.ANALYZING
        db.commit()
        db.refresh(db_interview)
        print(f"Panel scores aggregated for interview {interview_id}, status changed to ANALYZING")
        return db_interview
    return None
from fastapi import HTTPException
from app.services.ai_service import generate_interview_questions, generate_interview_evaluation
from app.services.resume_service import read_file_content
import json
from datetime import timezone

from app.config.database import SessionLocal
from fastapi import BackgroundTasks

def _normalize_dt_utc(dt):
    if dt is None:
        return None
    if getattr(dt, "tzinfo", None) is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def generate_questions_background(interview_id: UUID, question_bank_ids: list, question_count: int, interview_category: str = 'technical'):
    db = SessionLocal()
    try:
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            return

        resume = db.query(Resume).filter(Resume.id == interview.resume_id).first()
        position = db.query(Position).filter(Position.id == interview.position_id).first()

        if not resume or not position:
            return

        # 获取参考题库内容
        qb_content = ""
        if question_bank_ids:
            qbs = db.query(QuestionBank).filter(QuestionBank.id.in_(question_bank_ids)).all()
            for qb in qbs:
                if qb.source_file:
                    content = read_file_content(qb.source_file)
                    if content:
                        qb_content += f"\n--- 参考题库: {qb.name} ---\n{content[:5000]}\n"

        # 生成面试题
        position_desc = f"{position.title}\n{position.description}\n{position.requirements}"
        resume_data = resume.parsed_data if resume.parsed_data else {}

        questions = generate_interview_questions(
            resume_data,
            position_desc,
            qb_content,
            question_count,
            interview_category
        )

        interview.questions = questions
        db.commit()
        
    except Exception as e:
        print(f"Error generating questions for interview {interview_id}: {e}")
    finally:
        db.close()

def create_interview(db: Session, interview: InterviewCreate, background_tasks: BackgroundTasks):
    # 检查简历和岗位是否存在
    resume = db.query(Resume).filter(Resume.id == interview.resume_id).first()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    position = db.query(Position).filter(Position.id == interview.position_id).first()
    if not position:
        raise HTTPException(status_code=404, detail="Position not found")

    interview_category = interview.interview_category or 'technical'

    db_interview = Interview(
        resume_id=interview.resume_id,
        position_id=interview.position_id,
        interviewer=interview.interviewer,
        interview_time=_normalize_dt_utc(interview.interview_time),
        questions=None if not interview.skip_ai_questions else [], # None means generating, [] means skipped
        status=InterviewStatus.SCHEDULED,
        panel_members=interview.panel_members,
        round=interview.round or 1,
        # 正确保存面试类型和地点字段
        interview_type=interview.interview_type or "onsite",
        interview_category=interview_category,
        interview_location=interview.interview_location,
        meeting_link=interview.meeting_link
    )

    db.add(db_interview)
    db.commit()
    db.refresh(db_interview)

    if interview.panel_members:
        for interviewer_id in interview.panel_members:
            try:
                interviewer_uuid = UUID(interviewer_id) if isinstance(interviewer_id, str) else interviewer_id
            except (ValueError, TypeError):
                print(f"Invalid interviewer_id: {interviewer_id}")
                continue
            panel = InterviewPanel(
                interview_id=db_interview.id,
                interviewer_id=interviewer_uuid,
                is_submitted=False
            )
            db.add(panel)
        db.commit()

    if not interview.skip_ai_questions:
        background_tasks.add_task(
            generate_questions_background,
            db_interview.id,
            interview.question_bank_ids,
            interview.question_count or 5,
            interview_category
        )

    if not interview.skip_email:
        background_tasks.add_task(
            send_interview_invitation_background,
            db_interview.id
        )

    return db_interview


def send_interview_invitation_background(interview_id: UUID):
    """
    后台任务：发送面试邀请邮件
    """
    from app.config.database import SessionLocal
    from app.services.mail_service import get_mail_service

    db = SessionLocal()
    try:
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            logger.warning(f"Interview {interview_id} not found for sending invitation")
            return

        mail_service = get_mail_service(db)
        result = mail_service.send_interview_invitation_for_interview(interview)

        if result["success"]:
            logger.info(f"Interview invitation sent successfully for interview {interview_id}")
        else:
            logger.warning(f"Failed to send invitation for interview {interview_id}: {result['errors']}")

    except Exception as e:
        logger.error(f"Error sending interview invitation for {interview_id}: {e}")
    finally:
        db.close()

def export_interview_result(db: Session, interview_id: UUID, format: str = "markdown"):
    db_interview = db.query(Interview).options(
        joinedload(Interview.resume),
        joinedload(Interview.position)
    ).filter(Interview.id == interview_id).first()
    
    if not db_interview:
        return None
        
    candidate_name = db_interview.resume.candidate_name if db_interview.resume else "Candidate"
    position_title = db_interview.position.title if db_interview.position else "Position"
    
    # Always return Markdown
    content = f"# 面试评估报告\n\n"
    content += f"- **候选人**: {candidate_name}\n"
    content += f"- **应聘岗位**: {position_title}\n"
    content += f"- **面试时间**: {format_datetime_cn(db_interview.interview_time)}\n"
    content += f"- **面试结果**: {db_interview.result.value if db_interview.result else 'N/A'}\n"
    content += f"- **综合得分**: {db_interview.total_score if db_interview.total_score is not None else 'N/A'}\n\n"
    
    # AI初审评价
    if db_interview.resume:
        resume = db_interview.resume
        content += "## 简历初审评价\n\n"
        content += f"- **匹配度评分**: {resume.match_score if resume.match_score is not None else 'N/A'} 分\n"
        
        screening_result_text = '待定'
        if resume.screening_result:
            screening_map = {
                'passed': '通过',
                'rejected': '淘汰',
                'waitlist': '待定'
            }
            screening_result_text = screening_map.get(resume.screening_result.value if hasattr(resume.screening_result, 'value') else resume.screening_result, resume.screening_result)
        content += f"- **初审结果**: {screening_result_text}\n\n"
        
        if resume.ai_review:
            content += "**AI 评价**:\n\n"
            content += f"{resume.ai_review}\n\n"
        content += "---\n\n"
    
    content += "## 综合评价\n\n"
    content += f"{db_interview.evaluation or '暂无评价'}\n\n"
    
    content += "## 详细评估\n\n"
    
    questions = db_interview.questions or []
    scores = db_interview.scores or {}
    comments = db_interview.comments or {}
    
    for i, q in enumerate(questions):
        idx = str(i)
        title = q.get('title', f'问题 {i+1}')
        score = scores.get(idx, 0)
        comment = comments.get(idx, '暂无评语')
        
        content += f"### {i+1}. {title}\n\n"
        content += f"**平均得分**: {score}/10\n\n"
        content += f"**问题内容**:\n{q.get('content', '')}\n\n"
        content += f"**参考答案**:\n{q.get('reference_answer', '')}\n\n"
        
        # Display aggregated comments or detailed panel breakdown
        # comments for aggregated interview is already formatted as "**Name**: comment"
        if comment:
             content += f"**面试官详细评语**:\n{comment}\n\n"
        else:
             content += f"**面试官评语**: 暂无\n\n"
             
        content += "---\n\n"
        
    return content

def get_interviews(db: Session, skip: int = 0, limit: int = 100, status: str = None):
    query = db.query(Interview).options(
        joinedload(Interview.resume),
        joinedload(Interview.position)
    )
    if status:
        query = query.filter(Interview.status == status)
    return query.offset(skip).limit(limit).all()

def get_interviews_for_interviewer(db: Session, interviewer_id: UUID, skip: int = 0, limit: int = 100):
    """
    Fetch interviews where the user is a panel member.
    Since panel_members is a JSON column storing a list of IDs, we need to filter in memory 
    or use dialect-specific JSON operators. For portability and simplicity with small datasets,
    we'll filter in Python. Ideally, use a many-to-many relationship table.
    """
    # Fetch all interviews (or a larger subset) and filter
    # Optimization: Filter by status if needed, but here we want all.
    all_interviews = db.query(Interview).options(
        joinedload(Interview.resume),
        joinedload(Interview.position)
    ).all()
    
    filtered = []
    str_id = str(interviewer_id)
    
    for interview in all_interviews:
        if interview.panel_members and str_id in [str(m) for m in interview.panel_members]:
            filtered.append(interview)
            
    # Apply skip/limit
    return filtered[skip: skip + limit]

def get_interview(db: Session, interview_id: UUID):
    return db.query(Interview).options(
        joinedload(Interview.resume),
        joinedload(Interview.position),
        joinedload(Interview.panels)
    ).filter(Interview.id == interview_id).first()

def update_interview(db: Session, interview_id: UUID, interview: InterviewUpdate):
    db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not db_interview:
        return None
    
    update_data = interview.dict(exclude_unset=True)
    for key, value in update_data.items():
        if key == "interview_time":
            value = _normalize_dt_utc(value)
        setattr(db_interview, key, value)
    
    db.commit()
    db.refresh(db_interview)
    return db_interview

def update_interview_questions(db: Session, interview_id: UUID, questions: list):
    db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not db_interview:
        return None
    
    db_interview.questions = questions
    db.commit()
    db.refresh(db_interview)
    return db_interview

def delete_interview(db: Session, interview_id: UUID):
    db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not db_interview:
        return None

    db.delete(db_interview)
    db.commit()
    return db_interview

def cancel_interview(db: Session, interview_id: UUID, reason: str = None):
    """
    取消面试，将状态改为 CANCELLED。
    只有 SCHEDULED 或 IN_PROGRESS 状态的面试可以取消。
    """
    db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not db_interview:
        return None

    if db_interview.status == InterviewStatus.COMPLETED:
        raise HTTPException(
            status_code=400,
            detail="Cannot cancel a completed interview."
        )

    db_interview.status = InterviewStatus.CANCELLED
    if reason:
        existing_comments = db_interview.comments or {}
        existing_comments["cancel_reason"] = reason
        db_interview.comments = existing_comments

    db.commit()
    db.refresh(db_interview)
    print(f"Interview {interview_id} cancelled")
    return db_interview

def get_submission_status(db: Session, interview_id: UUID):
    """
    获取面试的评分提交状态。
    返回各面试官是否已提交评分。
    """
    db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not db_interview:
        return None

    panel_members = db_interview.panel_members or []
    panels = db.query(InterviewPanel).filter(
        InterviewPanel.interview_id == interview_id
    ).all()

    submission_status = {}
    for member_id in panel_members:
        # 将字符串 ID 转换为 UUID 进行查询
        try:
            member_uuid = UUID(member_id) if isinstance(member_id, str) else member_id
        except (ValueError, TypeError):
            member_uuid = member_id

        member_panel = next(
            (p for p in panels if str(p.interviewer_id) == str(member_id)),
            None
        )
        interviewer = db.query(User).filter(User.id == member_uuid).first()
        submission_status[str(member_id)] = {
            "name": interviewer.full_name if interviewer else "Unknown",
            "submitted": member_panel.is_submitted if member_panel else False,
            "submitted_at": member_panel.updated_at if member_panel and member_panel.is_submitted else None
        }

    return {
        "interview_id": str(interview_id),
        "total_members": len(panel_members),
        "submitted_count": sum(1 for s in submission_status.values() if s["submitted"]),
        "members": submission_status
    }

def generate_evaluation_background(interview_id: UUID, score_data: dict):
    db = SessionLocal()
    try:
        db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if not db_interview:
            return
        
        if db_interview.status != InterviewStatus.ANALYZING:
            db_interview.status = InterviewStatus.ANALYZING
            db.commit()
            
        scores = score_data.get('scores', {})
        panel_details = score_data.get('panel_details', "")
        transcripts = score_data.get('transcripts', "")
        
        if not scores:
            db_interview.status = InterviewStatus.COMPLETED
            db_interview.result = InterviewResult.PENDING
            db.commit()
            return

        count = len(scores)
        total_sum = sum(scores.values())
        average_score = round(total_sum / count) if count > 0 else 0
        
        db_interview.total_score = average_score
        
        try:
            questions = db_interview.questions or []
            evaluation_result = generate_interview_evaluation(
                questions,
                scores,
                average_score,
                panel_details=panel_details,
                transcripts=transcripts
            )
            db_interview.evaluation = evaluation_result.get("evaluation")
            db_interview.suggestion = evaluation_result.get("suggestion")
        except Exception as eval_error:
            print(f"Evaluation generation failed for interview {interview_id}: {eval_error}")
            db_interview.evaluation = "AI评价生成失败，请手动填写评价"
            db_interview.suggestion = "waitlist"
        
        db_interview.result = InterviewResult.PENDING
        db_interview.status = InterviewStatus.COMPLETED
        
        db.commit()
        
    except Exception as e:
        print(f"Error generating evaluation for interview {interview_id}: {e}")
        try:
            db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
            if db_interview:
                db_interview.status = InterviewStatus.COMPLETED
                db_interview.result = InterviewResult.PENDING
                db.commit()
        except:
            pass
    finally:
        db.close()


def generate_combined_evaluation(interview_id: UUID, transcript: str, interviewer_evaluation: str, interviewer_suggestion: str, interviewer_score: int):
    """
    后台任务：结合录音转写和面试官评价生成综合评价
    """
    from app.services.ai_service import generate_interview_evaluation_from_transcript
    
    db = SessionLocal()
    try:
        db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if not db_interview:
            return
        
        if db_interview.status != InterviewStatus.ANALYZING:
            db_interview.status = InterviewStatus.ANALYZING
            db.commit()
        
        try:
            evaluation_result = generate_interview_evaluation_from_transcript(
                transcript,
                interviewer_evaluation,
                interviewer_score
            )
            db_interview.evaluation = evaluation_result.get("evaluation", interviewer_evaluation)
            db_interview.suggestion = evaluation_result.get("suggestion", interviewer_suggestion)
        except Exception as eval_error:
            print(f"Combined evaluation generation failed: {eval_error}")
            db_interview.evaluation = interviewer_evaluation
            db_interview.suggestion = interviewer_suggestion
        
        db_interview.status = InterviewStatus.COMPLETED
        db_interview.result = InterviewResult.PENDING
        db.commit()
        
    except Exception as e:
        print(f"Error in combined evaluation for interview {interview_id}: {e}")
        try:
            db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
            if db_interview:
                db_interview.status = InterviewStatus.COMPLETED
                db_interview.result = InterviewResult.PENDING
                db.commit()
        except:
            pass
    finally:
        db.close()


def confirm_interview_result(db: Session, interview_id: UUID, result: str, background_tasks: BackgroundTasks = None):
    db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not db_interview:
        return None

    # 更新结果和状态
    # result string comes from frontend as 'passed', 'rejected', 'waitlist', 'hired', 'next_round' (lowercase)
    # InterviewResult enum members are PASSED, REJECTED, WAITLIST, HIRED, NEXT_ROUND (uppercase)
    result_upper = result.upper()

    if result_upper in InterviewResult.__members__:
        db_interview.result = InterviewResult[result_upper]
    else:
        # Fallback or error handling
        print(f"Invalid result value: {result}")
        return None

    db_interview.status = InterviewStatus.COMPLETED

    # 同步更新简历状态
    if db_interview.resume_id:
        resume = db.query(Resume).filter(Resume.id == db_interview.resume_id).first()
        if resume:
            # 录用 - 面试通过，等待发Offer
            if db_interview.result == InterviewResult.HIRED:
                resume.status = ResumeStatus.OFFER_PENDING
                resume.screening_result = ScreeningResult.PASSED
            # 进入下一轮 - 简历保持待面试状态，可以安排下一轮面试
            elif db_interview.result == InterviewResult.NEXT_ROUND:
                resume.status = ResumeStatus.PENDING_INTERVIEW
                resume.screening_result = ScreeningResult.PASSED
            # 通过 - 面试通过，等待后续安排
            elif db_interview.result == InterviewResult.PASSED:
                resume.status = ResumeStatus.INTERVIEW_PASSED
                resume.screening_result = ScreeningResult.PASSED
            # 淘汰
            elif db_interview.result == InterviewResult.REJECTED:
                resume.status = ResumeStatus.INTERVIEW_FAILED
                resume.screening_result = ScreeningResult.REJECTED
            # 待定
            elif db_interview.result == InterviewResult.WAITLIST:
                resume.status = ResumeStatus.WAITLIST
                resume.screening_result = ScreeningResult.WAITLIST

            # Commit explicitly for resume if needed, but db.commit() below handles all changes in session

    db.commit()
    db.refresh(db_interview)

    # 发送结果通知邮件（后台任务）- 录用、淘汰、进入下一轮都发送
    if background_tasks and db_interview.result in [InterviewResult.HIRED, InterviewResult.REJECTED, InterviewResult.NEXT_ROUND]:
        background_tasks.add_task(
            send_result_notification_background,
            db_interview.id
        )

    return db_interview


def send_result_notification_background(interview_id: UUID):
    """
    后台任务：发送面试结果通知邮件
    """
    from app.config.database import SessionLocal
    from app.services.mail_service import get_mail_service

    db = SessionLocal()
    try:
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            logger.warning(f"Interview {interview_id} not found for sending result notification")
            return

        mail_service = get_mail_service(db)
        result = mail_service.send_result_notification_for_interview(interview)

        if result["success"]:
            logger.info(f"Result notification sent successfully for interview {interview_id}")
        else:
            logger.warning(f"Failed to send result notification for interview {interview_id}: {result.get('error')}")

    except Exception as e:
        logger.error(f"Error sending result notification for {interview_id}: {e}")
    finally:
        db.close()

def submit_interview_score(db: Session, interview_id: UUID, interviewer_id: UUID, score_data: InterviewScore, background_tasks: BackgroundTasks):
    """
    统一的评分提交函数，单面试官和多面试官都使用此函数。
    """
    db_interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not db_interview:
        return None

    if db_interview.status == InterviewStatus.SCHEDULED:
        db_interview.status = InterviewStatus.IN_PROGRESS
        db.commit()

    if not db_interview.panel_members or len(db_interview.panel_members) == 0:
        db_interview.panel_members = [str(interviewer_id)]
        db.commit()

    avg_score = sum(score_data.scores.values()) // len(score_data.scores) if score_data.scores else 0

    panel = db.query(InterviewPanel).filter(
        InterviewPanel.interview_id == interview_id,
        InterviewPanel.interviewer_id == interviewer_id
    ).first()

    if not panel:
        panel = InterviewPanel(
            interview_id=interview_id,
            interviewer_id=interviewer_id,
            scores=score_data.scores,
            comments=score_data.comments,
            total_score=avg_score,
            is_submitted=True
        )
        db.add(panel)
    else:
        panel.scores = score_data.scores
        panel.comments = score_data.comments
        panel.total_score = avg_score
        panel.is_submitted = True

    db.commit()
    db.refresh(panel)

    db_interview.scores = score_data.scores
    db_interview.comments = score_data.comments
    db_interview.total_score = avg_score
    db_interview.status = InterviewStatus.ANALYZING
    db_interview.result = InterviewResult.PENDING
    db.commit()
    db.refresh(db_interview)
    
    background_tasks.add_task(
        generate_evaluation_background,
        db_interview.id,
        {
            "scores": score_data.scores,
            "panel_details": "",
            "transcripts": ""
        }
    )
    
    return db_interview
