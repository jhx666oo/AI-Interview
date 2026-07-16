from sqlalchemy import create_engine, text
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

def migrate():
    if not DATABASE_URL:
        print("DATABASE_URL not found.")
        return

    engine = create_engine(DATABASE_URL)
    
    with engine.connect() as conn:
        # Add stage to resumes
        try:
            conn.execute(text("ALTER TABLE resumes ADD COLUMN stage VARCHAR DEFAULT 'new'"))
            print("Added stage column to resumes")
        except Exception as e:
            print(f"Skipping stage column (might exist): {e}")

        # Add round to interviews
        try:
            conn.execute(text("ALTER TABLE interviews ADD COLUMN round INTEGER DEFAULT 1"))
            print("Added round column to interviews")
        except Exception as e:
            print(f"Skipping round column (might exist): {e}")

        # Add interviewer_id to interviews
        try:
            conn.execute(text("ALTER TABLE interviews ADD COLUMN interviewer_id UUID REFERENCES users(id)"))
            print("Added interviewer_id column to interviews")
        except Exception as e:
            print(f"Skipping interviewer_id column (might exist): {e}")
            
        conn.commit()

if __name__ == "__main__":
    migrate()
