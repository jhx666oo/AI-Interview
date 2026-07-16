from sqlalchemy import Column, String, Boolean, DateTime, Text, Enum, JSON, Integer, ForeignKey, Float
from sqlalchemy.dialects.postgresql import UUID, ARRAY
import uuid
from datetime import datetime
from app.models.base import Base
import enum
from sqlalchemy.orm import relationship


class WorkflowStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class ExecutionStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class NodeType(str, enum.Enum):
    START = "start"
    END = "end"
    LLM = "llm"
    CONDITION = "condition"
    TOOL = "tool"
    HTTP_REQUEST = "http_request"
    EMAIL = "email"
    DATABASE = "database"
    CODE = "code"
    VARIABLE = "variable"
    LOOP = "loop"
    PARALLEL = "parallel"
    HUMAN_INPUT = "human_input"


class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    description = Column(Text)
    status = Column(Enum(WorkflowStatus), default=WorkflowStatus.DRAFT)
    
    graph = Column(JSON, default=dict)
    variables = Column(JSON, default=dict)
    
    trigger_type = Column(String, default="manual")
    trigger_config = Column(JSON, default=dict)
    
    is_template = Column(Boolean, default=False)
    is_system = Column(Boolean, default=False)
    
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    published_at = Column(DateTime)
    
    creator = relationship("User")
    executions = relationship("WorkflowExecution", back_populates="workflow")


class WorkflowNode(Base):
    __tablename__ = "workflow_nodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("workflows.id"), nullable=False)
    
    node_id = Column(String, nullable=False)
    node_type = Column(Enum(NodeType), nullable=False)
    name = Column(String)
    description = Column(Text)
    
    position_x = Column(Float, default=0)
    position_y = Column(Float, default=0)
    
    config = Column(JSON, default=dict)
    input_schema = Column(JSON, default=dict)
    output_schema = Column(JSON, default=dict)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WorkflowEdge(Base):
    __tablename__ = "workflow_edges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("workflows.id"), nullable=False)
    
    edge_id = Column(String, nullable=False)
    source_node_id = Column(String, nullable=False)
    target_node_id = Column(String, nullable=False)
    source_handle = Column(String)
    target_handle = Column(String)
    
    condition = Column(JSON, default=dict)
    label = Column(String)
    
    created_at = Column(DateTime, default=datetime.utcnow)


class WorkflowExecution(Base):
    __tablename__ = "workflow_executions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("workflows.id"), nullable=False)
    
    status = Column(Enum(ExecutionStatus), default=ExecutionStatus.PENDING)
    trigger_type = Column(String, default="manual")
    triggered_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    
    input_data = Column(JSON, default=dict)
    output_data = Column(JSON, default=dict)
    variables = Column(JSON, default=dict)
    
    current_node_id = Column(String)
    executed_nodes = Column(JSON, default=list)
    
    started_at = Column(DateTime)
    completed_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    workflow = relationship("Workflow", back_populates="executions")
    trigger_user = relationship("User")
    node_executions = relationship("WorkflowNodeExecution", back_populates="execution")


class WorkflowNodeExecution(Base):
    __tablename__ = "workflow_node_executions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    execution_id = Column(UUID(as_uuid=True), ForeignKey("workflow_executions.id"), nullable=False)
    
    node_id = Column(String, nullable=False)
    node_type = Column(String, nullable=False)
    
    status = Column(String, default="pending")
    input_data = Column(JSON, default=dict)
    output_data = Column(JSON, default=dict)
    error_message = Column(Text)
    
    started_at = Column(DateTime)
    completed_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    execution = relationship("WorkflowExecution", back_populates="node_executions")