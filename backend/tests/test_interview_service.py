"""
面试服务单元测试
测试 create_interview, get_interviews, get_interview, update_interview, delete_interview,
start_interview, cancel_interview, submit_interview_panel_score, aggregate_panel_scores, get_submission_status
"""

import pytest
from uuid import uuid4, UUID
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

from sqlalchemy.orm import Session
from fastapi import HTTPException, BackgroundTasks

from app.models.models import (
    Interview, InterviewStatus, InterviewResult, InterviewPanel,
    Resume, ResumeStatus, ScreeningResult, User, UserRole, Position
)
from app.schemas.interview import InterviewCreate, InterviewUpdate, InterviewScore
from app.services import interview_service


class TestCreateInterview:
    """测试创建面试功能"""

    def test_create_interview_success(self, db: Session, test_resume: Resume, test_position: Position, mock_background_tasks):
        """测试成功创建面试"""
        interview_data = InterviewCreate(
            resume_id=test_resume.id,
            position_id=test_position.id,
            interviewer="主面试官",
            interview_time=datetime(2024, 12, 15, 10, 0, tzinfo=timezone.utc),
            panel_members=[]
        )

        result = interview_service.create_interview(db, interview_data, mock_background_tasks)

        assert result is not None
        assert result.resume_id == test_resume.id
        assert result.position_id == test_position.id
        assert result.status == InterviewStatus.SCHEDULED
        assert result.result == InterviewResult.PENDING
        assert result.questions is None
        assert len(mock_background_tasks.tasks) >= 1  # 背景任务被添加（生成问题 + 可能的邮件通知）

    def test_create_interview_with_panel_members(self, db: Session, test_resume: Resume, test_position: Position,
                                                  test_interviewer: User, mock_background_tasks):
        """测试创建带有面试小组的面试"""
        interview_data = InterviewCreate(
            resume_id=test_resume.id,
            position_id=test_position.id,
            interviewer="主面试官",
            interview_time=datetime(2024, 12, 15, 10, 0, tzinfo=timezone.utc),
            panel_members=[str(test_interviewer.id)]
        )

        result = interview_service.create_interview(db, interview_data, mock_background_tasks)

        assert result is not None
        assert result.panel_members == [str(test_interviewer.id)]

    def test_create_interview_resume_not_found(self, db: Session, test_position: Position, mock_background_tasks):
        """测试简历不存在时创建面试失败"""
        interview_data = InterviewCreate(
            resume_id=uuid4(),  # 不存在的简历ID
            position_id=test_position.id,
            interviewer="主面试官"
        )

        with pytest.raises(HTTPException) as exc_info:
            interview_service.create_interview(db, interview_data, mock_background_tasks)

        assert exc_info.value.status_code == 404
        assert "Resume not found" in exc_info.value.detail

    def test_create_interview_position_not_found(self, db: Session, test_resume: Resume, mock_background_tasks):
        """测试岗位不存在时创建面试失败"""
        interview_data = InterviewCreate(
            resume_id=test_resume.id,
            position_id=uuid4(),  # 不存在的岗位ID
            interviewer="主面试官"
        )

        with pytest.raises(HTTPException) as exc_info:
            interview_service.create_interview(db, interview_data, mock_background_tasks)

        assert exc_info.value.status_code == 404
        assert "Position not found" in exc_info.value.detail


class TestGetInterviews:
    """测试获取面试列表功能"""

    def test_get_interviews_success(self, db: Session, test_interview: Interview):
        """测试获取面试列表"""
        result = interview_service.get_interviews(db)

        assert len(result) == 1
        assert result[0].id == test_interview.id

    def test_get_interviews_with_pagination(self, db: Session, test_interview: Interview):
        """测试分页获取面试列表"""
        result = interview_service.get_interviews(db, skip=0, limit=10)

        assert len(result) == 1

    def test_get_interviews_with_status_filter(self, db: Session, test_interview: Interview):
        """测试按状态过滤面试列表"""
        result = interview_service.get_interviews(db, status=InterviewStatus.SCHEDULED)

        assert len(result) == 1
        assert result[0].status == InterviewStatus.SCHEDULED

    def test_get_interviews_empty(self, db: Session):
        """测试空面试列表"""
        result = interview_service.get_interviews(db)

        assert len(result) == 0


class TestGetInterview:
    """测试获取单个面试功能"""

    def test_get_interview_success(self, db: Session, test_interview: Interview):
        """测试成功获取面试详情"""
        result = interview_service.get_interview(db, test_interview.id)

        assert result is not None
        assert result.id == test_interview.id
        assert result.resume is not None  # joinedload
        assert result.position is not None  # joinedload

    def test_get_interview_not_found(self, db: Session):
        """测试获取不存在的面试"""
        result = interview_service.get_interview(db, uuid4())

        assert result is None


class TestUpdateInterview:
    """测试更新面试功能"""

    def test_update_interview_success(self, db: Session, test_interview: Interview):
        """测试成功更新面试"""
        update_data = InterviewUpdate(
            interviewer="新面试官",
            interview_time=datetime(2024, 12, 20, 14, 0, tzinfo=timezone.utc)
        )

        result = interview_service.update_interview(db, test_interview.id, update_data)

        assert result is not None
        assert result.interviewer == "新面试官"

    def test_update_interview_not_found(self, db: Session):
        """测试更新不存在的面试"""
        update_data = InterviewUpdate(interviewer="新面试官")

        result = interview_service.update_interview(db, uuid4(), update_data)

        assert result is None

    def test_update_interview_partial(self, db: Session, test_interview: Interview):
        """测试部分更新面试"""
        original_time = test_interview.interview_time
        update_data = InterviewUpdate(interviewer="更新后的面试官")

        result = interview_service.update_interview(db, test_interview.id, update_data)

        assert result.interviewer == "更新后的面试官"
        assert result.interview_time == original_time  # 未更新的字段保持不变


class TestDeleteInterview:
    """测试删除面试功能"""

    def test_delete_interview_success(self, db: Session, test_interview: Interview):
        """测试成功删除面试"""
        result = interview_service.delete_interview(db, test_interview.id)

        assert result is not None

        # 验证已删除
        deleted = interview_service.get_interview(db, test_interview.id)
        assert deleted is None

    def test_delete_interview_not_found(self, db: Session):
        """测试删除不存在的面试"""
        result = interview_service.delete_interview(db, uuid4())

        assert result is None


class TestStartInterview:
    """测试开始面试功能"""

    def test_start_interview_success(self, db: Session, test_interview: Interview):
        """测试成功开始面试，状态从 SCHEDULED 改为 IN_PROGRESS"""
        assert test_interview.status == InterviewStatus.SCHEDULED

        result = interview_service.start_interview(db, test_interview.id)

        assert result is not None
        assert result.status == InterviewStatus.IN_PROGRESS

    def test_start_interview_not_found(self, db: Session):
        """测试开始不存在的面试"""
        result = interview_service.start_interview(db, uuid4())

        assert result is None

    def test_start_interview_wrong_status(self, db: Session, test_interview_in_progress: Interview):
        """测试面试状态不正确时无法开始"""
        # 面试已经进行中，再次尝试开始
        with pytest.raises(HTTPException) as exc_info:
            interview_service.start_interview(db, test_interview_in_progress.id)

        assert exc_info.value.status_code == 400
        assert "Cannot start interview" in exc_info.value.detail


class TestCancelInterview:
    """测试取消面试功能"""

    def test_cancel_interview_success(self, db: Session, test_interview: Interview):
        """测试成功取消面试"""
        result = interview_service.cancel_interview(db, test_interview.id)

        assert result is not None
        assert result.status == InterviewStatus.CANCELLED

    def test_cancel_interview_with_reason(self, db: Session, test_interview: Interview):
        """测试带原因取消面试"""
        reason = "候选人临时有事"

        result = interview_service.cancel_interview(db, test_interview.id, reason)

        assert result is not None
        assert result.status == InterviewStatus.CANCELLED
        assert "cancel_reason" in result.comments
        assert result.comments["cancel_reason"] == reason

    def test_cancel_interview_not_found(self, db: Session):
        """测试取消不存在的面试"""
        result = interview_service.cancel_interview(db, uuid4())

        assert result is None

    def test_cancel_interview_already_completed(self, db: Session, test_interview: Interview):
        """测试无法取消已完成的面试"""
        # 将面试状态改为已完成
        test_interview.status = InterviewStatus.COMPLETED
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            interview_service.cancel_interview(db, test_interview.id)

        assert exc_info.value.status_code == 400
        assert "Cannot cancel a completed interview" in exc_info.value.detail


class TestSubmitInterviewPanelScore:
    """测试提交面试官评分功能"""

    def test_submit_panel_score_success(self, db: Session, test_interview: Interview,
                                         test_interviewer: User):
        """测试成功提交面试官评分"""
        score_data = InterviewScore(
            scores={"0": 8, "1": 9},
            comments={"0": "回答很好", "1": "技术扎实"}
        )

        panel, all_submitted = interview_service.submit_interview_panel_score(
            db, test_interview.id, test_interviewer.id, score_data
        )

        assert panel is not None
        assert panel.is_submitted is True
        assert panel.scores == {"0": 8, "1": 9}
        assert panel.total_score == 8  # (8 + 9) / 2 = 8.5, floor to 8
        assert all_submitted is True

    def test_submit_panel_score_auto_change_status(self, db: Session, test_interview: Interview,
                                                    test_interviewer: User):
        """测试提交评分时自动将状态从 SCHEDULED 改为 IN_PROGRESS"""
        assert test_interview.status == InterviewStatus.SCHEDULED

        score_data = InterviewScore(scores={"0": 8})

        interview_service.submit_interview_panel_score(
            db, test_interview.id, test_interviewer.id, score_data
        )

        db.refresh(test_interview)
        assert test_interview.status == InterviewStatus.IN_PROGRESS

    def test_submit_panel_score_existing_panel(self, db: Session, test_interview: Interview,
                                                test_interview_panel: InterviewPanel):
        """测试更新已有的面试官评分"""
        score_data = InterviewScore(
            scores={"0": 9, "1": 10},
            comments={"0": "优秀", "1": "非常出色"}
        )

        panel, all_submitted = interview_service.submit_interview_panel_score(
            db, test_interview.id, test_interview_panel.interviewer_id, score_data
        )

        assert panel.is_submitted is True
        assert panel.scores == {"0": 9, "1": 10}
        assert all_submitted is True


class TestAggregatePanelScores:
    """测试汇总面试官评分功能"""

    def test_aggregate_scores_success(self, db: Session, test_interview: Interview,
                                       test_interviewer: User, mock_background_tasks):
        """测试成功汇总评分"""
        # 创建已提交的面试官评分
        panel = InterviewPanel(
            id=uuid4(),
            interview_id=test_interview.id,
            interviewer_id=test_interviewer.id,
            scores={"0": 8, "1": 9},
            comments={"0": "不错", "1": "很好"},
            total_score=8,
            is_submitted=True
        )
        db.add(panel)
        db.commit()

        result = interview_service.aggregate_panel_scores(db, test_interview.id, mock_background_tasks)

        assert result is not None
        assert result.scores == {"0": 8, "1": 9}
        assert len(mock_background_tasks.tasks) == 1  # AI 评估任务被添加

    def test_aggregate_scores_no_panels(self, db: Session, test_interview: Interview,
                                         mock_background_tasks):
        """测试没有评分时汇总失败"""
        result = interview_service.aggregate_panel_scores(db, test_interview.id, mock_background_tasks)

        assert result is None

    def test_aggregate_scores_multiple_panels(self, db: Session, test_interview: Interview,
                                               test_interviewer: User, test_user: User,
                                               mock_background_tasks):
        """测试多个面试官评分汇总"""
        # 添加第二个面试官到面试
        test_interview.panel_members = [str(test_interviewer.id), str(test_user.id)]
        db.commit()

        # 创建两个面试官的评分
        panel1 = InterviewPanel(
            id=uuid4(),
            interview_id=test_interview.id,
            interviewer_id=test_interviewer.id,
            scores={"0": 8, "1": 9},
            comments={"0": "不错", "1": "很好"},
            total_score=8,
            is_submitted=True
        )
        panel2 = InterviewPanel(
            id=uuid4(),
            interview_id=test_interview.id,
            interviewer_id=test_user.id,
            scores={"0": 7, "1": 8},
            comments={"0": "还行", "1": "不错"},
            total_score=7,
            is_submitted=True
        )
        db.add_all([panel1, panel2])
        db.commit()

        result = interview_service.aggregate_panel_scores(db, test_interview.id, mock_background_tasks)

        assert result is not None
        # 平均分: (8+7)/2=7.5≈8, (9+8)/2=8.5≈8
        assert result.scores == {"0": 8, "1": 8}


class TestGetSubmissionStatus:
    """测试获取评分提交状态功能"""

    def test_get_submission_status_success(self, db: Session, test_interview: Interview,
                                            test_interviewer: User):
        """测试成功获取提交状态"""
        result = interview_service.get_submission_status(db, test_interview.id)

        assert result is not None
        assert result["interview_id"] == str(test_interview.id)
        assert result["total_members"] == 1
        assert result["submitted_count"] == 0  # 尚未提交

    def test_get_submission_status_with_submitted(self, db: Session, test_interview: Interview,
                                                   test_interviewer: User, test_interview_panel: InterviewPanel):
        """测试已有提交的评分状态"""
        # 提交评分
        test_interview_panel.is_submitted = True
        db.commit()

        result = interview_service.get_submission_status(db, test_interview.id)

        assert result is not None
        assert result["submitted_count"] == 1

    def test_get_submission_status_not_found(self, db: Session):
        """测试获取不存在面试的提交状态"""
        result = interview_service.get_submission_status(db, uuid4())

        assert result is None


class TestConfirmInterviewResult:
    """测试确认面试结果功能"""

    def test_confirm_result_passed(self, db: Session, test_interview: Interview):
        """测试确认面试通过"""
        test_interview.status = InterviewStatus.COMPLETED
        test_interview.result = InterviewResult.PENDING
        db.commit()

        result = interview_service.confirm_interview_result(db, test_interview.id, "passed")

        assert result is not None
        assert result.result == InterviewResult.PASSED

    def test_confirm_result_rejected(self, db: Session, test_interview: Interview):
        """测试确认面试未通过"""
        test_interview.status = InterviewStatus.COMPLETED
        db.commit()

        result = interview_service.confirm_interview_result(db, test_interview.id, "rejected")

        assert result is not None
        assert result.result == InterviewResult.REJECTED

    def test_confirm_result_updates_resume_status(self, db: Session, test_interview: Interview,
                                                   test_resume: Resume):
        """测试确认结果时同步更新简历状态"""
        test_interview.status = InterviewStatus.COMPLETED
        db.commit()

        result = interview_service.confirm_interview_result(db, test_interview.id, "passed")

        db.refresh(test_resume)
        assert test_resume.status == ResumeStatus.INTERVIEW_PASSED
        assert test_resume.screening_result == ScreeningResult.PASSED

    def test_confirm_result_not_found(self, db: Session):
        """测试确认不存在面试的结果"""
        result = interview_service.confirm_interview_result(db, uuid4(), "passed")

        assert result is None


class TestGetInterviewsForInterviewer:
    """测试获取面试官的面试列表功能"""

    def test_get_interviews_for_interviewer_success(self, db: Session, test_interview: Interview,
                                                     test_interviewer: User):
        """测试成功获取面试官的面试列表"""
        result = interview_service.get_interviews_for_interviewer(db, test_interviewer.id)

        assert len(result) == 1
        assert result[0].id == test_interview.id

    def test_get_interviews_for_interviewer_empty(self, db: Session, test_user: User):
        """测试面试官没有分配面试时的空列表"""
        result = interview_service.get_interviews_for_interviewer(db, test_user.id)

        assert len(result) == 0

    def test_get_interviews_for_interviewer_not_assigned(self, db: Session, test_interview: Interview,
                                                         test_user: User):
        """测试面试官未被分配到该面试时不会返回"""
        # test_user 不是 test_interview 的 panel_members
        result = interview_service.get_interviews_for_interviewer(db, test_user.id)

        assert len(result) == 0


class TestExportInterviewResult:
    """测试导出面试结果功能"""

    def test_export_interview_result_success(self, db: Session, test_interview: Interview):
        """测试成功导出面试结果"""
        test_interview.status = InterviewStatus.COMPLETED
        test_interview.result = InterviewResult.PASSED
        test_interview.total_score = 85
        test_interview.evaluation = "候选人表现优秀"
        db.commit()

        result = interview_service.export_interview_result(db, test_interview.id)

        assert result is not None
        assert "面试评估报告" in result
        assert "候选人表现优秀" in result

    def test_export_interview_result_not_found(self, db: Session):
        """测试导出不存在面试的结果"""
        result = interview_service.export_interview_result(db, uuid4())

        assert result is None


class TestUpdateInterviewQuestions:
    """测试更新面试问题功能"""

    def test_update_questions_success(self, db: Session, test_interview: Interview):
        """测试成功更新面试问题"""
        new_questions = [
            {"title": "新问题1", "content": "问题内容1", "reference_answer": "答案1"},
            {"title": "新问题2", "content": "问题内容2", "reference_answer": "答案2"}
        ]

        result = interview_service.update_interview_questions(db, test_interview.id, new_questions)

        assert result is not None
        assert len(result.questions) == 2
        assert result.questions[0]["title"] == "新问题1"

    def test_update_questions_not_found(self, db: Session):
        """测试更新不存在面试的问题"""
        result = interview_service.update_interview_questions(db, uuid4(), [])

        assert result is None
