"""
测试配置文件
包含数据库测试配置、测试客户端 fixture、测试用户 fixture、Mock AI 服务
"""

import os
import sys
from typing import Generator
from uuid import uuid4
from datetime import datetime, timezone

# 设置测试环境变量，避免连接真实数据库 - 必须在导入 app 模块之前
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = "sqlite:///file:test_db?mode=memory&cache=shared&uri=true"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session

# 确保可以导入 app 模块
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.models import (
    Base, User, UserRole, Position, PositionStatus, PositionUrgency, PositionType,
    Resume, ResumeStatus, ScreeningResult, Interview, InterviewStatus, InterviewResult,
    InterviewPanel, DepartmentReview, SystemConfig, CodingTest, CodingSubmission
)
from app.config.database import get_db
from app.core.security import get_password_hash, create_access_token


# 使用共享内存 SQLite 数据库进行测试
# 这样所有连接都使用同一个内存数据库
SQLALCHEMY_DATABASE_URL = "sqlite:///file:test_db?mode=memory&cache=shared&uri=true"

# 创建测试引擎
test_engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=None  # 使用默认连接池
)

# 创建测试会话工厂
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(scope="function")
def db() -> Generator[Session, None, None]:
    """
    创建测试数据库会话
    每个测试函数创建新表，测试后删除
    注意：SQLite 不支持 ARRAY 类型，所以只创建面试相关的表
    """
    # 只创建面试测试需要的表（排除使用 ARRAY 类型的 QuestionBank）
    tables_to_create = [
        User.__table__,
        Position.__table__,
        Resume.__table__,
        Interview.__table__,
        InterviewPanel.__table__,
        DepartmentReview.__table__,
        SystemConfig.__table__,
        CodingTest.__table__,
        CodingSubmission.__table__,
    ]

    for table in tables_to_create:
        table.create(bind=test_engine, checkfirst=True)

    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        # 测试后删除所有表
        for table in reversed(tables_to_create):
            table.drop(bind=test_engine, checkfirst=True)


@pytest.fixture(scope="function")
def client(db: Session) -> Generator[TestClient, None, None]:
    """
    创建测试客户端
    覆盖 get_db 依赖，使用测试数据库
    """
    from fastapi import FastAPI
    from app.routes import auth, positions, resumes, interviews, coding_tests, settings

    # 创建测试应用（不导入 question_banks 路由，因为它使用了 ARRAY 类型）
    test_app = FastAPI()

    # 注册路由 - 与 main.py 保持一致，路由本身已有 prefix
    test_app.include_router(auth.router, prefix="/api")
    test_app.include_router(positions.router, prefix="/api")
    test_app.include_router(resumes.router, prefix="/api")
    test_app.include_router(interviews.router, prefix="/api")
    test_app.include_router(coding_tests.router, prefix="/api")
    test_app.include_router(settings.router, prefix="/api")

    # 正确覆盖 get_db 依赖
    def override_get_db():
        try:
            yield db
        finally:
            pass

    # 使用 dependency_overrides 正确覆盖
    from app.config.database import get_db as original_get_db
    test_app.dependency_overrides[original_get_db] = override_get_db

    with TestClient(test_app) as c:
        yield c

    test_app.dependency_overrides.clear()


@pytest.fixture
def test_user(db: Session) -> User:
    """
    创建测试用户（HR 角色）
    """
    user = User(
        id=uuid4(),
        email="test_hr@example.com",
        hashed_password=get_password_hash("testpassword"),
        full_name="测试HR",
        role=UserRole.HR,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def test_admin(db: Session) -> User:
    """
    创建测试管理员用户
    """
    user = User(
        id=uuid4(),
        email="test_admin@example.com",
        hashed_password=get_password_hash("testpassword"),
        full_name="测试管理员",
        role=UserRole.ADMIN,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def test_interviewer(db: Session) -> User:
    """
    创建测试面试官用户
    """
    user = User(
        id=uuid4(),
        email="test_interviewer@example.com",
        hashed_password=get_password_hash("testpassword"),
        full_name="测试面试官",
        role=UserRole.INTERVIEWER,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def test_position(db: Session) -> Position:
    """
    创建测试岗位
    """
    position = Position(
        id=uuid4(),
        title="高级Python工程师",
        description="负责后端系统开发和维护",
        requirements="5年以上Python开发经验，熟悉FastAPI",
        salary_range="25k-40k",
        location="北京",
        department="技术部",
        status=PositionStatus.OPEN,
        urgency=PositionUrgency.HIGH,
        position_type=PositionType.FULL_TIME,
        headcount=2
    )
    db.add(position)
    db.commit()
    db.refresh(position)
    return position


@pytest.fixture
def test_resume(db: Session, test_position: Position) -> Resume:
    """
    创建测试简历
    """
    resume = Resume(
        id=uuid4(),
        candidate_name="张三",
        contact="13800138000",
        email="zhangsan@example.com",
        position_id=test_position.id,
        file_path="/uploads/test_resume.pdf",
        raw_text="张三的简历内容...",
        status=ResumeStatus.PENDING_INTERVIEW,
        screening_result=ScreeningResult.PASSED
    )
    db.add(resume)
    db.commit()
    db.refresh(resume)
    return resume


@pytest.fixture
def test_interview(db: Session, test_resume: Resume, test_position: Position, test_interviewer: User) -> Interview:
    """
    创建测试面试记录
    """
    interview = Interview(
        id=uuid4(),
        resume_id=test_resume.id,
        position_id=test_position.id,
        interviewer="主面试官",
        interview_time=datetime(2024, 12, 1, 10, 0, tzinfo=timezone.utc),
        questions=[
            {"title": "自我介绍", "content": "请介绍一下你自己", "reference_answer": "..."},
            {"title": "技术问题", "content": "请解释Python的GIL", "reference_answer": "..."}
        ],
        status=InterviewStatus.SCHEDULED,
        result=InterviewResult.PENDING,
        panel_members=[str(test_interviewer.id)]
    )
    db.add(interview)
    db.commit()
    db.refresh(interview)
    return interview


@pytest.fixture
def test_interview_in_progress(db: Session, test_resume: Resume, test_position: Position, test_interviewer: User) -> Interview:
    """
    创建进行中的测试面试记录
    """
    interview = Interview(
        id=uuid4(),
        resume_id=test_resume.id,
        position_id=test_position.id,
        interviewer="主面试官",
        interview_time=datetime(2024, 12, 1, 10, 0, tzinfo=timezone.utc),
        questions=[
            {"title": "自我介绍", "content": "请介绍一下你自己", "reference_answer": "..."},
            {"title": "技术问题", "content": "请解释Python的GIL", "reference_answer": "..."}
        ],
        status=InterviewStatus.IN_PROGRESS,
        result=InterviewResult.PENDING,
        panel_members=[str(test_interviewer.id)]
    )
    db.add(interview)
    db.commit()
    db.refresh(interview)
    return interview


@pytest.fixture
def test_interview_panel(db: Session, test_interview: Interview, test_interviewer: User) -> InterviewPanel:
    """
    创建测试面试面板记录
    """
    panel = InterviewPanel(
        id=uuid4(),
        interview_id=test_interview.id,
        interviewer_id=test_interviewer.id,
        scores={},
        comments={},
        is_submitted=False
    )
    db.add(panel)
    db.commit()
    db.refresh(panel)
    return panel


@pytest.fixture
def auth_headers(test_user: User) -> dict:
    """
    生成HR认证请求头
    """
    access_token = create_access_token(data={"sub": test_user.email})
    return {"Authorization": f"Bearer {access_token}"}


@pytest.fixture
def admin_auth_headers(test_admin: User, db: Session) -> dict:
    """
    生成管理员认证请求头
    注意：需要确保 admin 用户在数据库中
    """
    # 确保 admin 用户存在
    existing = db.query(User).filter(User.email == test_admin.email).first()
    if not existing:
        db.add(test_admin)
        db.commit()
    access_token = create_access_token(data={"sub": test_admin.email})
    return {"Authorization": f"Bearer {access_token}"}


@pytest.fixture
def interviewer_auth_headers(test_interviewer: User) -> dict:
    """
    生成面试官认证请求头
    """
    access_token = create_access_token(data={"sub": test_interviewer.email})
    return {"Authorization": f"Bearer {access_token}"}


# ============= Mock 服务 =============

@pytest.fixture
def mock_ai_service(monkeypatch):
    """
    Mock AI 服务，避免实际调用 LLM API
    """
    def mock_generate_questions(*args, **kwargs):
        return [
            {"title": "测试问题1", "content": "问题内容1", "reference_answer": "参考答案1"},
            {"title": "测试问题2", "content": "问题内容2", "reference_answer": "参考答案2"}
        ]

    def mock_generate_evaluation(*args, **kwargs):
        return {
            "evaluation": "候选人表现良好，建议录用。",
            "suggestion": "建议加强技术深度。"
        }

    monkeypatch.setattr(
        "app.services.interview_service.generate_interview_questions",
        mock_generate_questions
    )
    monkeypatch.setattr(
        "app.services.interview_service.generate_interview_evaluation",
        mock_generate_evaluation
    )


class MockBackgroundTasks:
    """
    Mock BackgroundTasks，用于测试中收集后台任务而不实际执行
    """
    def __init__(self):
        self.tasks = []

    def add_task(self, func, *args, **kwargs):
        """记录任务但不执行"""
        self.tasks.append((func, args, kwargs))


@pytest.fixture
def mock_background_tasks():
    """
    创建 Mock BackgroundTasks 实例
    """
    return MockBackgroundTasks()


@pytest.fixture(autouse=True)
def mock_email_service(monkeypatch):
    """
    自动 mock 邮件服务，避免在测试中发送真实邮件
    """
    # Mock send_interview_invitation_background
    def mock_send_invitation(*args, **kwargs):
        pass

    # Mock send_result_notification_background
    def mock_send_result_notification(*args, **kwargs):
        pass

    # Mock get_mail_service
    class MockMailService:
        def send_interview_invitation(self, *args, **kwargs):
            pass
        def send_interview_result_notification(self, *args, **kwargs):
            pass

    def mock_get_mail_service():
        return MockMailService()

    try:
        monkeypatch.setattr(
            "app.services.interview_service.send_interview_invitation_background",
            mock_send_invitation
        )
    except (AttributeError, ImportError):
        pass

    try:
        monkeypatch.setattr(
            "app.services.interview_service.send_result_notification_background",
            mock_send_result_notification
        )
    except (AttributeError, ImportError):
        pass

    try:
        monkeypatch.setattr(
            "app.services.mail_service.get_mail_service",
            mock_get_mail_service
        )
    except (AttributeError, ImportError):
        pass