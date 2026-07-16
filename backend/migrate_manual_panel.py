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
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS interview_panels (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    interview_id UUID REFERENCES interviews(id),
                    interviewer_id UUID REFERENCES users(id),
                    scores JSON,
                    comments JSON,
                    total_score INTEGER,
                    is_submitted BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            print("Created interview_panels table")
            conn.commit()
        except Exception as e:
            print(f"Error creating interview_panels table: {e}")

if __name__ == "__main__":
    migrate()
