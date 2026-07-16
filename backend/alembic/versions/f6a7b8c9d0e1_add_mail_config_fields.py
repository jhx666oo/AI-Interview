"""add mail config fields to system_configs

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-03-06

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade():
    # system_configs 表在 h8i9j0k1l2m3 中创建时已包含以下字段，这里跳过
    pass


def downgrade():
    # 无需回滚
    pass