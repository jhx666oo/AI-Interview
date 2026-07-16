"""create workflow tables

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f7
Create Date: 2024-01-16 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b2c3d4e5f6a8'
down_revision = 'g7h8i9j0k1l2'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'workflows',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.Enum('draft', 'published', 'archived', name='workflowstatus'), nullable=True, default='draft'),
        sa.Column('graph', sa.JSON(), nullable=True, default=dict),
        sa.Column('variables', sa.JSON(), nullable=True, default=dict),
        sa.Column('trigger_type', sa.String(), default='manual'),
        sa.Column('trigger_config', sa.JSON(), nullable=True, default=dict),
        sa.Column('is_template', sa.Boolean(), default=False),
        sa.Column('is_system', sa.Boolean(), default=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), default=sa.text('now()'), onupdate=sa.text('now()')),
        sa.Column('published_at', sa.DateTime(), nullable=True),
    )
    
    op.create_table(
        'workflow_nodes',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=sa.text('gen_random_uuid()')),
        sa.Column('workflow_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('workflows.id'), nullable=False),
        sa.Column('node_id', sa.String(), nullable=False),
        sa.Column('node_type', sa.Enum('start', 'end', 'llm', 'condition', 'tool', 'http_request', 'email', 'database', 'code', 'variable', 'loop', 'parallel', 'human_input', name='nodetype'), nullable=False),
        sa.Column('name', sa.String(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('position_x', sa.Float(), default=0),
        sa.Column('position_y', sa.Float(), default=0),
        sa.Column('config', sa.JSON(), nullable=True, default=dict),
        sa.Column('input_schema', sa.JSON(), nullable=True, default=dict),
        sa.Column('output_schema', sa.JSON(), nullable=True, default=dict),
        sa.Column('created_at', sa.DateTime(), default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), default=sa.text('now()'), onupdate=sa.text('now()')),
    )
    
    op.create_table(
        'workflow_edges',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=sa.text('gen_random_uuid()')),
        sa.Column('workflow_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('workflows.id'), nullable=False),
        sa.Column('edge_id', sa.String(), nullable=False),
        sa.Column('source_node_id', sa.String(), nullable=False),
        sa.Column('target_node_id', sa.String(), nullable=False),
        sa.Column('source_handle', sa.String(), nullable=True),
        sa.Column('target_handle', sa.String(), nullable=True),
        sa.Column('condition', sa.JSON(), nullable=True, default=dict),
        sa.Column('label', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), default=sa.text('now()')),
    )
    
    op.create_table(
        'workflow_executions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=sa.text('gen_random_uuid()')),
        sa.Column('workflow_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('workflows.id'), nullable=False),
        sa.Column('status', sa.Enum('pending', 'running', 'completed', 'failed', 'cancelled', name='workflowexecutionstatus'), nullable=True, default='pending'),
        sa.Column('trigger_type', sa.String(), default='manual'),
        sa.Column('triggered_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('input_data', sa.JSON(), nullable=True, default=dict),
        sa.Column('output_data', sa.JSON(), nullable=True, default=dict),
        sa.Column('variables', sa.JSON(), nullable=True, default=dict),
        sa.Column('current_node_id', sa.String(), nullable=True),
        sa.Column('executed_nodes', sa.JSON(), nullable=True, default=list),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), default=sa.text('now()')),
    )
    
    op.create_table(
        'workflow_node_executions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=sa.text('gen_random_uuid()')),
        sa.Column('execution_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('workflow_executions.id'), nullable=False),
        sa.Column('node_id', sa.String(), nullable=False),
        sa.Column('node_type', sa.String(), nullable=False),
        sa.Column('status', sa.String(), default='pending'),
        sa.Column('input_data', sa.JSON(), nullable=True, default=dict),
        sa.Column('output_data', sa.JSON(), nullable=True, default=dict),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), default=sa.text('now()')),
    )


def downgrade():
    op.drop_table('workflow_node_executions')
    op.drop_table('workflow_executions')
    op.drop_table('workflow_edges')
    op.drop_table('workflow_nodes')
    op.drop_table('workflows')
    
    op.execute('DROP TYPE IF EXISTS workflowexecutionstatus')
    op.execute('DROP TYPE IF EXISTS nodetype')
    op.execute('DROP TYPE IF EXISTS workflowstatus')