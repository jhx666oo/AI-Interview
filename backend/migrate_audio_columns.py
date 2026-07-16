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
            conn.execute(text("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS audio_records JSON;"))
            conn.execute(text("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS transcripts JSON;"))
            conn.execute(text("ALTER TABLE interview_panels ADD COLUMN IF NOT EXISTS audio_records JSON;"))
            conn.execute(text("ALTER TABLE interview_panels ADD COLUMN IF NOT EXISTS transcripts JSON;"))
            print("Added audio columns to interviews and interview_panels tables")
            conn.commit()
        except Exception as e:
            print(f"Error updating tables: {e}")

if __name__ == "__main__":
    migrate()
