"""add_resume_parse_status

Revision ID: 1d5b7e2a3c1a
Revises: 6c88a8b85f32
Create Date: 2026-03-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


revision: str = "1d5b7e2a3c1a"
down_revision: Union[str, None] = "6c88a8b85f32"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("resumes", sa.Column("parse_status", sa.String(), server_default="processing", nullable=False))
    op.add_column("resumes", sa.Column("parse_error", sa.Text(), nullable=True))
    op.add_column("resumes", sa.Column("parsed_at", sa.DateTime(), nullable=True))

    conn = op.get_bind()
    conn.execute(
        text(
            "UPDATE resumes SET parse_status = 'success' "
            "WHERE parsed_data IS NOT NULL AND parse_status = 'processing'"
        )
    )


def downgrade() -> None:
    op.drop_column("resumes", "parsed_at")
    op.drop_column("resumes", "parse_error")
    op.drop_column("resumes", "parse_status")

