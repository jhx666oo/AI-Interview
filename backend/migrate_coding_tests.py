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
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS coding_tests (
                        id UUID PRIMARY KEY,
                        title VARCHAR NOT NULL,
                        description TEXT NOT NULL,
                        difficulty VARCHAR,
                        language VARCHAR,
                        starter_code TEXT,
                        test_cases JSON,
                        time_limit_ms INTEGER,
                        memory_limit_mb INTEGER,
                        public_token VARCHAR UNIQUE,
                        status VARCHAR,
                        created_by UUID REFERENCES users(id),
                        resume_id UUID REFERENCES resumes(id),
                        position_id UUID REFERENCES positions(id),
                        created_at TIMESTAMP,
                        updated_at TIMESTAMP
                    );
                    """
                )
            )

            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS coding_submissions (
                        id UUID PRIMARY KEY,
                        coding_test_id UUID REFERENCES coding_tests(id),
                        candidate_name VARCHAR,
                        candidate_email VARCHAR,
                        language VARCHAR,
                        code TEXT NOT NULL,
                        run_result JSON,
                        passed BOOLEAN,
                        score INTEGER,
                        ai_evaluation TEXT,
                        status VARCHAR,
                        created_at TIMESTAMP,
                        submitted_at TIMESTAMP,
                        evaluated_at TIMESTAMP
                    );
                    """
                )
            )

            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_coding_tests_public_token ON coding_tests(public_token);"))

            conn.commit()
            print("Created coding_tests and coding_submissions tables (if not exists)")
        except Exception as e:
            print(f"Error migrating coding test tables: {e}")


if __name__ == "__main__":
    migrate()

