import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.config.database import SessionLocal
from app.models.models import User
db = SessionLocal()
users = db.query(User).all()
print(f"Total users: {len(users)}")
for u in users:
    print(f"  id={u.id} | name={u.full_name} | email={u.email} | role={u.role} | active={u.is_active}")
db.close()
