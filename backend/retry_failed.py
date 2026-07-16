import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.config.database import SessionLocal
from app.models.models import Resume

db = SessionLocal()
for r in db.query(Resume).filter(Resume.parse_status.in_(["failed", "pending"])).all():
    r.parse_status = "processing"
    r.parse_error = None
    db.commit()
    print(f"  Reset {r.id} to processing")

    from app.services.resume_service import process_resume_background
    process_resume_background(r.id, r.position_id)

db.close()
print("Done! Check in a minute.")
