"""add analyzing to interview status enum

Revision ID: f7a8b9c0d1e2
Revises: e5f6a7b8c9d0
Create Date: 2026-03-09

"""
from alembic import op

revision = 'f7a8b9c0d1e2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TYPE interviewstatus ADD VALUE IF NOT EXISTS 'analyzing'
    """)


def downgrade():
    print("WARNING: PostgreSQL does not support removing enum values. 'analyzing' will remain in the enum.")
