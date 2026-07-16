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
            conn.execute(text("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS panel_members JSON;"))
            print("Added panel_members column to interviews table")
            conn.commit()
        except Exception as e:
            print(f"Error updating interviews table: {e}")

if __name__ == "__main__":
    migrate()
