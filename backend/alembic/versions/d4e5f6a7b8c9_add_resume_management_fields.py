"""add resume management fields

Revision ID: d4e5f6a7b8c9
Revises: b2c3d4e5f6a7
Create Date: 2026-03-05 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'd4e5f6a7b8c9'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create reject_reason_category enum (if not exists)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE rejectreasoncategory AS ENUM (
                'skills_mismatch', 'experience_insufficient', 'education_mismatch',
                'salary_expectation', 'culture_fit', 'candidate_withdraw', 'other'
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    # 2. Create review_recommendation enum (if not exists)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE reviewrecommendation AS ENUM (
                'recommend', 'not_recommend', 'pending'
            );
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    # 3. Add new values to resume_status enum
    op.execute("""
        DO $$ BEGIN
            ALTER TYPE resumestatus ADD VALUE IF NOT EXISTS 'pending_dept_review';
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            ALTER TYPE resumestatus ADD VALUE IF NOT EXISTS 'pending_hr_decision';
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            ALTER TYPE resumestatus ADD VALUE IF NOT EXISTS 'auto_rejected_pending_review';
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            ALTER TYPE resumestatus ADD VALUE IF NOT EXISTS 'waitlist';
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)

    # 4. Add new columns to resumes table (if not exists)
    conn = op.get_bind()

    # Check if columns exist before adding
    result = conn.execute(sa.text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'resumes' AND column_name = 'reject_reason_category'
    """))
    if not result.fetchone():
        op.add_column('resumes', sa.Column('reject_reason_category',
            postgresql.ENUM('skills_mismatch', 'experience_insufficient', 'education_mismatch',
                'salary_expectation', 'culture_fit', 'candidate_withdraw', 'other',
                name='rejectreasoncategory', create_type=False), nullable=True))

    result = conn.execute(sa.text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'resumes' AND column_name = 'reject_reason_detail'
    """))
    if not result.fetchone():
        op.add_column('resumes', sa.Column('reject_reason_detail', sa.Text(), nullable=True))

    result = conn.execute(sa.text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'resumes' AND column_name = 'rejected_at'
    """))
    if not result.fetchone():
        op.add_column('resumes', sa.Column('rejected_at', sa.DateTime(), nullable=True))

    result = conn.execute(sa.text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'resumes' AND column_name = 'rejected_by'
    """))
    if not result.fetchone():
        op.add_column('resumes', sa.Column('rejected_by', postgresql.UUID(as_uuid=True), nullable=True))

    # 5. Add index on email column for duplicate check (if not exists)
    result = conn.execute(sa.text("""
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'resumes' AND indexname = 'ix_resumes_email'
    """))
    if not result.fetchone():
        op.create_index('ix_resumes_email', 'resumes', ['email'], unique=False)

    # 6. Add foreign key for rejected_by (if not exists)
    result = conn.execute(sa.text("""
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name = 'resumes' AND constraint_name = 'fk_resumes_rejected_by'
    """))
    if not result.fetchone():
        op.create_foreign_key(
            'fk_resumes_rejected_by',
            'resumes', 'users',
            ['rejected_by'], ['id'],
            ondelete='SET NULL'
        )

    # 7. Create department_reviews table (if not exists)
    result = conn.execute(sa.text("""
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'department_reviews'
    """))
    if not result.fetchone():
        op.create_table(
            'department_reviews',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('resume_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('resumes.id', ondelete='CASCADE'), nullable=False),
            sa.Column('reviewer_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('technical_score', sa.Integer(), nullable=True),
            sa.Column('experience_score', sa.Integer(), nullable=True),
            sa.Column('overall_score', sa.Integer(), nullable=True),
            sa.Column('recommendation', postgresql.ENUM(
                'recommend', 'not_recommend', 'pending',
                name='reviewrecommendation', create_type=False
            ), nullable=True),
            sa.Column('comment', sa.Text(), nullable=True),
            sa.Column('is_completed', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
            sa.Column('updated_at', sa.DateTime(), nullable=True, onupdate=sa.text('now()')),
        )

        # 8. Create indexes for department_reviews
        op.create_index('ix_department_reviews_resume_id', 'department_reviews', ['resume_id'])
        op.create_index('ix_department_reviews_reviewer_id', 'department_reviews', ['reviewer_id'])


def downgrade():
    # 1. Drop indexes
    op.drop_index('ix_department_reviews_reviewer_id', 'department_reviews', if_exists=True)
    op.drop_index('ix_department_reviews_resume_id', 'department_reviews', if_exists=True)

    # 2. Drop department_reviews table
    op.drop_table('department_reviews', if_exists=True)

    # 3. Drop foreign key
    op.drop_constraint('fk_resumes_rejected_by', 'resumes', type_='foreignkey', if_exists=True)

    # 4. Drop index on resumes.email
    op.drop_index('ix_resumes_email', 'resumes', if_exists=True)

    # 5. Drop columns from resumes
    op.drop_column('resumes', 'rejected_by', if_exists=True)
    op.drop_column('resumes', 'rejected_at', if_exists=True)
    op.drop_column('resumes', 'reject_reason_detail', if_exists=True)
    op.drop_column('resumes', 'reject_reason_category', if_exists=True)

    # Note: PostgreSQL doesn't support removing enum values easily
    # The new enum values will remain in the database but won't be used