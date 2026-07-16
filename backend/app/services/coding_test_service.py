from uuid import UUID
from datetime import datetime
import secrets
import random
import os
import json
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from fastapi import HTTPException, BackgroundTasks

from app.models.models import CodingTest, CodingTestStatus, CodingSubmission, CodingSubmissionStatus, QuestionBank
from app.schemas.coding_test import CodingTestCreate, CodingTestUpdate
from app.services.code_runner_service import run_code_against_tests
from app.services.coding_test_ai_service import generate_coding_evaluation_background


def _generate_public_token() -> str:
    return secrets.token_urlsafe(16)


def create_coding_test(db: Session, coding_test: CodingTestCreate, creator_id: UUID) -> CodingTest:
    token = _generate_public_token()
    for _ in range(5):
        exists = db.query(CodingTest).filter(CodingTest.public_token == token).first()
        if not exists:
            break
        token = _generate_public_token()
    else:
        raise HTTPException(status_code=500, detail="Failed to generate public token")

    test_type = coding_test.test_type or "algorithm"
    gen_status = "completed" if test_type == "algorithm" else "pending"

    db_test = CodingTest(
        title=coding_test.title,
        description=coding_test.description,
        test_type=test_type,
        difficulty=coding_test.difficulty or "intermediate",
        language=coding_test.language or "javascript",
        starter_code=coding_test.starter_code,
        test_cases=coding_test.test_cases or [],
        time_limit_ms=coding_test.time_limit_ms or 3000,
        memory_limit_mb=coding_test.memory_limit_mb or 256,
        public_token=token,
        status=coding_test.status or CodingTestStatus.DRAFT,
        question_bank_id=coding_test.question_bank_id,
        questions=coding_test.questions or [],
        question_generation_status=gen_status,
        duration_minutes=coding_test.duration_minutes or 60,
        created_by=creator_id,
        resume_id=coding_test.resume_id,
        position_id=coding_test.position_id,
    )
    db.add(db_test)
    db.commit()
    db.refresh(db_test)
    return db_test


def list_coding_tests(db: Session, skip: int = 0, limit: int = 100) -> List[CodingTest]:
    return db.query(CodingTest).order_by(CodingTest.created_at.desc()).offset(skip).limit(limit).all()


def get_coding_test(db: Session, coding_test_id: UUID) -> Optional[CodingTest]:
    return db.query(CodingTest).filter(CodingTest.id == coding_test_id).first()


def update_coding_test(db: Session, coding_test_id: UUID, payload: CodingTestUpdate) -> Optional[CodingTest]:
    db_test = get_coding_test(db, coding_test_id)
    if not db_test:
        return None
    data = payload.dict(exclude_unset=True)
    for k, v in data.items():
        setattr(db_test, k, v)
    db.commit()
    db.refresh(db_test)
    return db_test


def delete_coding_test(db: Session, coding_test_id: UUID) -> bool:
    db_test = get_coding_test(db, coding_test_id)
    if not db_test:
        return False
    db.delete(db_test)
    db.commit()
    return True


def publish_coding_test(db: Session, coding_test_id: UUID) -> Optional[CodingTest]:
    db_test = get_coding_test(db, coding_test_id)
    if not db_test:
        return None
    db_test.status = CodingTestStatus.PUBLISHED
    db.commit()
    db.refresh(db_test)
    return db_test


def close_coding_test(db: Session, coding_test_id: UUID) -> Optional[CodingTest]:
    db_test = get_coding_test(db, coding_test_id)
    if not db_test:
        return None
    db_test.status = CodingTestStatus.CLOSED
    db.commit()
    db.refresh(db_test)
    return db_test


def get_public_coding_test(db: Session, token: str) -> Optional[CodingTest]:
    return db.query(CodingTest).filter(CodingTest.public_token == token).first()


def run_public_code(db: Session, token: str, code: str, language: str) -> dict:
    db_test = get_public_coding_test(db, token)
    if not db_test or db_test.status != CodingTestStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Coding test not found")
    run = run_code_against_tests(language=language, code=code, test_cases=db_test.test_cases or [], time_limit_ms=db_test.time_limit_ms or 3000)
    return run


def submit_public_code(db: Session, background_tasks: BackgroundTasks, token: str, candidate_name: Optional[str], candidate_email: Optional[str], code: str, language: str) -> CodingSubmission:
    db_test = get_public_coding_test(db, token)
    if not db_test or db_test.status != CodingTestStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Coding test not found")

    run = run_code_against_tests(language=language, code=code, test_cases=db_test.test_cases or [], time_limit_ms=db_test.time_limit_ms or 3000)

    db_sub = CodingSubmission(
        coding_test_id=db_test.id,
        candidate_name=candidate_name,
        candidate_email=candidate_email,
        language=language,
        code=code,
        run_result=run,
        passed=bool(run.get("passed")),
        score=int(run.get("score", 0)),
        status=CodingSubmissionStatus.SUBMITTED,
        submitted_at=datetime.utcnow(),
    )
    db.add(db_sub)
    db.commit()
    db.refresh(db_sub)

    background_tasks.add_task(generate_coding_evaluation_background, db_sub.id)

    return db_sub


def submit_choice_answers(db: Session, token: str, candidate_name: Optional[str], candidate_email: Optional[str], answers: List[Dict[str, Any]]) -> CodingSubmission:
    db_test = get_public_coding_test(db, token)
    if not db_test or db_test.status != CodingTestStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Coding test not found")

    questions = db_test.questions or []
    total_score = 0
    correct_count = 0
    
    for question in questions:
        q_id = question.get("id")
        correct_answer = question.get("correct_answer", "")
        user_answer = next((a.get("answer", "") for a in answers if a.get("question_id") == q_id), "")
        
        if user_answer == correct_answer:
            correct_count += 1
            total_score += question.get("score", 10)
    
    max_score = sum(q.get("score", 10) for q in questions)
    passed = correct_count >= len(questions) * 0.6

    db_sub = CodingSubmission(
        coding_test_id=db_test.id,
        candidate_name=candidate_name,
        candidate_email=candidate_email,
        answers=answers,
        run_result={"correct_count": correct_count, "total_questions": len(questions)},
        passed=passed,
        score=total_score,
        status=CodingSubmissionStatus.SUBMITTED,
        submitted_at=datetime.utcnow(),
    )
    db.add(db_sub)
    db.commit()
    db.refresh(db_sub)

    return db_sub


def submit_essay_answers(db: Session, background_tasks: BackgroundTasks, token: str, candidate_name: Optional[str], candidate_email: Optional[str], answers: List[Dict[str, Any]]) -> CodingSubmission:
    db_test = get_public_coding_test(db, token)
    if not db_test or db_test.status != CodingTestStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Coding test not found")

    db_sub = CodingSubmission(
        coding_test_id=db_test.id,
        candidate_name=candidate_name,
        candidate_email=candidate_email,
        answers=answers,
        passed=False,
        score=0,
        status=CodingSubmissionStatus.SUBMITTED,
        submitted_at=datetime.utcnow(),
    )
    db.add(db_sub)
    db.commit()
    db.refresh(db_sub)

    background_tasks.add_task(evaluate_essay_answers_background, db_sub.id)

    return db_sub


def evaluate_essay_answers_background(submission_id: UUID):
    from app.config.database import SessionLocal
    db = SessionLocal()
    try:
        submission = db.query(CodingSubmission).filter(CodingSubmission.id == submission_id).first()
        if not submission:
            print(f"Submission {submission_id} not found")
            return
        
        test = submission.coding_test
        questions = test.questions or []
        answers = submission.answers or []
        
        print(f"Evaluating essay submission {submission_id}, questions: {len(questions)}, answers: {len(answers)}")
        
        total_score = 0
        evaluation_results = []
        ai_evaluations = []
        
        for question in questions:
            q_id = question.get("id")
            user_answer = next((a.get("answer", "") for a in answers if a.get("question_id") == q_id), "")
            reference = question.get("reference_answer", "")
            keywords = question.get("keywords", [])
            max_score = question.get("max_score", 10)
            
            print(f"Evaluating question {q_id}: user_answer='{user_answer[:50]}...', max_score={max_score}")
            
            ai_result = _evaluate_essay_with_ai(
                question.get("question", ""),
                user_answer,
                reference,
                keywords,
                max_score
            )
            
            print(f"AI result for {q_id}: score={ai_result.get('score')}, evaluation={ai_result.get('evaluation')}")
            
            score = ai_result.get("score", 0)
            total_score += score
            evaluation_results.append({
                "question_id": q_id,
                "score": score,
                "max_score": max_score,
            })
            ai_evaluations.append({
                "question_id": q_id,
                "evaluation": ai_result.get("evaluation", ""),
                "score": score,
            })
        
        submission.score = total_score
        submission.run_result = {"evaluations": evaluation_results, "total_score": total_score, "ai_evaluations": ai_evaluations}
        submission.ai_evaluation = "\n\n".join([f"**题目{e['question_id']}**: {e['evaluation']}" for e in ai_evaluations])
        submission.passed = total_score >= sum(q.get("max_score", 10) for q in questions) * 0.6
        submission.status = CodingSubmissionStatus.EVALUATED
        submission.evaluated_at = datetime.utcnow()
        db.commit()
        print(f"Essay evaluation completed for {submission_id}: total_score={total_score}")
    except Exception as e:
        print(f"Error evaluating essay answers: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


def _evaluate_essay_with_ai(question: str, user_answer: str, reference_answer: str, keywords: list, max_score: int) -> dict:
    from app.services.ai_service import _get_client, _get_llm_config, _get_extra_body
    
    if not user_answer or not user_answer.strip():
        return {"score": 0, "evaluation": "未作答"}
    
    system_prompt = """你是一个专业的阅卷老师，负责评价简答题答案。

请根据以下标准评分：
1. 答案的准确性和完整性
2. 是否涵盖关键知识点
3. 逻辑清晰度

返回JSON格式：
{
  "score": 分数(0到max_score的整数),
  "evaluation": "简要评价(50字以内)"
}"""

    user_prompt = f"""题目：{question}

参考答案：{reference_answer or '无'}

关键词：{', '.join(keywords) if keywords else '无'}

学生答案：{user_answer}

满分：{max_score}分

请给出评分和简要评价。"""

    try:
        cfg = _get_llm_config()
        extra = {"temperature": 0.3}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = 500
        
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        
        result = json.loads(completion.choices[0].message.content)
        score = min(max(0, int(result.get("score", 0))), max_score)
        return {"score": score, "evaluation": result.get("evaluation", "")}
    except Exception as e:
        print(f"AI evaluation failed: {e}")
        if keywords:
            matched = sum(1 for kw in keywords if kw.lower() in user_answer.lower())
            score = int((matched / len(keywords)) * max_score) if keywords else 0
        else:
            score = int(max_score * 0.5)
        return {"score": score, "evaluation": "自动评分"}


def get_public_submission(db: Session, token: str, submission_id: UUID) -> Optional[CodingSubmission]:
    db_test = get_public_coding_test(db, token)
    if not db_test:
        return None
    return db.query(CodingSubmission).filter(CodingSubmission.id == submission_id, CodingSubmission.coding_test_id == db_test.id).first()


def list_coding_test_submissions(db: Session, coding_test_id: UUID, skip: int = 0, limit: int = 100) -> List[CodingSubmission]:
    return (
        db.query(CodingSubmission)
        .filter(CodingSubmission.coding_test_id == coding_test_id)
        .order_by(CodingSubmission.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_coding_submission(db: Session, submission_id: UUID) -> Optional[CodingSubmission]:
    return db.query(CodingSubmission).filter(CodingSubmission.id == submission_id).first()


def _read_file_content(file_path: str) -> str:
    if not file_path or not os.path.exists(file_path):
        return ""
    
    ext = file_path.lower().split('.')[-1]
    
    if ext in ['txt', 'md']:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    
    if ext == 'pdf':
        try:
            import PyPDF2
            with open(file_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                text = ""
                for page in reader.pages:
                    text += page.extract_text() or ""
            return text
        except Exception as e:
            print(f"PDF read error: {e}")
            return ""
    
    if ext == 'docx':
        try:
            from docx import Document
            doc = Document(file_path)
            text = "\n".join([para.text for para in doc.paragraphs])
            return text
        except Exception as e:
            print(f"DOCX read error: {e}")
            return ""
    
    return ""


def _generate_questions_with_ai(content: str, test_type: str, count: int) -> List[Dict[str, Any]]:
    from app.services.ai_service import _get_client, _get_llm_config, _get_extra_body
    
    if test_type == "choice":
        system_prompt = """你是一个专业的考试出题专家。根据提供的题库内容，生成高质量的选择题。

要求：
1. 题目必须基于题库内容，不能凭空捏造
2. 每道题必须有4个选项（A、B、C、D）
3. 必须有明确的正确答案
4. 可以是单选题或多选题
5. 题目难度要适中，考察核心知识点

返回JSON格式：
{
  "questions": [
    {
      "question": "题目内容",
      "options": [
        {"label": "A", "text": "选项A内容"},
        {"label": "B", "text": "选项B内容"},
        {"label": "C", "text": "选项C内容"},
        {"label": "D", "text": "选项D内容"}
      ],
      "correct_answer": "A",
      "is_multiple": false,
      "explanation": "答案解析（可选）",
      "score": 10
    }
  ]
}"""
    else:
        system_prompt = """你是一个专业的考试出题专家。根据提供的题库内容，生成高质量的简答题。

要求：
1. 题目必须基于题库内容，不能凭空捏造
2. 题目要能考察对知识点的理解和应用
3. 提供参考答案和关键词，便于自动评分
4. 题目难度要适中

返回JSON格式：
{
  "questions": [
    {
      "question": "题目内容",
      "reference_answer": "参考答案",
      "keywords": ["关键词1", "关键词2"],
      "max_score": 10
    }
  ]
}"""
    
    user_prompt = f"""请根据以下题库内容，生成 {count} 道{"选择题" if test_type == "choice" else "简答题"}。

题库内容：
{content[:8000]}

请确保题目覆盖题库中的核心知识点，难度适中。"""
    
    try:
        cfg = _get_llm_config()
        extra = {"temperature": 0.7}
        if cfg["llm_max_tokens"] is not None:
            extra["max_tokens"] = cfg["llm_max_tokens"]
        
        completion = _get_client().chat.completions.create(
            model=cfg["llm_model"],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            extra_body=_get_extra_body(),
            **extra,
        )
        
        result = json.loads(completion.choices[0].message.content)
        questions = result.get("questions", [])
        
        for i, q in enumerate(questions):
            q["id"] = f"q_{i+1}"
            if "score" not in q and "max_score" not in q:
                q["score"] = 10
        
        return questions
    except Exception as e:
        print(f"AI question generation failed: {e}")
        return []


def generate_questions_from_bank(db: Session, question_bank_id: UUID, test_type: str, count: int = 10) -> List[Dict[str, Any]]:
    bank = db.query(QuestionBank).filter(QuestionBank.id == question_bank_id).first()
    if not bank:
        raise HTTPException(status_code=404, detail="Question bank not found")
    
    all_questions = bank.questions or []
    
    if all_questions:
        filtered = [q for q in all_questions if q.get("type") == test_type]
        if filtered:
            selected = random.sample(filtered, min(count, len(filtered)))
        else:
            selected = random.sample(all_questions, min(count, len(all_questions)))
        
        result = []
        for i, q in enumerate(selected):
            item = {
                "id": f"q_{i+1}",
                "question": q.get("question", q.get("content", "")),
                "score": q.get("score", 10),
            }
            
            if test_type == "choice":
                item["options"] = q.get("options", [])
                item["correct_answer"] = q.get("correct_answer", q.get("answer", ""))
                item["is_multiple"] = q.get("is_multiple", False)
                item["explanation"] = q.get("explanation")
            elif test_type == "essay":
                item["reference_answer"] = q.get("reference_answer", q.get("answer", ""))
                item["keywords"] = q.get("keywords", [])
                item["max_score"] = q.get("max_score", q.get("score", 10))
            
            result.append(item)
        
        if result:
            return result
    
    if bank.source_file:
        content = _read_file_content(bank.source_file)
        if content:
            questions = _generate_questions_with_ai(content, test_type, count)
            if questions:
                return questions
    
    return []


def generate_questions_background(coding_test_id: UUID, question_bank_id: UUID, test_type: str, count: int = 10):
    from app.config.database import SessionLocal
    db = SessionLocal()
    try:
        db_test = db.query(CodingTest).filter(CodingTest.id == coding_test_id).first()
        if not db_test:
            return
        
        try:
            questions = generate_questions_from_bank(db, question_bank_id, test_type, count)
            if questions:
                db_test.questions = questions
                db_test.question_generation_status = "completed"
            else:
                db_test.question_generation_status = "failed"
            db.commit()
        except Exception as e:
            print(f"Background question generation failed: {e}")
            db_test.question_generation_status = "failed"
            db.commit()
    except Exception as e:
        print(f"Background task error: {e}")
    finally:
        db.close()