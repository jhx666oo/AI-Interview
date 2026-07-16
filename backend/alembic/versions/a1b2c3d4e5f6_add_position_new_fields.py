"""add_position_new_fields

Revision ID: a1b2c3d4e5f6
Revises: 1d5b7e2a3c1a
Create Date: 2026-03-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "2f0b2f0d4a7b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 先创建枚举类型（PostgreSQL 需要）
    op.execute("CREATE TYPE positionurgency AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT')")
    op.execute("CREATE TYPE positiontype AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP')")
    op.add_column('positions', sa.Column('urgency', sa.Enum('LOW', 'MEDIUM', 'HIGH', 'URGENT', name='positionurgency'), server_default='MEDIUM', nullable=True))
    op.add_column('positions', sa.Column('position_type', sa.Enum('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', name='positiontype'), server_default='FULL_TIME', nullable=True))
    op.add_column('positions', sa.Column('headcount', sa.Integer(), server_default='1', nullable=True))
    op.add_column('positions', sa.Column('reports_to', sa.String(), nullable=True))
    op.add_column('positions', sa.Column('hiring_manager_id', UUID(), nullable=True))
    
    op.create_foreign_key('fk_positions_hiring_manager', 'positions', 'users', ['hiring_manager_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('fk_positions_hiring_manager', 'positions', type_='foreignkey')
    op.drop_column('positions', 'hiring_manager_id')
    op.drop_column('positions', 'reports_to')
    op.drop_column('positions', 'headcount')
    op.drop_column('positions', 'position_type')
    op.drop_column('positions', 'urgency')
    
    op.execute("DROP TYPE IF EXISTS positiontype")
    op.execute("DROP TYPE IF EXISTS positionurgency")