import json
import logging
import httpx
from datetime import datetime
from typing import Dict, Any, List, Optional, Callable
from uuid import UUID
from sqlalchemy.orm import Session, joinedload

from app.models.workflow_models import (
    Workflow, WorkflowNode, WorkflowEdge, WorkflowExecution, WorkflowNodeExecution,
    WorkflowStatus, ExecutionStatus, NodeType
)
from app.models.models import Resume, Position, User, DepartmentReview, SystemConfig, ResumeStatus, UserRole
from app.services.ai_service import _get_client, _get_llm_config, _get_extra_body
from app.services.mail_service import MailService

logger = logging.getLogger(__name__)


class NodeExecutor:
    def __init__(self, db: Session, execution: WorkflowExecution, variables: Dict[str, Any]):
        self.db = db
        self.execution = execution
        self.variables = variables
        self.mail_service = MailService(db)
    
    def execute(self, node_type: NodeType, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        executor_map = {
            NodeType.START: self._execute_start,
            NodeType.END: self._execute_end,
            NodeType.LLM: self._execute_llm,
            NodeType.CONDITION: self._execute_condition,
            NodeType.TOOL: self._execute_tool,
            NodeType.HTTP_REQUEST: self._execute_http,
            NodeType.EMAIL: self._execute_email,
            NodeType.DATABASE: self._execute_database,
            NodeType.CODE: self._execute_code,
            NodeType.VARIABLE: self._execute_variable,
            NodeType.LOOP: self._execute_loop,
            NodeType.PARALLEL: self._execute_parallel,
            NodeType.HUMAN_INPUT: self._execute_human_input,
        }
        
        executor = executor_map.get(node_type)
        if not executor:
            raise ValueError(f"Unknown node type: {node_type}")
        
        return executor(config, input_data)
    
    def _resolve_variables(self, text: str) -> str:
        if not text:
            return text
        
        import re
        pattern = r'\{\{([^}]+)\}\}'
        
        def replace(match):
            var_path = match.group(1).strip()
            value = self._get_variable(var_path)
            return str(value) if value is not None else match.group(0)
        
        return re.sub(pattern, replace, text)
    
    def _get_variable(self, path: str) -> Any:
        parts = path.split('.')
        value = self.variables
        
        for part in parts:
            if isinstance(value, dict):
                value = value.get(part)
            elif isinstance(value, list) and part.isdigit():
                idx = int(part)
                value = value[idx] if idx < len(value) else None
            else:
                return None
        
        return value
    
    def _execute_start(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        return {"output": input_data}
    
    def _execute_end(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        output_key = config.get("output_key", "result")
        return {"output": input_data.get(output_key, input_data)}
    
    def _execute_llm(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        model = config.get("model", "default")
        system_prompt = self._resolve_variables(config.get("system_prompt", ""))
        user_prompt = self._resolve_variables(config.get("user_prompt", ""))
        temperature = config.get("temperature", 0.7)
        max_tokens = config.get("max_tokens", 2000)
        
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        if user_prompt:
            messages.append({"role": "user", "content": user_prompt})
        
        if not messages:
            messages.append({"role": "user", "content": str(input_data)})
        
        try:
            cfg = _get_llm_config()
            extra = {"temperature": temperature}
            if max_tokens:
                extra["max_tokens"] = max_tokens
            
            completion = _get_client().chat.completions.create(
                model=cfg["llm_model"] if model == "default" else model,
                messages=messages,
                extra_body=_get_extra_body(),
                **extra,
            )
            
            response_content = completion.choices[0].message.content
            
            output_format = config.get("output_format", "text")
            if output_format == "json":
                try:
                    return {"output": json.loads(response_content), "raw": response_content}
                except json.JSONDecodeError:
                    return {"output": response_content, "raw": response_content, "parse_error": True}
            
            return {"output": response_content}
            
        except Exception as e:
            logger.error(f"LLM execution failed: {e}")
            raise
    
    def _execute_condition(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        conditions = config.get("conditions", [])
        
        for condition in conditions:
            var_path = condition.get("variable")
            operator = condition.get("operator", "==")
            value = condition.get("value")
            target_branch = condition.get("target", "default")
            
            var_value = self._get_variable(var_path) if var_path else input_data
            
            if self._evaluate_condition(var_value, operator, value):
                return {"branch": target_branch, "matched": True}
        
        return {"branch": config.get("default_branch", "default"), "matched": False}
    
    def _evaluate_condition(self, var_value: Any, operator: str, target_value: Any) -> bool:
        if operator == "==":
            return str(var_value) == str(target_value)
        elif operator == "!=":
            return str(var_value) != str(target_value)
        elif operator == ">":
            try:
                return float(var_value) > float(target_value)
            except (ValueError, TypeError):
                return False
        elif operator == ">=":
            try:
                return float(var_value) >= float(target_value)
            except (ValueError, TypeError):
                return False
        elif operator == "<":
            try:
                return float(var_value) < float(target_value)
            except (ValueError, TypeError):
                return False
        elif operator == "<=":
            try:
                return float(var_value) <= float(target_value)
            except (ValueError, TypeError):
                return False
        elif operator == "contains":
            return str(target_value) in str(var_value)
        elif operator == "not_contains":
            return str(target_value) not in str(var_value)
        elif operator == "is_empty":
            return not var_value
        elif operator == "is_not_empty":
            return bool(var_value)
        elif operator == "is_true":
            return bool(var_value) is True
        elif operator == "is_false":
            return bool(var_value) is False
        
        return False
    
    def _execute_tool(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        tool_name = config.get("tool_name")
        tool_config = config.get("config", {})
        
        tools = {
            "query_resumes": self._tool_query_resumes,
            "create_department_review": self._tool_create_department_review,
            "send_email": self._tool_send_email,
            "update_resume_status": self._tool_update_resume_status,
            "get_position_info": self._tool_get_position_info,
            "get_users": self._tool_get_users,
        }
        
        tool_func = tools.get(tool_name)
        if not tool_func:
            raise ValueError(f"Unknown tool: {tool_name}")
        
        resolved_config = {}
        for key, value in tool_config.items():
            if isinstance(value, str) and "{{" in value:
                resolved_config[key] = self._resolve_variables(value)
            else:
                resolved_config[key] = value
        
        return tool_func(resolved_config, input_data)
    
    def _tool_query_resumes(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        status = config.get("status")
        position_id = config.get("position_id")
        min_match_score = config.get("min_match_score", 0)
        limit = config.get("limit", 100)
        
        query = self.db.query(Resume).options(joinedload(Resume.position))
        
        if status:
            query = query.filter(Resume.status == status)
        if position_id:
            query = query.filter(Resume.position_id == position_id)
        if min_match_score:
            query = query.filter(Resume.match_score >= min_match_score)
        
        resumes = query.limit(limit).all()
        
        resume_list = [
            {
                "id": str(r.id),
                "candidate_name": r.candidate_name,
                "email": r.email,
                "contact": r.contact,
                "match_score": r.match_score,
                "status": r.status.value if r.status else None,
                "position_id": str(r.position_id) if r.position_id else None,
                "position_title": r.position.title if r.position else None,
            }
            for r in resumes
        ]
        
        return {
            "output": {
                "resumes": resume_list,
                "count": len(resumes)
            }
        }
    
    def _tool_create_department_review(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        resume_id = config.get("resume_id")
        reviewer_id = config.get("reviewer_id")
        
        if not resume_id or not reviewer_id:
            raise ValueError("resume_id and reviewer_id are required")
        
        resume = self.db.query(Resume).filter(Resume.id == resume_id).first()
        if not resume:
            raise ValueError(f"Resume not found: {resume_id}")
        
        existing = self.db.query(DepartmentReview).filter(
            DepartmentReview.resume_id == resume_id,
            DepartmentReview.reviewer_id == reviewer_id
        ).first()
        
        if existing:
            return {"output": {"review_id": str(existing.id), "already_exists": True}}
        
        review = DepartmentReview(
            resume_id=resume_id,
            reviewer_id=reviewer_id,
            is_completed=False
        )
        self.db.add(review)
        resume.status = ResumeStatus.PENDING_DEPT_REVIEW
        self.db.commit()
        self.db.refresh(review)
        
        return {"output": {"review_id": str(review.id), "already_exists": False}}
    
    def _tool_send_email(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        to_email = config.get("to")
        subject = config.get("subject", "")
        body = config.get("body", "")
        html_body = config.get("html_body")
        
        if not to_email:
            raise ValueError("Email recipient (to) is required")
        
        if html_body:
            content = self._resolve_variables(html_body)
            sent = self.mail_service._send_email(to_email, subject, content)
        else:
            content = self._resolve_variables(body)
            sent = self.mail_service._send_email(to_email, subject, f"<pre>{content}</pre>")
        
        return {"output": {"sent": sent, "to": to_email}}
    
    def _tool_update_resume_status(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        resume_id = config.get("resume_id")
        new_status = config.get("status")
        
        if not resume_id or not new_status:
            raise ValueError("resume_id and status are required")
        
        resume = self.db.query(Resume).filter(Resume.id == resume_id).first()
        if not resume:
            raise ValueError(f"Resume not found: {resume_id}")
        
        try:
            resume.status = ResumeStatus(new_status)
            self.db.commit()
            return {"output": {"success": True, "new_status": new_status}}
        except ValueError as e:
            raise ValueError(f"Invalid status: {new_status}")
    
    def _tool_get_position_info(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        position_id = config.get("position_id")
        
        if not position_id:
            raise ValueError("position_id is required")
        
        position = self.db.query(Position).filter(Position.id == position_id).first()
        if not position:
            raise ValueError(f"Position not found: {position_id}")
        
        return {
            "output": {
                "id": str(position.id),
                "title": position.title,
                "department": position.department,
                "hiring_manager_id": str(position.hiring_manager_id) if position.hiring_manager_id else None,
            }
        }
    
    def _tool_get_users(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        role = config.get("role")
        is_active = config.get("is_active", True)
        
        query = self.db.query(User)
        
        if role:
            query = query.filter(User.role == role)
        if is_active is not None:
            query = query.filter(User.is_active == is_active)
        
        users = query.all()
        
        return {
            "output": [
                {
                    "id": str(u.id),
                    "email": u.email,
                    "full_name": u.full_name,
                    "role": u.role.value if u.role else None,
                }
                for u in users
            ]
        }
    
    def _execute_http(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        url = self._resolve_variables(config.get("url", ""))
        method = config.get("method", "GET").upper()
        headers = config.get("headers", {})
        body = config.get("body")
        timeout = config.get("timeout", 30)
        
        resolved_headers = {}
        for key, value in headers.items():
            resolved_headers[key] = self._resolve_variables(value) if isinstance(value, str) else value
        
        resolved_body = None
        if body:
            if isinstance(body, str):
                resolved_body = self._resolve_variables(body)
            else:
                resolved_body = body
        
        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.request(
                    method=method,
                    url=url,
                    headers=resolved_headers,
                    content=resolved_body if method in ["POST", "PUT", "PATCH"] else None,
                )
            
            try:
                response_data = response.json()
            except:
                response_data = response.text
            
            return {
                "output": {
                    "status_code": response.status_code,
                    "data": response_data,
                }
            }
        except Exception as e:
            raise RuntimeError(f"HTTP request failed: {e}")
    
    def _execute_email(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        return self._tool_send_email(config, input_data)
    
    def _execute_database(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        operation = config.get("operation")
        table = config.get("table")
        data = config.get("data", {})
        filters = config.get("filters", {})
        
        return {"output": {"message": "Database operation completed", "operation": operation}}
    
    def _execute_code(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        code = config.get("code", "")
        language = config.get("language", "python")
        
        if language != "python":
            raise ValueError(f"Unsupported language: {language}")
        
        local_vars = {"input": input_data, "variables": self.variables, "output": None}
        
        try:
            exec(code, {"__builtins__": {}}, local_vars)
            return {"output": local_vars.get("output", {})}
        except Exception as e:
            raise RuntimeError(f"Code execution failed: {e}")
    
    def _execute_variable(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        variables = config.get("variables", {})
        
        output = {}
        for key, value in variables.items():
            if isinstance(value, str) and "{{" in value:
                output[key] = self._resolve_variables(value)
            else:
                output[key] = value
        
        return {"output": output}
    
    def _execute_loop(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        items_path = config.get("items_path")
        items = self._get_variable(items_path) if items_path else input_data.get("items", [])
        
        if not isinstance(items, list):
            items = [items]
        
        return {"output": {"items": items, "count": len(items)}}
    
    def _execute_parallel(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        branches = config.get("branches", [])
        return {"output": {"branches": branches}}
    
    def _execute_human_input(self, config: Dict[str, Any], input_data: Dict[str, Any]) -> Dict[str, Any]:
        prompt = config.get("prompt", "Please provide input:")
        timeout = config.get("timeout", 86400)
        
        return {
            "output": {
                "status": "waiting_for_input",
                "prompt": prompt,
                "timeout": timeout,
            }
        }


class WorkflowEngine:
    def __init__(self, db: Session):
        self.db = db
    
    def create_workflow(self, data: dict, user_id: UUID) -> Workflow:
        workflow = Workflow(
            name=data["name"],
            description=data.get("description"),
            status=WorkflowStatus.DRAFT,
            graph=data.get("graph", {"nodes": [], "edges": []}),
            variables=data.get("variables", {}),
            trigger_type=data.get("trigger_type", "manual"),
            trigger_config=data.get("trigger_config", {}),
            created_by=user_id,
        )
        self.db.add(workflow)
        self.db.commit()
        self.db.refresh(workflow)
        return workflow
    
    def get_workflow(self, workflow_id: UUID) -> Optional[Workflow]:
        return self.db.query(Workflow).filter(Workflow.id == workflow_id).first()
    
    def get_workflows(self, skip: int = 0, limit: int = 100, status: WorkflowStatus = None) -> List[Workflow]:
        query = self.db.query(Workflow)
        if status:
            query = query.filter(Workflow.status == status)
        return query.offset(skip).limit(limit).all()
    
    def update_workflow(self, workflow_id: UUID, data: dict) -> Optional[Workflow]:
        workflow = self.get_workflow(workflow_id)
        if not workflow:
            return None
        
        for key, value in data.items():
            if hasattr(workflow, key) and key not in ["id", "created_at", "created_by"]:
                setattr(workflow, key, value)
        
        self.db.commit()
        self.db.refresh(workflow)
        return workflow
    
    def delete_workflow(self, workflow_id: UUID) -> bool:
        workflow = self.get_workflow(workflow_id)
        if not workflow:
            return False
        
        if workflow.is_system:
            raise ValueError("Cannot delete system workflow")
        
        self.db.delete(workflow)
        self.db.commit()
        return True
    
    def publish_workflow(self, workflow_id: UUID) -> Optional[Workflow]:
        workflow = self.get_workflow(workflow_id)
        if not workflow:
            return None
        
        workflow.status = WorkflowStatus.PUBLISHED
        workflow.published_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(workflow)
        return workflow
    
    def execute_workflow(
        self, 
        workflow_id: UUID, 
        input_data: Dict[str, Any] = None,
        user_id: UUID = None
    ) -> WorkflowExecution:
        workflow = self.get_workflow(workflow_id)
        if not workflow:
            raise ValueError("Workflow not found")
        
        if workflow.status != WorkflowStatus.PUBLISHED:
            raise ValueError(f"Workflow is not published (status: {workflow.status})")
        
        execution = WorkflowExecution(
            workflow_id=workflow_id,
            status=ExecutionStatus.PENDING,
            input_data=input_data or {},
            variables={"input": input_data or {}},
            triggered_by=user_id,
        )
        self.db.add(execution)
        self.db.commit()
        self.db.refresh(execution)
        
        try:
            self._run_execution(execution, workflow)
        except Exception as e:
            logger.error(f"Workflow execution failed: {e}")
            execution.status = ExecutionStatus.FAILED
            execution.completed_at = datetime.utcnow()
            self.db.commit()
        
        return execution
    
    def _run_execution(self, execution: WorkflowExecution, workflow: Workflow):
        execution.status = ExecutionStatus.RUNNING
        execution.started_at = datetime.utcnow()
        self.db.commit()
        
        graph = workflow.graph or {}
        nodes = graph.get("nodes", [])
        edges = graph.get("edges", [])
        
        nodes_map = {n.get("id"): n for n in nodes}
        edges_map = {}
        for edge in edges:
            source = edge.get("source")
            if source not in edges_map:
                edges_map[source] = []
            edges_map[source].append(edge)
        
        start_node = next((n for n in nodes if n.get("type") == "start"), None)
        if not start_node:
            raise ValueError("No start node found in workflow")
        
        executor = NodeExecutor(self.db, execution, execution.variables)
        
        current_node_id = start_node.get("id")
        executed_nodes = []
        
        while current_node_id:
            node = nodes_map.get(current_node_id)
            if not node:
                break
            
            node_type = NodeType(node.get("type"))
            node_config = node.get("data", {}).get("config", {})
            
            node_execution = WorkflowNodeExecution(
                execution_id=execution.id,
                node_id=current_node_id,
                node_type=node_type.value,
                status="running",
                input_data=execution.variables,
            )
            self.db.add(node_execution)
            self.db.commit()
            
            try:
                result = executor.execute(node_type, node_config, execution.variables)
                
                node_execution.status = "completed"
                node_execution.output_data = result
                node_execution.completed_at = datetime.utcnow()
                
                if result.get("output"):
                    execution.variables.update(result.get("output", {}))
                
                executed_nodes.append(current_node_id)
                
                if node_type == NodeType.END:
                    execution.output_data = result.get("output", {})
                    break
                
                if node_type == NodeType.CONDITION:
                    branch = result.get("branch", "default")
                    next_edge = next(
                        (e for e in edges_map.get(current_node_id, []) 
                         if e.get("data", {}).get("label") == branch or e.get("sourceHandle") == branch),
                        None
                    )
                else:
                    next_edge = edges_map.get(current_node_id, [None])[0] if edges_map.get(current_node_id) else None
                
                current_node_id = next_edge.get("target") if next_edge else None
                
            except Exception as e:
                node_execution.status = "failed"
                node_execution.error_message = str(e)
                node_execution.completed_at = datetime.utcnow()
                self.db.commit()
                raise
            
            self.db.commit()
        
        execution.status = ExecutionStatus.COMPLETED
        execution.executed_nodes = executed_nodes
        execution.completed_at = datetime.utcnow()
        self.db.commit()
    
    def get_execution(self, execution_id: UUID) -> Optional[WorkflowExecution]:
        return self.db.query(WorkflowExecution).options(
            joinedload(WorkflowExecution.node_executions)
        ).filter(WorkflowExecution.id == execution_id).first()
    
    def get_executions(self, workflow_id: UUID = None, skip: int = 0, limit: int = 50) -> List[WorkflowExecution]:
        query = self.db.query(WorkflowExecution).order_by(WorkflowExecution.created_at.desc())
        if workflow_id:
            query = query.filter(WorkflowExecution.workflow_id == workflow_id)
        return query.offset(skip).limit(limit).all()


def create_builtin_workflows(db: Session):
    existing = db.query(Workflow).filter(Workflow.is_system == True).first()
    if existing:
        return
    
    resume_review_workflow = Workflow(
        name="简历审核流程",
        description="自动检测新简历，指派部门审核人，发送邮件通知，等待审核完成后通知HR",
        status=WorkflowStatus.PUBLISHED,
        is_system=True,
        trigger_type="scheduled",
        trigger_config={"cron": "0 * * * *"},
        graph={
            "nodes": [
                {"id": "start", "type": "start", "position": {"x": 100, "y": 200}, "data": {"label": "开始"}},
                {"id": "query", "type": "tool", "position": {"x": 300, "y": 200}, "data": {
                    "label": "查询新简历",
                    "config": {
                        "tool_name": "query_resumes",
                        "config": {"status": "pending_review", "min_match_score": 60}
                    }
                }},
                {"id": "condition", "type": "condition", "position": {"x": 500, "y": 200}, "data": {
                    "label": "是否有新简历",
                    "config": {
                        "conditions": [{"variable": "count", "operator": ">", "value": 0, "target": "yes"}],
                        "default_branch": "no"
                    }
                }},
                {"id": "loop", "type": "loop", "position": {"x": 700, "y": 100}, "data": {"label": "遍历简历"}},
                {"id": "get_reviewer", "type": "tool", "position": {"x": 900, "y": 100}, "data": {
                    "label": "获取审核人",
                    "config": {
                        "tool_name": "get_users",
                        "config": {"role": "interviewer", "is_active": True}
                    }
                }},
                {"id": "assign", "type": "tool", "position": {"x": 1100, "y": 100}, "data": {
                    "label": "指派审核人",
                    "config": {
                        "tool_name": "create_department_review",
                        "config": {
                            "resume_id": "{{item.id}}",
                            "reviewer_id": "{{reviewer_id}}"
                        }
                    }
                }},
                {"id": "send_email", "type": "email", "position": {"x": 1300, "y": 100}, "data": {
                    "label": "发送审核邮件",
                    "config": {
                        "to": "{{reviewer_email}}",
                        "subject": "【审核通知】新简历待审核",
                        "html_body": "<p>您好，有新简历需要审核</p>"
                    }
                }},
                {"id": "end_yes", "type": "end", "position": {"x": 1500, "y": 100}, "data": {"label": "完成"}},
                {"id": "end_no", "type": "end", "position": {"x": 700, "y": 300}, "data": {"label": "无新简历"}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "query"},
                {"id": "e2", "source": "query", "target": "condition"},
                {"id": "e3", "source": "condition", "target": "loop", "sourceHandle": "yes"},
                {"id": "e4", "source": "condition", "target": "end_no", "sourceHandle": "no"},
                {"id": "e5", "source": "loop", "target": "get_reviewer"},
                {"id": "e6", "source": "get_reviewer", "target": "assign"},
                {"id": "e7", "source": "assign", "target": "send_email"},
                {"id": "e8", "source": "send_email", "target": "end_yes"},
            ]
        },
        variables={},
    )
    db.add(resume_review_workflow)
    db.commit()
    logger.info("Created builtin resume review workflow")