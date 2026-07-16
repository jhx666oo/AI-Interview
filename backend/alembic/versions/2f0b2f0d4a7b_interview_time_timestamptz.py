"""interview_time_timestamptz

Revision ID: 2f0b2f0d4a7b
Revises: 1d5b7e2a3c1a
Create Date: 2026-03-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "2f0b2f0d4a7b"
down_revision: Union[str, None] = "1d5b7e2a3c1a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "interviews",
        "interview_time",
        type_=sa.DateTime(timezone=True),
        postgresql_using="interview_time AT TIME ZONE 'UTC'",
        existing_type=sa.DateTime(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "interviews",
        "interview_time",
        type_=sa.DateTime(),
        postgresql_using="interview_time AT TIME ZONE 'UTC'",
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=True,
    )

