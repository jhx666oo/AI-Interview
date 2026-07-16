from uuid import UUID
from datetime import datetime

from app.config.database import SessionLocal
from app.models.models import CodingSubmission, CodingSubmissionStatus, CodingTest
from app.services.ai_service import generate_coding_test_evaluation


def generate_coding_evaluation_background(submission_id: UUID):
    db = SessionLocal()
    try:
        sub = db.query(CodingSubmission).filter(CodingSubmission.id == submission_id).first()
        if not sub:
            return
        test = db.query(CodingTest).filter(CodingTest.id == sub.coding_test_id).first()
        if not test:
            return

        evaluation = generate_coding_test_evaluation(
            title=test.title,
            description=test.description,
            language=sub.language,
            code=sub.code,
            run_result=sub.run_result or {},
        )

        sub.ai_evaluation = evaluation.get("evaluation")
        sub.status = CodingSubmissionStatus.EVALUATED
        sub.evaluated_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        print(f"Error generating coding evaluation for submission {submission_id}: {e}")
    finally:
        db.close()

