"""add other_position_matches to resumes

Revision ID: j9k0l1m2n3o4
Revises: h8i9j0k1l2m3
Create Date: 2026-04-01

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'j9k0l1m2n3o4'
down_revision = 'h8i9j0k1l2m3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('resumes', sa.Column('other_position_matches', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('resumes', 'other_position_matches')