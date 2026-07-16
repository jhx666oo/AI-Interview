from app.config.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    db.execute(text('ALTER TABLE offers ADD COLUMN IF NOT EXISTS token VARCHAR'))
    db.commit()
    print('Column token added successfully')
except Exception as e:
    print(f'Error: {e}')
    db.rollback()
finally:
    db.close()
