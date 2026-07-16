"""
批量重新解析所有已上传的简历 PDF 文件。
1. 将 uploads/resumes/ 中的 PDF 文件插入 resumes 表（如果不存在）
2. 调用 process_resume_background 重新解析每个简历
"""
import sys, os, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.config.database import SessionLocal
from app.models.models import Resume, ResumeStatus, ScreeningResult, Position
from app.services.resume_service import process_resume_background, read_file_content
from datetime import datetime

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "resumes")

db = SessionLocal()

# 1. 找出已有记录
existing = {}
for r in db.query(Resume).all():
    if r.file_path:
        existing[os.path.basename(r.file_path)] = r

# 2. 需要有一个 position_id
pos = db.query(Position).first()
if not pos:
    print("ERROR: No position found in DB. Create a position first.")
    sys.exit(1)

# 3. 遍历 PDF 文件
pdf_files = sorted([f for f in os.listdir(UPLOAD_DIR) if f.endswith('.pdf')])
print(f"Found {len(pdf_files)} PDF files in uploads/resumes/")

for fname in pdf_files:
    file_path = os.path.join(UPLOAD_DIR, fname)
    
    if fname in existing:
        resume = existing[fname]
        print(f"  Re-parsing: {resume.id} ({resume.candidate_name}) [{fname}]")
    else:
        raw_text, resume_md = read_file_content(file_path)
        if not raw_text:
            print(f"  SKIP {fname}: could not read content")
            continue

        resume_id = uuid.uuid4()
        resume = Resume(
            id=resume_id,
            file_path=file_path,
            raw_text=raw_text,
            resume_markdown=resume_md,
            parse_status="pending",
            status=ResumeStatus.PENDING_SCREENING,
            screening_result=ScreeningResult.PENDING,
            position_id=pos.id,
            candidate_name="解析中...",
            created_at=datetime.utcnow(),
        )
        db.add(resume)
        db.commit()
        print(f"  Inserted: {resume_id} [{fname}]")
        existing[fname] = resume

    process_resume_background(resume.id, resume.position_id)

db.close()
print("Done!")

