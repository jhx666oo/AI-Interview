"""add interview type location fields

Revision ID: g7h8i9j0k1l2
Revises: f7a8b9c0d1e2
Create Date: 2026-03-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'g7h8i9j0k1l2'
down_revision = 'f7a8b9c0d1e2'
branch_labels = None
depends_on = None


def upgrade():
    # 添加面试类型和地点字段到 interviews 表
    op.add_column('interviews', sa.Column('interview_type', sa.String(), nullable=True, server_default='onsite'))
    op.add_column('interviews', sa.Column('interview_category', sa.String(), nullable=True, server_default='technical'))
    op.add_column('interviews', sa.Column('interview_location', sa.String(), nullable=True))
    op.add_column('interviews', sa.Column('meeting_link', sa.String(), nullable=True))


def downgrade():
    # 移除面试类型和地点字段
    op.drop_column('interviews', 'meeting_link')
    op.drop_column('interviews', 'interview_location')
    op.drop_column('interviews', 'interview_category')
    op.drop_column('interviews', 'interview_type')