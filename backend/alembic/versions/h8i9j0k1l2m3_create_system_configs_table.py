"""create system_configs table

Revision ID: h8i9j0k1l2m3
Revises: b2c3d4e5f6a8
Create Date: 2026-04-01

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = 'h8i9j0k1l2m3'
down_revision = 'b2c3d4e5f6a8'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'system_configs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=sa.text('gen_random_uuid()')),
        sa.Column('llm_provider', sa.String(), default='dashscope'),
        sa.Column('llm_base_url', sa.String(), default='https://dashscope.aliyuncs.com/compatible-mode/v1'),
        sa.Column('llm_api_key', sa.String(), nullable=True),
        sa.Column('llm_model', sa.String(), default='qwen3.5-plus'),
        sa.Column('llm_temperature', sa.Float(), default=0.2),
        sa.Column('llm_max_tokens', sa.Integer(), nullable=True),
        sa.Column('smtp_host', sa.String(), nullable=True),
        sa.Column('smtp_port', sa.Integer(), default=465),
        sa.Column('smtp_username', sa.String(), nullable=True),
        sa.Column('smtp_password', sa.String(), nullable=True),
        sa.Column('mail_from', sa.String(), nullable=True),
        sa.Column('mail_from_name', sa.String(), default='招聘系统'),
        sa.Column('mail_enabled', sa.Boolean(), default=False),
        sa.Column('frontend_url', sa.String(), default='http://localhost:5173'),
        sa.Column('prompt_configs', sa.JSON(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), default=sa.text('now()'), onupdate=sa.text('now()')),
    )


def downgrade():
    op.drop_table('system_configs')