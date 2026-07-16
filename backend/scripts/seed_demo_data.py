"""Seed demo recruiting data for product screenshots.

The script is idempotent for records that start with the Demo marker and does
not touch user-created production-like data.
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config.database import SessionLocal, engine
from app.models.base import Base
from app.core.security import get_password_hash
from app.models.models import (
    CodingSubmission,
    CodingSubmissionStatus,
    CodingTest,
    CodingTestStatus,
    DepartmentReview,
    Interview,
    InterviewPanel,
    InterviewResult,
    InterviewStatus,
    Offer,
    OfferStatus,
    Position,
    PositionStatus,
    PositionType,
    PositionUrgency,
    QuestionBank,
    QuestionCategory,
    QuestionDifficulty,
    Resume,
    ResumeStatus,
    ScreeningResult,
    SystemConfig,
    User,
    UserRole,
)
from app.models.workflow_models import Workflow, WorkflowStatus


DEMO_EMAIL_DOMAIN = "talent.example"
DEMO_USER_DOMAIN = "demo.ai-interview.local"


def utc_days_ago(days: int, hour: int = 10) -> datetime:
    now = datetime.now(timezone.utc)
    return (now - timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)


def cleanup_demo_data(db) -> None:
    demo_resumes = db.query(Resume).filter(Resume.email.like(f"demo.%@{DEMO_EMAIL_DOMAIN}")).all()
    demo_resume_ids = [r.id for r in demo_resumes]
    demo_positions = db.query(Position).filter(Position.title.like("Demo %")).all()
    demo_position_ids = [p.id for p in demo_positions]
    demo_tests = db.query(CodingTest).filter(CodingTest.title.like("Demo %")).all()
    demo_test_ids = [t.id for t in demo_tests]
    demo_workflows = db.query(Workflow).filter(Workflow.name.like("Demo %")).all()
    demo_users = db.query(User).filter(User.email.like(f"demo.%@{DEMO_USER_DOMAIN}")).all()

    if demo_test_ids:
        db.query(CodingSubmission).filter(CodingSubmission.coding_test_id.in_(demo_test_ids)).delete(synchronize_session=False)
        db.query(CodingTest).filter(CodingTest.id.in_(demo_test_ids)).delete(synchronize_session=False)
    if demo_resume_ids:
        db.query(Offer).filter(Offer.resume_id.in_(demo_resume_ids)).delete(synchronize_session=False)
        db.query(InterviewPanel).filter(InterviewPanel.interview_id.in_(
            db.query(Interview.id).filter(Interview.resume_id.in_(demo_resume_ids))
        )).delete(synchronize_session=False)
        db.query(Interview).filter(Interview.resume_id.in_(demo_resume_ids)).delete(synchronize_session=False)
        db.query(DepartmentReview).filter(DepartmentReview.resume_id.in_(demo_resume_ids)).delete(synchronize_session=False)
        db.query(Resume).filter(Resume.id.in_(demo_resume_ids)).delete(synchronize_session=False)
    db.query(QuestionBank).filter(QuestionBank.name.like("Demo %")).delete(synchronize_session=False)
    if demo_workflows:
        db.query(Workflow).filter(Workflow.id.in_([w.id for w in demo_workflows])).delete(synchronize_session=False)
    if demo_position_ids:
        db.query(Position).filter(Position.id.in_(demo_position_ids)).delete(synchronize_session=False)
    if demo_users:
        db.query(User).filter(User.id.in_([u.id for u in demo_users])).delete(synchronize_session=False)
    db.commit()


def get_or_create_admin(db) -> User:
    email = os.getenv("INITIAL_ADMIN_EMAIL", "admin@example.com")
    admin = db.query(User).filter(User.email == email).first()
    if admin:
        return admin

    admin = User(
        email=email,
        hashed_password=get_password_hash(os.getenv("INITIAL_ADMIN_PASSWORD", "admin123")),
        full_name=os.getenv("INITIAL_ADMIN_NAME", "System Admin"),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def seed_users(db) -> dict[str, User]:
    users = {
        "hr": User(
            email=f"demo.hr@{DEMO_USER_DOMAIN}",
            hashed_password=get_password_hash("Demo123456"),
            full_name="Demo HR Lead",
            role=UserRole.HR,
            is_active=True,
        ),
        "tech": User(
            email=f"demo.tech@{DEMO_USER_DOMAIN}",
            hashed_password=get_password_hash("Demo123456"),
            full_name="林一舟 技术面试官",
            role=UserRole.INTERVIEWER,
            is_active=True,
        ),
        "manager": User(
            email=f"demo.manager@{DEMO_USER_DOMAIN}",
            hashed_password=get_password_hash("Demo123456"),
            full_name="陈若宁 用人经理",
            role=UserRole.INTERVIEWER,
            is_active=True,
        ),
    }
    db.add_all(users.values())
    db.commit()
    for user in users.values():
        db.refresh(user)
    return users


def seed_positions(db, users: dict[str, User]) -> list[Position]:
    positions = [
        Position(
            title="Demo AI 平台后端工程师",
            description="负责招聘智能体、简历解析服务、异步任务和模型网关的后端架构。",
            requirements="熟悉 Python、FastAPI、PostgreSQL、消息队列和 LLM 应用工程化。",
            salary_range="35k-55k",
            location="上海 / 远程",
            department="AI 平台部",
            status=PositionStatus.PUBLISHED,
            urgency=PositionUrgency.URGENT,
            position_type=PositionType.FULL_TIME,
            headcount=3,
            hiring_manager_id=users["manager"].id,
            created_at=utc_days_ago(18),
        ),
        Position(
            title="Demo 增长产品经理",
            description="负责招聘 SaaS 的产品增长、招聘漏斗分析和商业化实验。",
            requirements="具备 B 端产品经验，熟悉数据分析、用户研究和增长实验设计。",
            salary_range="28k-45k",
            location="北京",
            department="产品增长部",
            status=PositionStatus.OPEN,
            urgency=PositionUrgency.HIGH,
            position_type=PositionType.FULL_TIME,
            headcount=2,
            hiring_manager_id=users["manager"].id,
            created_at=utc_days_ago(14),
        ),
        Position(
            title="Demo 前端体验工程师",
            description="负责招聘工作台、候选人公开页面和工作流编排体验。",
            requirements="熟悉 React、TypeScript、可视化编辑器和复杂表单体验。",
            salary_range="30k-48k",
            location="深圳",
            department="体验工程部",
            status=PositionStatus.PUBLISHED,
            urgency=PositionUrgency.MEDIUM,
            position_type=PositionType.FULL_TIME,
            headcount=2,
            hiring_manager_id=users["tech"].id,
            created_at=utc_days_ago(10),
        ),
        Position(
            title="Demo 数据分析实习生",
            description="支持招聘数据看板、渠道效果分析和候选人质量追踪。",
            requirements="熟悉 SQL、Excel 或 Python，能将分析结论转化为业务建议。",
            salary_range="200-300/天",
            location="杭州",
            department="人才运营部",
            status=PositionStatus.OPEN,
            urgency=PositionUrgency.LOW,
            position_type=PositionType.INTERNSHIP,
            headcount=4,
            hiring_manager_id=users["hr"].id,
            created_at=utc_days_ago(6),
        ),
    ]
    db.add_all(positions)
    db.commit()
    for position in positions:
        db.refresh(position)
    return positions


def seed_question_banks(db, positions: list[Position]) -> list[QuestionBank]:
    banks = [
        QuestionBank(
            name="Demo 后端架构题库",
            category=QuestionCategory.TECHNICAL,
            difficulty=QuestionDifficulty.SENIOR,
            tags=["FastAPI", "PostgreSQL", "LLM", "系统设计"],
            questions=[
                {"title": "异步解析队列", "content": "如何设计一个高可靠的简历解析异步队列？"},
                {"title": "模型网关", "content": "如何封装多模型供应商的统一调用接口？"},
                {"title": "数据一致性", "content": "招聘状态流转中如何保证事务一致性？"},
            ],
            position_id=positions[0].id,
            created_at=utc_days_ago(15),
        ),
        QuestionBank(
            name="Demo 产品增长题库",
            category=QuestionCategory.MANAGEMENT,
            difficulty=QuestionDifficulty.INTERMEDIATE,
            tags=["增长", "漏斗", "SaaS", "实验"],
            questions=[
                {"title": "漏斗诊断", "content": "招聘漏斗从简历到 Offer 的转化下降，你会如何定位？"},
                {"title": "功能优先级", "content": "如何决定 AI 面试评价和渠道分析的优先级？"},
            ],
            position_id=positions[1].id,
            created_at=utc_days_ago(9),
        ),
    ]
    db.add_all(banks)
    db.commit()
    for bank in banks:
        db.refresh(bank)
    return banks


def build_ai_review(name: str, position_title: str, score: int, summary: str) -> str:
    risk_level = "低" if score >= 85 else "中" if score >= 70 else "高"
    return f"""### AI 匹配结论

候选人 **{name}** 与「{position_title}」的综合匹配度为 **{score}/100**。{summary}

### 关键匹配点

- 核心经历与岗位职责有直接对应，能够支撑第一阶段快速上手。
- 技能栈覆盖岗位要求中的关键能力，并有可追问的项目证据。
- 过往项目中体现出跨团队沟通、复杂问题拆解和结果交付能力。

### 风险与追问

- 风险等级：**{risk_level}**
- 建议面试重点追问最近项目的真实职责边界、技术决策依据和指标结果。
- 可结合岗位业务场景设计 1 道系统设计题和 1 道协作复盘题。

### AI 建议

建议进入下一阶段，并由用人部门重点确认候选人的业务理解深度与长期稳定性。
"""


def seed_resumes(db, positions: list[Position]) -> list[Resume]:
    candidates = [
        ("demo.liuyue", "刘悦", positions[0], ResumeStatus.PENDING_SCREENING, 92, "资深后端工程师，主导过千万级招聘平台和 LLM 网关建设。", 1),
        ("demo.wangchen", "王辰", positions[0], ResumeStatus.PENDING_INTERVIEW, 86, "熟悉 FastAPI、任务队列和模型应用评测，近期负责企业知识库。", 2),
        ("demo.zhaomin", "赵敏", positions[0], ResumeStatus.INTERVIEW_PASSED, 81, "后端经验扎实，具备多云部署和可观测性建设经历。", 5),
        ("demo.suyun", "苏芸", positions[1], ResumeStatus.PENDING_DEPT_REVIEW, 88, "B 端产品经理，擅长增长实验、漏斗分析和商业化策略。", 3),
        ("demo.qiaoran", "乔然", positions[1], ResumeStatus.OFFER_PENDING, 84, "做过 ATS 和 CRM 增长产品，能独立推进复杂跨部门项目。", 8),
        ("demo.hexi", "何夕", positions[1], ResumeStatus.REJECTED, 58, "产品经验偏内容社区，与当前 B 端增长岗位匹配度一般。", 12),
        ("demo.linzhi", "林知", positions[2], ResumeStatus.PENDING_INTERVIEW, 90, "React 和可视化编辑器经验丰富，做过流程编排产品。", 1),
        ("demo.yanmo", "严墨", positions[2], ResumeStatus.INTERVIEW_FAILED, 64, "前端基础尚可，但复杂状态管理和工程化经验不足。", 11),
        ("demo.tangqing", "唐青", positions[2], ResumeStatus.OFFER_ACCEPTED, 93, "候选人具备设计系统和低代码平台经验，已接受 Offer。", 17),
        ("demo.fangning", "方宁", positions[3], ResumeStatus.PENDING_SCREENING, 76, "数据分析实习候选人，SQL 基础良好，有招聘分析项目经历。", 2),
        ("demo.xujiayi", "徐嘉仪", positions[3], ResumeStatus.COMPLETED, 82, "数据分析能力扎实，已确认入职实习。", 21),
        ("demo.mengfan", "孟凡", positions[3], ResumeStatus.WAITLIST, 70, "统计背景较好，业务表达仍需观察。", 6),
    ]
    resumes: list[Resume] = []
    for slug, name, position, status, score, review, days in candidates:
        resume = Resume(
            candidate_name=name,
            contact=f"13{abs(hash(slug)) % 1000000000:09d}",
            email=f"{slug}@{DEMO_EMAIL_DOMAIN}",
            position_id=position.id,
            file_path=f"/uploads/demo/{slug}.pdf",
            raw_text=f"{name} 的演示简历文本，包含项目经历、技能栈和求职意向。",
            resume_markdown=f"## {name}\n\n- 应聘岗位：{position.title}\n- 匹配亮点：{review}",
            parsed_data={
                "skills": ["Python", "React", "SQL", "LLM"],
                "highest_degree": "本科",
                "school": "上海交通大学",
                "major": "计算机科学与技术",
                "years_of_experience": 6,
                "recent_company": "星河智能科技",
                "education": "本科",
            },
            match_score=score,
            parse_status="completed",
            parsed_at=utc_days_ago(days, 12),
            screening_result=ScreeningResult.PASSED if score >= 70 else ScreeningResult.REJECTED,
            ai_review=build_ai_review(name, position.title, score, review),
            status=status,
            stage="hired" if status in [ResumeStatus.OFFER_ACCEPTED, ResumeStatus.COMPLETED] else "interview",
            other_position_matches=[
                {
                    "position_id": str(positions[2].id),
                    "position_title": positions[2].title,
                    "match_score": 83,
                    "is_better_match": False,
                    "reason": "候选人具备前后端协作经验，可作为体验工程岗位备选。"
                },
                {
                    "position_id": str(positions[1].id),
                    "position_title": positions[1].title,
                    "match_score": 72,
                    "is_better_match": False,
                    "reason": "有平台产品协作经验，但增长方法论需要进一步确认。"
                }
            ] if slug in {"demo.liuyue", "demo.wangchen"} else None,
            created_at=utc_days_ago(days, 9),
        )
        resumes.append(resume)

    db.add_all(resumes)
    db.commit()
    for resume in resumes:
        db.refresh(resume)
    return resumes


def seed_reviews_and_interviews(db, users: dict[str, User], resumes: list[Resume]) -> list[Interview]:
    reviews = [
        DepartmentReview(
            resume_id=resumes[3].id,
            reviewer_id=users["manager"].id,
            technical_score=8,
            experience_score=9,
            overall_score=9,
            recommendation="recommend",
            comment="增长方法论成熟，适合进入业务终面。",
            is_completed=True,
            created_at=utc_days_ago(2),
        )
    ]

    interview_specs = [
        (resumes[1], InterviewStatus.SCHEDULED, InterviewResult.PENDING, 1, 0, 0, "technical"),
        (resumes[2], InterviewStatus.COMPLETED, InterviewResult.PASSED, 1, 4, 86, "technical"),
        (resumes[4], InterviewStatus.COMPLETED, InterviewResult.PASSED, 2, 6, 88, "manager"),
        (resumes[6], InterviewStatus.SCHEDULED, InterviewResult.PENDING, 1, 0, 0, "technical"),
        (resumes[7], InterviewStatus.COMPLETED, InterviewResult.REJECTED, 1, 10, 62, "technical"),
        (resumes[8], InterviewStatus.COMPLETED, InterviewResult.HIRED, 2, 14, 92, "comprehensive"),
        (resumes[10], InterviewStatus.COMPLETED, InterviewResult.HIRED, 1, 19, 84, "hr"),
    ]

    interviews: list[Interview] = []
    for resume, status, result, round_no, days, score, category in interview_specs:
        interview_time = datetime.now(timezone.utc).replace(hour=15, minute=0, second=0, microsecond=0) if status == InterviewStatus.SCHEDULED else utc_days_ago(days, 15)
        interview = Interview(
            resume_id=resume.id,
            position_id=resume.position_id,
            interviewer_id=users["tech"].id,
            interviewer=users["tech"].full_name,
            round=round_no,
            interview_time=interview_time,
            started_at=interview_time if status == InterviewStatus.COMPLETED else None,
            interview_type="video" if category == "technical" else "onsite",
            interview_category=category,
            interview_location="上海总部 12F / 腾讯会议",
            meeting_link="https://meeting.tencent.com/demo-ai-interview",
            questions=[
                {"title": "项目深挖", "content": "请介绍最近一个复杂项目的架构设计。", "score": 10},
                {"title": "问题解决", "content": "如果 AI 简历解析失败率升高，你会如何定位？", "score": 10},
                {"title": "协作方式", "content": "如何推动跨部门招聘流程改造？", "score": 10},
            ],
            scores={"0": 9, "1": 8, "2": 9} if score else {},
            comments={"summary": "候选人表达清晰，业务理解和落地能力较强。"} if score else {},
            total_score=score or None,
            panel_members=[str(users["tech"].id), str(users["manager"].id)],
            transcripts={"summary": "候选人重点介绍了招聘系统、异步任务和模型评测经验。"} if score else {},
            result=result,
            evaluation=(
                """## AI 综合面试分析

候选人在项目拆解、系统设计和沟通表达上表现稳定，能够把业务目标、技术方案和交付风险连接起来说明。

### 优势

- 对招聘系统、异步任务、模型调用链路有完整理解。
- 回答中能主动说明权衡，例如准确率、成本、延迟和数据隐私。
- 面试官追问时能补充具体指标和复盘动作。

### 需要继续确认

- 大规模团队协作下的 owner 意识和推进节奏。
- 对模型输出不稳定、提示词漂移和人工兜底策略的实战经验。

### AI 建议

建议进入下一轮或发起 Offer 前的业务终面，重点确认团队匹配度和入职预期。
"""
                if score and score >= 80 else
                """## AI 综合面试分析

候选人基础能力可覆盖部分岗位要求，但在复杂系统拆解、边界条件和方案取舍上的表达不够充分。

### 主要风险

- 回答偏概念化，缺少可验证的项目数据。
- 对招聘业务场景理解较浅，无法给出完整落地路径。

### AI 建议

建议暂缓推进，可保留在备选池中观察后续岗位机会。
"""
            ),
            suggestion="passed" if result in [InterviewResult.PASSED, InterviewResult.HIRED] else "waitlist",
            status=status,
            created_at=utc_days_ago(days, 11) if days else datetime.now(timezone.utc),
        )
        interviews.append(interview)

    db.add_all(reviews + interviews)
    db.commit()
    for interview in interviews:
        db.refresh(interview)

    panels = []
    for interview in interviews:
        if interview.status == InterviewStatus.COMPLETED:
            panels.append(
                InterviewPanel(
                    interview_id=interview.id,
                    interviewer_id=users["tech"].id,
                    scores={"0": 9, "1": 8, "2": 9},
                    comments={"summary": "技术判断扎实，沟通顺畅。"},
                    total_score=interview.total_score,
                    is_submitted=True,
                )
            )
    db.add_all(panels)
    db.commit()
    return interviews


def seed_offers_and_tests(db, admin: User, resumes: list[Resume], positions: list[Position], banks: list[QuestionBank]) -> None:
    offers = [
        Offer(
            resume_id=resumes[4].id,
            position_id=resumes[4].position_id,
            candidate_name=resumes[4].candidate_name,
            candidate_email=resumes[4].email,
            salary_monthly=42000,
            salary_annual=650000,
            salary_structure="14 薪 + 绩效奖金",
            position_title=positions[1].title,
            department=positions[1].department,
            report_to="增长负责人",
            work_location=positions[1].location,
            onboard_date=utc_days_ago(-14),
            probation_months=3,
            benefits="补充医疗、年度体检、弹性办公",
            valid_until=utc_days_ago(-5),
            status=OfferStatus.SENT,
            sent_at=utc_days_ago(1),
            token=uuid.uuid4().hex,
            created_by=admin.id,
        ),
        Offer(
            resume_id=resumes[8].id,
            position_id=resumes[8].position_id,
            candidate_name=resumes[8].candidate_name,
            candidate_email=resumes[8].email,
            salary_monthly=46000,
            salary_annual=720000,
            salary_structure="15 薪 + 项目奖金",
            position_title=positions[2].title,
            department=positions[2].department,
            report_to="体验工程负责人",
            work_location=positions[2].location,
            onboard_date=utc_days_ago(-7),
            probation_months=3,
            benefits="远程办公、设备预算、学习基金",
            valid_until=utc_days_ago(-3),
            status=OfferStatus.ACCEPTED,
            sent_at=utc_days_ago(9),
            accepted_at=utc_days_ago(7),
            token=uuid.uuid4().hex,
            created_by=admin.id,
        ),
        Offer(
            resume_id=resumes[10].id,
            position_id=resumes[10].position_id,
            candidate_name=resumes[10].candidate_name,
            candidate_email=resumes[10].email,
            salary_monthly=8000,
            salary_annual=96000,
            salary_structure="实习津贴",
            position_title=positions[3].title,
            department=positions[3].department,
            report_to="人才运营负责人",
            work_location=positions[3].location,
            onboard_date=utc_days_ago(-2),
            probation_months=0,
            benefits="实习转正通道、导师制",
            valid_until=utc_days_ago(-1),
            status=OfferStatus.ACCEPTED,
            sent_at=utc_days_ago(5),
            accepted_at=utc_days_ago(4),
            token=uuid.uuid4().hex,
            created_by=admin.id,
        ),
    ]

    tests = [
        CodingTest(
            title="Demo 后端工程师在线笔试",
            description="验证候选人的算法基础、接口设计和工程化思路。",
            test_type="algorithm",
            difficulty="senior",
            language="python",
            starter_code="def normalize_resume_events(events):\n    # TODO: implement\n    return []\n",
            test_cases=[
                {"input": [["applied", "screened", "interviewed"]], "expected": ["applied", "screened", "interviewed"]},
            ],
            public_token=uuid.uuid4().hex,
            status=CodingTestStatus.PUBLISHED,
            question_bank_id=banks[0].id,
            questions=[
                {"id": "q1", "question": "实现一个招聘事件去重并按时间排序的函数。", "max_score": 60},
                {"id": "q2", "question": "描述如何为代码运行服务做沙箱隔离。", "max_score": 40},
            ],
            duration_minutes=90,
            created_by=admin.id,
            resume_id=resumes[1].id,
            position_id=positions[0].id,
            created_at=utc_days_ago(3),
        ),
        CodingTest(
            title="Demo 产品经理案例题",
            description="围绕招聘漏斗下滑设计分析框架和实验方案。",
            test_type="essay",
            difficulty="intermediate",
            language="text",
            public_token=uuid.uuid4().hex,
            status=CodingTestStatus.PUBLISHED,
            question_bank_id=banks[1].id,
            questions=[
                {"id": "case-1", "question": "某岗位简历到面试转化率下降 30%，请给出分析路径。", "max_score": 100},
            ],
            duration_minutes=60,
            created_by=admin.id,
            resume_id=resumes[3].id,
            position_id=positions[1].id,
            created_at=utc_days_ago(4),
        ),
    ]
    db.add_all(offers + tests)
    db.commit()
    for test in tests:
        db.refresh(test)

    submissions = [
        CodingSubmission(
            coding_test_id=tests[0].id,
            candidate_name=resumes[1].candidate_name,
            candidate_email=resumes[1].email,
            language="python",
            code="def normalize_resume_events(events):\n    return sorted(set(events))\n",
            run_result={"passed": True, "results": [{"case": 1, "passed": True}]},
            passed=True,
            score=88,
            ai_evaluation="代码简洁，边界条件处理仍可补充。",
            status=CodingSubmissionStatus.EVALUATED,
            submitted_at=utc_days_ago(1, 20),
            evaluated_at=utc_days_ago(1, 21),
        ),
        CodingSubmission(
            coding_test_id=tests[1].id,
            candidate_name=resumes[3].candidate_name,
            candidate_email=resumes[3].email,
            language="text",
            answers=[{"question_id": "case-1", "answer": "从渠道、JD、筛选标准、面试容量和候选人画像五个维度排查。"}],
            passed=True,
            score=91,
            ai_evaluation="结构完整，能将数据分析与业务动作连接起来。",
            status=CodingSubmissionStatus.EVALUATED,
            submitted_at=utc_days_ago(2, 18),
            evaluated_at=utc_days_ago(2, 19),
        ),
    ]
    db.add_all(submissions)
    db.commit()


def seed_workflows_and_config(db) -> None:
    workflow = Workflow(
        name="Demo 高匹配候选人自动推进",
        description="当候选人匹配分高于 85 时，自动进入部门评审并通知 HR。",
        status=WorkflowStatus.PUBLISHED,
        trigger_type="manual",
        is_template=False,
        is_system=False,
        graph={
            "nodes": [
                {"id": "start", "type": "start", "position": {"x": 80, "y": 160}, "data": {"label": "新简历"}},
                {"id": "condition", "type": "condition", "position": {"x": 320, "y": 160}, "data": {"label": "匹配分 >= 85"}},
                {"id": "review", "type": "tool", "position": {"x": 560, "y": 100}, "data": {"label": "创建部门评审"}},
                {"id": "mail", "type": "email", "position": {"x": 800, "y": 100}, "data": {"label": "通知 HR"}},
                {"id": "end", "type": "end", "position": {"x": 1040, "y": 160}, "data": {"label": "完成"}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "condition"},
                {"id": "e2", "source": "condition", "target": "review", "sourceHandle": "yes"},
                {"id": "e3", "source": "review", "target": "mail"},
                {"id": "e4", "source": "mail", "target": "end"},
            ],
        },
        variables={"threshold": 85, "owner": "HRBP"},
        created_at=utc_days_ago(5),
    )

    config = db.query(SystemConfig).first()
    if not config:
        config = SystemConfig()
        db.add(config)
    config.frontend_url = "http://localhost:5173"
    config.mail_enabled = False
    config.llm_provider = config.llm_provider or "dashscope"
    config.llm_base_url = config.llm_base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    config.llm_model = config.llm_model or "qwen3.5-plus"
    db.add(workflow)
    db.commit()


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        cleanup_demo_data(db)
        admin = get_or_create_admin(db)
        users = seed_users(db)
        positions = seed_positions(db, users)
        banks = seed_question_banks(db, positions)
        resumes = seed_resumes(db, positions)
        seed_reviews_and_interviews(db, users, resumes)
        seed_offers_and_tests(db, admin, resumes, positions, banks)
        seed_workflows_and_config(db)
        print("Seeded demo data for AI Interview screenshots.")
        print("Demo admin:", admin.email)
        print("Demo interviewers:", ", ".join(user.email for user in users.values()))
    finally:
        db.close()


if __name__ == "__main__":
    main()
