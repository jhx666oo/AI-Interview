"""
面试提醒服务

负责检查即将到来的面试并发送提醒邮件。
可以通过定时任务或API调用触发。
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.models.models import Interview, InterviewStatus, Resume, Position, User
from app.services.mail_service import MailService, get_mail_service

logger = logging.getLogger(__name__)


class ReminderService:
    """面试提醒服务"""

    # 提醒时间配置（小时）
    REMINDER_TIMES = {
        "1_day": 24,  # 提前1天
        "1_hour": 1,  # 提前1小时
    }

    def __init__(self, db: Session):
        self.db = db
        self.mail_service = get_mail_service(db)

    def get_upcoming_interviews(self, hours_ahead: int = 25) -> List[Interview]:
        """
        获取即将到来的面试

        Args:
            hours_ahead: 查询未来多少小时内的面试

        Returns:
            List[Interview]: 即将到来的面试列表
        """
        now = datetime.now(timezone.utc)
        end_time = now + timedelta(hours=hours_ahead)

        interviews = self.db.query(Interview).filter(
            and_(
                Interview.status == InterviewStatus.SCHEDULED,
                Interview.interview_time >= now,
                Interview.interview_time <= end_time
            )
        ).all()

        return interviews

    def should_send_reminder(
        self,
        interview_time: datetime,
        reminder_type: str
    ) -> bool:
        """
        判断是否应该发送提醒

        Args:
            interview_time: 面试时间
            reminder_type: 提醒类型（"1_day" 或 "1_hour"）

        Returns:
            bool: 是否应该发送提醒
        """
        if not interview_time:
            return False

        now = datetime.now(timezone.utc)

        # 确保 interview_time 有时区
        if interview_time.tzinfo is None:
            interview_time = interview_time.replace(tzinfo=timezone.utc)

        hours_until = (interview_time - now).total_seconds() / 3600
        reminder_hours = self.REMINDER_TIMES.get(reminder_type, 0)

        # 在提醒时间前后30分钟内发送
        lower_bound = reminder_hours - 0.5
        upper_bound = reminder_hours + 0.5

        return lower_bound <= hours_until <= upper_bound

    def send_reminder_for_interview(
        self,
        interview: Interview,
        reminder_type: str
    ) -> Dict[str, Any]:
        """
        为单个面试发送提醒

        Args:
            interview: 面试记录
            reminder_type: 提醒类型

        Returns:
            dict: 发送结果
        """
        result = {
            "interview_id": str(interview.id),
            "reminder_type": reminder_type,
            "candidate_reminder_sent": False,
            "interviewer_reminders_sent": [],
            "errors": []
        }

        # 获取关联信息
        resume = self.db.query(Resume).filter(Resume.id == interview.resume_id).first()
        position = self.db.query(Position).filter(Position.id == interview.position_id).first()

        if not resume:
            result["errors"].append("未找到关联的简历记录")
            return result

        if not position:
            result["errors"].append("未找到关联的岗位记录")
            return result

        reminder_text = "1天" if reminder_type == "1_day" else "1小时"

        # 发送给候选人
        if resume.email:
            success = self.mail_service.send_interview_reminder(
                interview=interview,
                recipient_email=resume.email,
                recipient_name=resume.candidate_name or "候选人",
                is_candidate=True,
                candidate_name=resume.candidate_name,
                position_title=position.title,
                interview_time=interview.interview_time,
                interview_round=interview.round or 1,
                reminder_type=reminder_text,
                company_name="公司"
            )
            result["candidate_reminder_sent"] = success
            if not success:
                result["errors"].append("候选人提醒邮件发送失败")
        else:
            result["errors"].append("候选人邮箱为空")

        # 发送给面试官
        if interview.panel_members:
            for interviewer_id in interview.panel_members:
                interviewer = self.db.query(User).filter(User.id == interviewer_id).first()
                if interviewer and interviewer.email:
                    success = self.mail_service.send_interview_reminder(
                        interview=interview,
                        recipient_email=interviewer.email,
                        recipient_name=interviewer.full_name or "面试官",
                        is_candidate=False,
                        candidate_name=resume.candidate_name,
                        position_title=position.title,
                        interview_time=interview.interview_time,
                        interview_round=interview.round or 1,
                        reminder_type=reminder_text,
                        company_name="公司"
                    )
                    result["interviewer_reminders_sent"].append({
                        "interviewer_id": str(interviewer_id),
                        "name": interviewer.full_name,
                        "sent": success
                    })
                    if not success:
                        result["errors"].append(f"面试官 {interviewer.full_name} 提醒邮件发送失败")

        return result

    def process_reminders(self) -> Dict[str, Any]:
        """
        处理所有待发送的提醒

        Returns:
            dict: 处理结果统计
        """
        results = {
            "total_processed": 0,
            "1_day_reminders": [],
            "1_hour_reminders": [],
            "errors": []
        }

        # 获取即将到来的面试
        interviews = self.get_upcoming_interviews(hours_ahead=25)
        results["total_processed"] = len(interviews)

        for interview in interviews:
            # 检查是否需要发送1天提醒
            if self.should_send_reminder(interview.interview_time, "1_day"):
                reminder_result = self.send_reminder_for_interview(interview, "1_day")
                results["1_day_reminders"].append(reminder_result)

            # 检查是否需要发送1小时提醒
            if self.should_send_reminder(interview.interview_time, "1_hour"):
                reminder_result = self.send_reminder_for_interview(interview, "1_hour")
                results["1_hour_reminders"].append(reminder_result)

        logger.info(
            f"Processed {results['total_processed']} interviews, "
            f"sent {len(results['1_day_reminders'])} 1-day reminders, "
            f"{len(results['1_hour_reminders'])} 1-hour reminders"
        )

        return results

    def send_immediate_reminder(
        self,
        interview_id: UUID,
        reminder_type: str = "1_hour"
    ) -> Dict[str, Any]:
        """
        立即发送提醒（用于手动触发）

        Args:
            interview_id: 面试ID
            reminder_type: 提醒类型

        Returns:
            dict: 发送结果
        """
        interview = self.db.query(Interview).filter(Interview.id == interview_id).first()

        if not interview:
            return {
                "success": False,
                "error": "面试记录不存在"
            }

        if interview.status != InterviewStatus.SCHEDULED:
            return {
                "success": False,
                "error": f"面试状态不是 SCHEDULED，当前状态: {interview.status.value}"
            }

        result = self.send_reminder_for_interview(interview, reminder_type)
        result["success"] = result["candidate_reminder_sent"] or len(result["interviewer_reminders_sent"]) > 0

        return result


def run_reminder_task(db: Session) -> Dict[str, Any]:
    """
    运行提醒任务（用于后台任务或定时任务）

    Args:
        db: 数据库会话

    Returns:
        dict: 任务结果
    """
    service = ReminderService(db)
    return service.process_reminders()