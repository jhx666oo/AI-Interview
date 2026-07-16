from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID
from enum import Enum


class WorkflowStatus(str, Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class ExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class NodeType(str, Enum):
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


class Position(BaseModel):
    x: float = 0
    y: float = 0


class NodeData(BaseModel):
    label: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


class WorkflowNode(BaseModel):
    id: str
    type: NodeType
    position: Position = Position()
    data: Optional[NodeData] = None


class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


class WorkflowGraph(BaseModel):
    nodes: List[WorkflowNode] = []
    edges: List[WorkflowEdge] = []


class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    graph: Optional[WorkflowGraph] = None
    variables: Optional[Dict[str, Any]] = None
    trigger_type: Optional[str] = "manual"
    trigger_config: Optional[Dict[str, Any]] = None


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    graph: Optional[WorkflowGraph] = None
    variables: Optional[Dict[str, Any]] = None
    trigger_type: Optional[str] = None
    trigger_config: Optional[Dict[str, Any]] = None
    status: Optional[WorkflowStatus] = None


class WorkflowResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    status: WorkflowStatus
    graph: Optional[Dict[str, Any]] = None
    variables: Optional[Dict[str, Any]] = None
    trigger_type: Optional[str] = "manual"
    trigger_config: Optional[Dict[str, Any]] = None
    is_template: bool = False
    is_system: bool = False
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    published_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class WorkflowExecutionCreate(BaseModel):
    input_data: Optional[Dict[str, Any]] = None


class NodeExecutionResponse(BaseModel):
    id: UUID
    execution_id: UUID
    node_id: str
    node_type: str
    status: str
    input_data: Optional[Dict[str, Any]] = None
    output_data: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class WorkflowExecutionResponse(BaseModel):
    id: UUID
    workflow_id: UUID
    status: ExecutionStatus
    trigger_type: Optional[str] = None
    triggered_by: Optional[UUID] = None
    input_data: Optional[Dict[str, Any]] = None
    output_data: Optional[Dict[str, Any]] = None
    variables: Optional[Dict[str, Any]] = None
    current_node_id: Optional[str] = None
    executed_nodes: Optional[List[str]] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    node_executions: Optional[List[NodeExecutionResponse]] = None

    class Config:
        from_attributes = True


class NodeTemplate(BaseModel):
    type: NodeType
    name: str
    description: str
    icon: Optional[str] = None
    category: str
    default_config: Optional[Dict[str, Any]] = None
    input_schema: Optional[Dict[str, Any]] = None
    output_schema: Optional[Dict[str, Any]] = None


NODE_TEMPLATES = [
    NodeTemplate(
        type=NodeType.START,
        name="开始",
        description="工作流开始节点",
        icon="PlayCircleOutlined",
        category="基础",
        default_config={},
    ),
    NodeTemplate(
        type=NodeType.END,
        name="结束",
        description="工作流结束节点",
        icon="StopOutlined",
        category="基础",
        default_config={},
    ),
    NodeTemplate(
        type=NodeType.LLM,
        name="LLM",
        description="调用大语言模型",
        icon="RobotOutlined",
        category="AI",
        default_config={
            "model": "default",
            "system_prompt": "",
            "user_prompt": "",
            "temperature": 0.7,
            "max_tokens": 2000,
        },
    ),
    NodeTemplate(
        type=NodeType.CONDITION,
        name="条件判断",
        description="根据条件分支",
        icon="ForkOutlined",
        category="逻辑",
        default_config={
            "conditions": [],
            "default_branch": "default",
        },
    ),
    NodeTemplate(
        type=NodeType.TOOL,
        name="工具调用",
        description="调用内置工具",
        icon="ToolOutlined",
        category="工具",
        default_config={
            "tool_name": "",
            "config": {},
        },
    ),
    NodeTemplate(
        type=NodeType.HTTP_REQUEST,
        name="HTTP请求",
        description="发送HTTP请求",
        icon="ApiOutlined",
        category="网络",
        default_config={
            "url": "",
            "method": "GET",
            "headers": {},
            "body": "",
        },
    ),
    NodeTemplate(
        type=NodeType.EMAIL,
        name="发送邮件",
        description="发送电子邮件",
        icon="MailOutlined",
        category="通知",
        default_config={
            "to": "",
            "subject": "",
            "body": "",
            "html_body": "",
        },
    ),
    NodeTemplate(
        type=NodeType.VARIABLE,
        name="变量设置",
        description="设置或修改变量",
        icon="SettingOutlined",
        category="数据",
        default_config={
            "variables": {},
        },
    ),
    NodeTemplate(
        type=NodeType.LOOP,
        name="循环",
        description="遍历数组元素",
        icon="SyncOutlined",
        category="逻辑",
        default_config={
            "items_path": "",
        },
    ),
    NodeTemplate(
        type=NodeType.CODE,
        name="代码执行",
        description="执行Python代码",
        icon="CodeOutlined",
        category="高级",
        default_config={
            "language": "python",
            "code": "# input: 输入数据\n# variables: 当前变量\n# 设置 output 作为输出\noutput = input",
        },
    ),
    NodeTemplate(
        type=NodeType.HUMAN_INPUT,
        name="人工审批",
        description="等待人工输入或审批",
        icon="UserOutlined",
        category="交互",
        default_config={
            "prompt": "请审批此操作",
            "timeout": 86400,
        },
    ),
]