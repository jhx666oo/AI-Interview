"""add in_progress to interview status enum

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-03-06

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM

# revision identifiers, used by Alembic.
revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade():
    # PostgreSQL requires altering the enum type
    # First, add the new value to the enum
    op.execute("""
        ALTER TYPE interviewstatus ADD VALUE IF NOT EXISTS 'in_progress'
    """)


def downgrade():
    # PostgreSQL does not support removing enum values directly
    # In a production environment, you would need to:
    # 1. Create a new enum without the value
    # 2. Update the column to use the new enum
    # 3. Drop the old enum
    # For safety, we'll just log a warning
    print("WARNING: PostgreSQL does not support removing enum values. 'in_progress' will remain in the enum.")