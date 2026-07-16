"""
邮件通知服务

支持发送面试邀请、面试提醒、结果通知等邮件。
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from uuid import UUID
import logging
import re

from sqlalchemy.orm import Session
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.models.models import SystemConfig, Interview, Resume, Position, User, InterviewResult

logger = logging.getLogger(__name__)

# 获取模板目录
TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")

# 初始化 Jinja2 环境
jinja_env = Environment(
    loader=FileSystemLoader(TEMPLATES_DIR),
    autoescape=select_autoescape(['html', 'xml'])
)


class EmailConfig:
    """邮件配置类"""
    def __init__(self, db: Session):
        config = db.query(SystemConfig).first()
        if config:
            self.smtp_host = config.smtp_host
            self.smtp_port = config.smtp_port or 465
            self.smtp_username = config.smtp_username
            self.smtp_password = config.smtp_password
            self.mail_from = config.mail_from
            self.mail_from_name = config.mail_from_name or "招聘系统"
            self.mail_enabled = config.mail_enabled or False
        else:
            self.smtp_host = None
            self.smtp_port = 465
            self.smtp_username = None
            self.smtp_password = None
            self.mail_from = None
            self.mail_from_name = "招聘系统"
            self.mail_enabled = False

    def is_valid(self) -> bool:
        """检查配置是否有效"""
        return all([
            self.smtp_host,
            self.smtp_username,
            self.smtp_password,
            self.mail_from,
            self.mail_enabled
        ])


class MailService:
    """邮件服务类"""

    def __init__(self, db: Session):
        self.db = db
        self.config = EmailConfig(db)

    def _render_template(self, template_name: str, context: Dict[str, Any]) -> str:
        """渲染邮件模板"""
        try:
            template = jinja_env.get_template(template_name)
            return template.render(**context)
        except Exception as e:
            logger.error(f"Error rendering template {template_name}: {e}")
            raise

    def _send_email(self, to_email: str, subject: str, html_content: str) -> bool:
        """
        发送邮件

        Args:
            to_email: 收件人邮箱
            subject: 邮件主题
            html_content: HTML 内容

        Returns:
            bool: 发送是否成功
        """
        if not self.config.is_valid():
            logger.warning("Mail service is not configured or disabled")
            return False

        if not to_email:
            logger.warning("No recipient email provided")
            return False

        # 验证邮箱格式
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, to_email):
            logger.warning(f"Invalid email format: {to_email}")
            return False

        try:
            # 创建邮件
            message = MIMEMultipart('alternative')
            message['Subject'] = subject
            message['From'] = formataddr((self.config.mail_from_name, self.config.mail_from))
            message['To'] = to_email

            # 添加 HTML 内容
            html_part = MIMEText(html_content, 'html', 'utf-8')
            message.attach(html_part)

            # 发送邮件
            with smtplib.SMTP_SSL(self.config.smtp_host, self.config.smtp_port) as server:
                server.login(self.config.smtp_username, self.config.smtp_password)
                server.sendmail(self.config.mail_from, to_email, message.as_string())

            logger.info(f"Email sent successfully to {to_email}")
            return True

        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"SMTP authentication failed: {e}")
            return False
        except smtplib.SMTPException as e:
            logger.error(f"SMTP error occurred: {e}")
            return False
        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False

    def send_interview_invitation(
        self,
        interview: Interview,
        candidate_email: str,
        candidate_name: str,
        position_title: str,
        interview_time: datetime,
        interview_round: int = 1,
        interview_type: str = "现场面试",
        interview_location: str = None,
        meeting_link: str = None,
        contact_person: str = None,
        contact_phone: str = None,
        company_name: str = "公司"
    ) -> bool:
        """
        发送面试邀请邮件

        Args:
            interview: 面试记录
            candidate_email: 候选人邮箱
            candidate_name: 候选人姓名
            position_title: 岗位名称
            interview_time: 面试时间
            interview_round: 面试轮次
            interview_type: 面试形式
            interview_location: 面试地点
            meeting_link: 会议链接
            contact_person: 联系人
            contact_phone: 联系电话
            company_name: 公司名称

        Returns:
            bool: 发送是否成功
        """
        # 格式化面试时间
        time_str = interview_time.strftime('%Y年%m月%d日 %H:%M') if interview_time else "待定"

        context = {
            "candidate_name": candidate_name,
            "position_title": position_title,
            "interview_time": time_str,
            "interview_round": interview_round,
            "interview_type": interview_type,
            "interview_location": interview_location,
            "meeting_link": meeting_link,
            "contact_person": contact_person or "HR",
            "contact_phone": contact_phone or "",
            "company_name": company_name
        }

        html_content = self._render_template("interview_invitation.html", context)
        subject = f"面试邀请 - {position_title} 岗位"

        return self._send_email(candidate_email, subject, html_content)

    def send_interview_reminder(
        self,
        interview: Interview,
        recipient_email: str,
        recipient_name: str,
        is_candidate: bool = True,
        candidate_name: str = None,
        position_title: str = None,
        interview_time: datetime = None,
        interview_round: int = 1,
        reminder_type: str = "1小时",
        interview_location: str = None,
        meeting_link: str = None,
        company_name: str = "公司"
    ) -> bool:
        """
        发送面试提醒邮件

        Args:
            interview: 面试记录
            recipient_email: 收件人邮箱
            recipient_name: 收件人姓名
            is_candidate: 是否为候选人（否则为面试官）
            candidate_name: 候选人姓名
            position_title: 岗位名称
            interview_time: 面试时间
            interview_round: 面试轮次
            reminder_type: 提醒类型（如"1小时"、"1天"）
            interview_location: 面试地点
            meeting_link: 会议链接
            company_name: 公司名称

        Returns:
            bool: 发送是否成功
        """
        time_str = interview_time.strftime('%Y年%m月%d日 %H:%M') if interview_time else "待定"

        context = {
            "recipient_name": recipient_name,
            "candidate_name": candidate_name or "",
            "position_title": position_title or "",
            "interview_time": time_str,
            "interview_round": interview_round,
            "reminder_time": reminder_type,
            "interview_location": interview_location,
            "meeting_link": meeting_link,
            "company_name": company_name
        }

        html_content = self._render_template("interview_reminder.html", context)
        subject = f"面试提醒 - {reminder_type}后开始"

        return self._send_email(recipient_email, subject, html_content)

    def send_result_notification(
        self,
        interview: Interview,
        candidate_email: str,
        candidate_name: str,
        position_title: str,
        result: InterviewResult,
        interview_round: int = 1,
        feedback: str = None,
        next_steps: str = None,
        company_name: str = "公司"
    ) -> bool:
        """
        发送面试结果通知邮件

        Args:
            interview: 面试记录
            candidate_email: 候选人邮箱
            candidate_name: 候选人姓名
            position_title: 岗位名称
            result: 面试结果
            interview_round: 面试轮次
            feedback: 面试反馈
            next_steps: 后续安排（通过时）
            company_name: 公司名称

        Returns:
            bool: 发送是否成功
        """
        # 根据结果设置不同的样式和文本
        result_styles = {
            InterviewResult.PASSED: {
                "header_gradient": "#28a745 0%, #20c997 100%",
                "result_title": "面试通过",
                "result_text": "恭喜您通过面试！",
                "result_bg_color": "#d4edda",
                "result_border_color": "#28a745",
                "result_text_color": "#155724",
                "is_passed": True
            },
            InterviewResult.HIRED: {
                "header_gradient": "#28a745 0%, #20c997 100%",
                "result_title": "录用通知",
                "result_text": "恭喜您已被录用！",
                "result_bg_color": "#d4edda",
                "result_border_color": "#28a745",
                "result_text_color": "#155724",
                "is_passed": True
            },
            InterviewResult.NEXT_ROUND: {
                "header_gradient": "#28a745 0%, #20c997 100%",
                "result_title": "通过此轮面试",
                "result_text": "恭喜您通过此轮面试，将进入下一轮！",
                "result_bg_color": "#d4edda",
                "result_border_color": "#28a745",
                "result_text_color": "#155724",
                "is_passed": True
            },
            InterviewResult.REJECTED: {
                "header_gradient": "#dc3545 0%, #c82333 100%",
                "result_title": "面试结果通知",
                "result_text": "很遗憾未通过本次面试",
                "result_bg_color": "#f8d7da",
                "result_border_color": "#dc3545",
                "result_text_color": "#721c24",
                "is_passed": False
            },
            InterviewResult.WAITLIST: {
                "header_gradient": "#ffc107 0%, #fd7e14 100%",
                "result_title": "面试结果通知",
                "result_text": "已进入备选名单",
                "result_bg_color": "#fff3cd",
                "result_border_color": "#ffc107",
                "result_text_color": "#856404",
                "is_passed": False
            },
            InterviewResult.PENDING: {
                "header_gradient": "#6c757d 0%, #495057 100%",
                "result_title": "面试结果通知",
                "result_text": "结果待定",
                "result_bg_color": "#e9ecef",
                "result_border_color": "#6c757d",
                "result_text_color": "#495057",
                "is_passed": False
            }
        }

        style = result_styles.get(result, result_styles[InterviewResult.PENDING])

        context = {
            "candidate_name": candidate_name,
            "position_title": position_title,
            "interview_round_text": f"第{interview_round}轮面试",
            "feedback": feedback,
            "next_steps": next_steps or "我们将在近期与您联系，请保持手机畅通。",
            "company_name": company_name,
            **style
        }

        html_content = self._render_template("result_notification.html", context)
        subject = f"面试结果通知 - {position_title}"

        return self._send_email(candidate_email, subject, html_content)

    def send_interview_invitation_for_interview(
        self,
        interview: Interview
    ) -> Dict[str, Any]:
        """
        为面试发送邀请邮件（从面试记录自动获取信息）

        Args:
            interview: 面试记录

        Returns:
            dict: 发送结果
        """
        result = {
            "success": False,
            "candidate_email_sent": False,
            "interviewer_emails_sent": [],
            "errors": []
        }

        # 获取候选人信息
        resume = self.db.query(Resume).filter(Resume.id == interview.resume_id).first()
        position = self.db.query(Position).filter(Position.id == interview.position_id).first()

        if not resume:
            result["errors"].append("未找到关联的简历记录")
            return result

        if not position:
            result["errors"].append("未找到关联的岗位记录")
            return result

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

        # 发送给候选人
        if resume.email:
            success = self.send_interview_invitation(
                interview=interview,
                candidate_email=resume.email,
                candidate_name=resume.candidate_name or "候选人",
                position_title=position.title,
                interview_time=interview.interview_time,
                interview_round=interview.round or 1,
                interview_type=interview_type_text,
                interview_location=interview_location,
                meeting_link=meeting_link,
                contact_person="HR",
                contact_phone="",
                company_name="公司"
            )
            result["candidate_email_sent"] = success
            if not success:
                result["errors"].append("候选人邮件发送失败")
        else:
            result["errors"].append("候选人邮箱为空")

        result["success"] = result["candidate_email_sent"]
        return result

    def send_result_notification_for_interview(
        self,
        interview: Interview,
        feedback: str = None,
        next_steps: str = None
    ) -> Dict[str, Any]:
        """
        为面试发送结果通知邮件

        Args:
            interview: 面试记录
            feedback: 面试反馈
            next_steps: 后续安排

        Returns:
            dict: 发送结果
        """
        result = {
            "success": False,
            "email_sent": False,
            "error": None
        }

        # 获取候选人信息
        resume = self.db.query(Resume).filter(Resume.id == interview.resume_id).first()
        position = self.db.query(Position).filter(Position.id == interview.position_id).first()

        if not resume:
            result["error"] = "未找到关联的简历记录"
            return result

        if not position:
            result["error"] = "未找到关联的岗位记录"
            return result

        if not resume.email:
            result["error"] = "候选人邮箱为空"
            return result

        success = self.send_result_notification(
            interview=interview,
            candidate_email=resume.email,
            candidate_name=resume.candidate_name or "候选人",
            position_title=position.title,
            result=interview.result,
            interview_round=interview.round or 1,
            feedback=feedback,
            next_steps=next_steps
        )

        result["email_sent"] = success
        result["success"] = success
        if not success:
            result["error"] = "邮件发送失败"

        return result

    def send_offer_email(
        self,
        offer,
        custom_message: str = None,
        company_name: str = "公司",
        confirm_url: str = None
    ) -> bool:
        """
        发送Offer邮件

        Args:
            offer: Offer记录
            custom_message: 自定义消息
            company_name: 公司名称
            confirm_url: 确认链接

        Returns:
            bool: 发送是否成功
        """
        onboard_date_str = offer.onboard_date.strftime('%Y年%m月%d日') if offer.onboard_date else "待定"
        valid_until_str = offer.valid_until.strftime('%Y年%m月%d日') if offer.valid_until else "长期有效"
        
        salary_display = ""
        if offer.salary_monthly:
            salary_display = f"月薪：{offer.salary_monthly:,.0f}元"
            if offer.salary_annual:
                salary_display += f"（年薪：{offer.salary_annual:,.0f}元）"
        elif offer.salary_annual:
            salary_display = f"年薪：{offer.salary_annual:,.0f}元"
        
        context = {
            "candidate_name": offer.candidate_name,
            "position_title": offer.position_title,
            "department": offer.department or "",
            "report_to": offer.report_to or "",
            "work_location": offer.work_location or "",
            "work_hours": offer.work_hours or "标准工时",
            "salary_display": salary_display,
            "salary_structure": offer.salary_structure or "",
            "onboard_date": onboard_date_str,
            "probation_months": offer.probation_months or 3,
            "benefits": offer.benefits or "按公司标准执行",
            "bonus": offer.bonus or "",
            "special_terms": offer.special_terms or "",
            "valid_until": valid_until_str,
            "custom_message": custom_message or "",
            "company_name": company_name,
            "confirm_url": confirm_url or ""
        }

        html_content = self._render_template("offer_email.html", context)
        subject = f"录用通知 - {offer.position_title}"

        return self._send_email(offer.candidate_email, subject, html_content)


def get_mail_service(db: Session) -> MailService:
    """获取邮件服务实例"""
    return MailService(db)