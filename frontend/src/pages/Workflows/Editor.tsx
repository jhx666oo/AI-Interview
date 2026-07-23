import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Button, Space, Typography, message, Modal, Form, Input, Select,
  Drawer, Spin, Tooltip, Popconfirm, Tag, Divider, InputNumber, Collapse, Timeline, Empty
} from 'antd';
import {
  SaveOutlined, PlayCircleOutlined, SettingOutlined,
  PlayCircleFilled, StopFilled, RobotOutlined, ForkOutlined, ToolOutlined,
  ApiOutlined, MailOutlined, SettingFilled, SyncOutlined, CodeOutlined,
  UserOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import ReactFlow, {
  Controls, Background, MiniMap,
  addEdge, useNodesState, useEdgesState,
  MarkerType, Handle, Position
} from 'reactflow';
import type { Node, Edge, Connection, NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import request from '../../utils/request';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;
const { Panel } = Collapse;

interface NodeExecution {
  id: string;
  node_id: string;
  node_type: string;
  status: string;
  input_data: any;
  output_data: any;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface ExecutionResult {
  id: string;
  status: string;
  input_data: any;
  output_data: any;
  node_executions: NodeExecution[];
  started_at: string | null;
  completed_at: string | null;
}

const nodeCategories = {
  basic: [
    { type: 'start', name: '开始', icon: <PlayCircleFilled />, color: '#52c41a' },
    { type: 'end', name: '结束', icon: <StopFilled />, color: '#ff4d4f' },
  ],
  ai: [
    { type: 'llm', name: 'LLM', icon: <RobotOutlined />, color: '#1890ff' },
  ],
  logic: [
    { type: 'condition', name: '条件判断', icon: <ForkOutlined />, color: '#722ed1' },
    { type: 'loop', name: '循环', icon: <SyncOutlined />, color: '#13c2c2' },
  ],
  tool: [
    { type: 'tool', name: '工具调用', icon: <ToolOutlined />, color: '#fa8c16' },
    { type: 'http_request', name: 'HTTP请求', icon: <ApiOutlined />, color: '#2f54eb' },
    { type: 'email', name: '发送邮件', icon: <MailOutlined />, color: '#eb2f96' },
  ],
  data: [
    { type: 'variable', name: '变量设置', icon: <SettingFilled />, color: '#595959' },
    { type: 'code', name: '代码执行', icon: <CodeOutlined />, color: '#531dab' },
  ],
  interaction: [
    { type: 'human_input', name: '人工审批', icon: <UserOutlined />, color: '#f5222d' },
  ],
};

const statusMap: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  published: { text: '已发布', color: 'green' },
  archived: { text: '已归档', color: 'red' },
};

const executionStatusMap: Record<string, { text: string; color: string; icon: React.ReactNode }> = {
  pending: { text: '等待中', color: '#8c8c8c', icon: <ClockCircleOutlined /> },
  running: { text: '执行中', color: '#1890ff', icon: <LoadingOutlined spin /> },
  completed: { text: '已完成', color: '#52c41a', icon: <CheckCircleOutlined /> },
  failed: { text: '失败', color: '#ff4d4f', icon: <CloseCircleOutlined /> },
};

const CustomNode: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeInfo = Object.values(nodeCategories).flat().find(n => n.type === data.nodeType);
  const color = nodeInfo?.color || '#1890ff';
  
  return (
    <div
      style={{
        padding: '12px 20px',
        borderRadius: 8,
        border: `2px solid ${selected ? '#1890ff' : color}`,
        backgroundColor: '#fff',
        boxShadow: selected ? '0 0 0 2px rgba(24,144,255,0.2)' : '0 2px 8px rgba(0,0,0,0.1)',
        minWidth: 150,
      }}
    >
      {data.nodeType !== 'start' && (
        <Handle type="target" position={Position.Top} style={{ background: color }} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color, fontSize: 18 }}>{nodeInfo?.icon}</span>
        <span style={{ fontWeight: 500 }}>{data.label}</span>
      </div>
      {data.nodeType !== 'end' && (
        <Handle type="source" position={Position.Bottom} style={{ background: color }} />
      )}
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

const WorkflowEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [workflow, setWorkflow] = useState<any>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [nodeDrawerVisible, setNodeDrawerVisible] = useState(false);
  const [settingsDrawerVisible, setSettingsDrawerVisible] = useState(false);
  const [nodeConfig, setNodeConfig] = useState<any>({});
  const [settingsForm] = Form.useForm();
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [executionModalVisible, setExecutionModalVisible] = useState(false);
  const reactFlowWrapper = useRef<any>(null);

  useEffect(() => {
    if (id) {
      fetchWorkflow();
    }
  }, [id]);

  const fetchWorkflow = async () => {
    setLoading(true);
    try {
      const res = await request.get(`/workflows/${id}`);
      setWorkflow(res);
      settingsForm.setFieldsValue({
        name: res.name,
        description: res.description,
        trigger_type: res.trigger_type,
        trigger_config: res.trigger_config || {},
      });
      
      const graph = res.graph || { nodes: [], edges: [] };
      const flowNodes = (graph.nodes || []).map((n: any) => ({
        id: n.id,
        type: 'custom',
        position: n.position || { x: 0, y: 0 },
        data: {
          label: n.data?.label || n.type,
          nodeType: n.type,
          config: n.data?.config || {},
        },
      }));
      const flowEdges = (graph.edges || []).map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        label: e.data?.label,
        style: { stroke: '#1890ff' },
        markerEnd: { type: MarkerType.ArrowClosed },
      }));
      
      setNodes(flowNodes);
      setEdges(flowEdges);
    } catch (e) {
      message.error('获取工作流失败');
      navigate('/workflows');
    } finally {
      setLoading(false);
    }
  };

  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) => addEdge({
      ...params,
      style: { stroke: '#1890ff' },
      markerEnd: { type: MarkerType.ArrowClosed },
    }, eds));
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/reactflow');
    if (!type) return;

    const position = {
      x: event.clientX - 250,
      y: event.clientY - 100,
    };

    const nodeInfo = Object.values(nodeCategories).flat().find(n => n.type === type);
    const newNode: Node = {
      id: `${type}_${Date.now()}`,
      type: 'custom',
      position,
      data: {
        label: nodeInfo?.name || type,
        nodeType: type,
        config: {},
      },
    };

    setNodes((nds) => [...nds, newNode]);
  }, []);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setNodeConfig(node.data.config || {});
    setNodeDrawerVisible(true);
  }, []);

  const buildGraph = () => ({
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.data.nodeType,
      position: n.position,
      data: {
        label: n.data.label,
        config: n.data.config,
      },
    })),
    edges: edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      data: { label: e.label },
    })),
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const graph = buildGraph();
      await request.put(`/workflows/${id}`, { graph });
      message.success('保存成功');
    } catch (e) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    try {
      const values = await settingsForm.validateFields();
      const graph = buildGraph();
      await request.put(`/workflows/${id}`, {
        ...values,
        graph,
      });
      message.success('设置已保存');
      setSettingsDrawerVisible(false);
      fetchWorkflow();
    } catch (e: any) {
      if (!e?.errorFields) {
        message.error(e?.response?.data?.detail || '保存失败');
      }
    } finally {
      setSettingsSaving(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await handleSave();
      await request.post(`/workflows/${id}/publish`);
      message.success('发布成功');
      fetchWorkflow();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    try {
      await handleSave();
      const res = await request.post(`/workflows/${id}/execute`);
      setExecutionResult(res);
      setExecutionModalVisible(true);
      
      if (res.status === 'completed') {
        message.success('执行成功');
      } else if (res.status === 'failed') {
        message.error('执行失败');
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '执行失败');
    } finally {
      setExecuting(false);
    }
  };

  const handleDeleteNode = () => {
    if (selectedNode) {
      setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
      setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
      setSelectedNode(null);
      setNodeDrawerVisible(false);
    }
  };

  const handleUpdateNodeConfig = () => {
    if (selectedNode) {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === selectedNode.id) {
            return {
              ...n,
              data: {
                ...n.data,
                config: nodeConfig,
              },
            };
          }
          return n;
        })
      );
      message.success('配置已更新');
    }
  };

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const getNodeLabel = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    return node?.data?.label || nodeId;
  };

  const renderNodeConfigPanel = () => {
    if (!selectedNode) return null;
    const nodeType = selectedNode.data.nodeType;

    switch (nodeType) {
      case 'llm':
        return (
          <div>
            <Form.Item label="模型">
              <Select
                value={nodeConfig.model || 'default'}
                onChange={(v) => setNodeConfig({ ...nodeConfig, model: v })}
              >
                <Option value="default">默认模型</Option>
              </Select>
            </Form.Item>
            <Form.Item label="系统提示词">
              <TextArea
                rows={3}
                value={nodeConfig.system_prompt || ''}
                onChange={(e) => setNodeConfig({ ...nodeConfig, system_prompt: e.target.value })}
                placeholder="你是一个..."
              />
            </Form.Item>
            <Form.Item label="用户提示词">
              <TextArea
                rows={4}
                value={nodeConfig.user_prompt || ''}
                onChange={(e) => setNodeConfig({ ...nodeConfig, user_prompt: e.target.value })}
                placeholder="使用 {{变量名}} 引用变量"
              />
            </Form.Item>
            <Form.Item label="温度">
              <InputNumber
                min={0} max={2} step={0.1}
                value={nodeConfig.temperature ?? 0.7}
                onChange={(v) => setNodeConfig({ ...nodeConfig, temperature: v })}
              />
            </Form.Item>
          </div>
        );
      case 'condition':
        return (
          <div>
            <Form.Item label="条件表达式">
              <TextArea
                rows={3}
                value={JSON.stringify(nodeConfig.conditions || [], null, 2)}
                onChange={(e) => {
                  try { setNodeConfig({ ...nodeConfig, conditions: JSON.parse(e.target.value) }); } catch {}
                }}
                placeholder='[{"variable": "count", "operator": ">", "value": 0, "target": "yes"}]'
              />
            </Form.Item>
            <Form.Item label="默认分支">
              <Input
                value={nodeConfig.default_branch || 'default'}
                onChange={(e) => setNodeConfig({ ...nodeConfig, default_branch: e.target.value })}
              />
            </Form.Item>
          </div>
        );
      case 'tool':
        return (
          <div>
            <Form.Item label="工具名称">
              <Select
                value={nodeConfig.tool_name || ''}
                onChange={(v) => setNodeConfig({ ...nodeConfig, tool_name: v })}
              >
                <Option value="query_resumes">查询简历</Option>
                <Option value="create_department_review">创建部门评审</Option>
                <Option value="send_email">发送邮件</Option>
                <Option value="update_resume_status">更新简历状态</Option>
                <Option value="get_position_info">获取岗位信息</Option>
                <Option value="get_users">获取用户列表</Option>
              </Select>
            </Form.Item>
            <Form.Item label="配置参数">
              <TextArea
                rows={6}
                value={JSON.stringify(nodeConfig.config || {}, null, 2)}
                onChange={(e) => {
                  try { setNodeConfig({ ...nodeConfig, config: JSON.parse(e.target.value) }); } catch {}
                }}
                placeholder='{"status": "pending_review"}'
              />
            </Form.Item>
          </div>
        );
      case 'email':
        return (
          <div>
            <Form.Item label="收件人">
              <Input
                value={nodeConfig.to || ''}
                onChange={(e) => setNodeConfig({ ...nodeConfig, to: e.target.value })}
                placeholder="邮箱地址或 {{变量}}"
              />
            </Form.Item>
            <Form.Item label="主题">
              <Input
                value={nodeConfig.subject || ''}
                onChange={(e) => setNodeConfig({ ...nodeConfig, subject: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="HTML内容">
              <TextArea
                rows={6}
                value={nodeConfig.html_body || ''}
                onChange={(e) => setNodeConfig({ ...nodeConfig, html_body: e.target.value })}
                placeholder="<p>邮件内容...</p>"
              />
            </Form.Item>
          </div>
        );
      case 'variable':
        return (
          <div>
            <Form.Item label="变量定义">
              <TextArea
                rows={6}
                value={JSON.stringify(nodeConfig.variables || {}, null, 2)}
                onChange={(e) => {
                  try { setNodeConfig({ ...nodeConfig, variables: JSON.parse(e.target.value) }); } catch {}
                }}
                placeholder='{"key": "value"}'
              />
            </Form.Item>
          </div>
        );
      case 'code':
        return (
          <div>
            <Form.Item label="Python代码">
              <TextArea
                rows={10}
                value={nodeConfig.code || ''}
                onChange={(e) => setNodeConfig({ ...nodeConfig, code: e.target.value })}
                placeholder="# input: 输入数据&#10;# variables: 当前变量&#10;output = input"
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
          </div>
        );
      case 'http_request':
        return (
          <div>
            <Form.Item label="URL">
              <Input
                value={nodeConfig.url || ''}
                onChange={(e) => setNodeConfig({ ...nodeConfig, url: e.target.value })}
                placeholder="https://api.example.com"
              />
            </Form.Item>
            <Form.Item label="方法">
              <Select
                value={nodeConfig.method || 'GET'}
                onChange={(v) => setNodeConfig({ ...nodeConfig, method: v })}
              >
                <Option value="GET">GET</Option>
                <Option value="POST">POST</Option>
                <Option value="PUT">PUT</Option>
                <Option value="DELETE">DELETE</Option>
              </Select>
            </Form.Item>
            <Form.Item label="请求头">
              <TextArea
                rows={3}
                value={JSON.stringify(nodeConfig.headers || {}, null, 2)}
                onChange={(e) => {
                  try { setNodeConfig({ ...nodeConfig, headers: JSON.parse(e.target.value) }); } catch {}
                }}
                placeholder='{"Content-Type": "application/json"}'
              />
            </Form.Item>
            <Form.Item label="请求体">
              <TextArea
                rows={4}
                value={nodeConfig.body || ''}
                onChange={(e) => setNodeConfig({ ...nodeConfig, body: e.target.value })}
              />
            </Form.Item>
          </div>
        );
      case 'human_input':
        return (
          <div>
            <Form.Item label="提示信息">
              <TextArea
                rows={3}
                value={nodeConfig.prompt || ''}
                onChange={(e) => setNodeConfig({ ...nodeConfig, prompt: e.target.value })}
                placeholder="请审批此操作"
              />
            </Form.Item>
            <Form.Item label="超时时间(秒)">
              <InputNumber
                min={60}
                value={nodeConfig.timeout || 86400}
                onChange={(v) => setNodeConfig({ ...nodeConfig, timeout: v })}
              />
            </Form.Item>
          </div>
        );
      default:
        return <Text type="secondary">此节点无需配置</Text>;
    }
  };

  const renderExecutionModal = () => {
    if (!executionResult) return null;

    const statusInfo = executionStatusMap[executionResult.status] || executionStatusMap.pending;

    return (
      <Modal
        title={
          <Space>
            <span>执行结果</span>
            <Tag color={statusInfo.color} icon={statusInfo.icon}>
              {statusInfo.text}
            </Tag>
          </Space>
        }
        open={executionModalVisible}
        onCancel={() => setExecutionModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setExecutionModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={800}
      >
        <div style={{ marginBottom: 16 }}>
          <Space split={<Divider type="vertical" />}>
            <Text type="secondary">
              开始时间: {executionResult.started_at ? new Date(executionResult.started_at).toLocaleString() : '-'}
            </Text>
            <Text type="secondary">
              结束时间: {executionResult.completed_at ? new Date(executionResult.completed_at).toLocaleString() : '-'}
            </Text>
          </Space>
        </div>

        {executionResult.node_executions && executionResult.node_executions.length > 0 ? (
          <Collapse
            accordion
            defaultActiveKey={executionResult.node_executions[0]?.id}
            style={{ maxHeight: 500, overflow: 'auto' }}
          >
            {executionResult.node_executions.map((nodeExec, index) => {
              const nodeStatus = executionStatusMap[nodeExec.status] || executionStatusMap.pending;
              const nodeLabel = getNodeLabel(nodeExec.node_id);
              
              return (
                <Panel
                  key={nodeExec.id}
                  header={
                    <Space>
                      <Tag color={nodeStatus.color} icon={nodeStatus.icon}>
                        {nodeStatus.text}
                      </Tag>
                      <Text strong>{nodeLabel}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        ({nodeExec.node_type})
                      </Text>
                    </Space>
                  }
                >
                  {nodeExec.error_message && (
                    <div style={{ marginBottom: 12, padding: 12, background: '#fff2f0', borderRadius: 6, border: '1px solid #ffccc7' }}>
                      <Text type="danger">{nodeExec.error_message}</Text>
                    </div>
                  )}
                  
                  <div style={{ marginBottom: 12 }}>
                    <Text strong>输入数据</Text>
                    <pre style={{
                      background: '#f5f5f5',
                      padding: 12,
                      borderRadius: 6,
                      fontSize: 12,
                      maxHeight: 200,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}>
                      {nodeExec.input_data ? JSON.stringify(nodeExec.input_data, null, 2) : '无'}
                    </pre>
                  </div>
                  
                  <div>
                    <Text strong>输出数据</Text>
                    <pre style={{
                      background: '#f5f5f5',
                      padding: 12,
                      borderRadius: 6,
                      fontSize: 12,
                      maxHeight: 200,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}>
                      {nodeExec.output_data ? JSON.stringify(nodeExec.output_data, null, 2) : '无'}
                    </pre>
                  </div>
                </Panel>
              );
            })}
          </Collapse>
        ) : (
          <Empty description="无执行记录" />
        )}

        {executionResult.output_data && (
          <div style={{ marginTop: 16 }}>
            <Text strong>最终输出</Text>
            <pre style={{
              background: '#e6f7ff',
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              maxHeight: 200,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {JSON.stringify(executionResult.output_data, null, 2)}
            </pre>
          </div>
        )}
      </Modal>
    );
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 500 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ height: 'calc(100vh - 150px)', display: 'flex' }}>
      <div style={{ width: 240, borderRight: '1px solid #f0f0f0', overflow: 'auto', padding: 16 }}>
        <Title level={5}>节点库</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>拖拽节点到画布</Text>
        
        {Object.entries(nodeCategories).map(([category, categoryNodes]) => (
          <div key={category} style={{ marginTop: 16 }}>
            <Text strong style={{ textTransform: 'capitalize' }}>
              {category === 'basic' ? '基础' : 
               category === 'ai' ? 'AI' :
               category === 'logic' ? '逻辑' :
               category === 'tool' ? '工具' :
               category === 'data' ? '数据' :
               category === 'interaction' ? '交互' : category}
            </Text>
            <div style={{ marginTop: 8 }}>
              {categoryNodes.map((node) => (
                <div
                  key={node.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, node.type)}
                  style={{
                    padding: '8px 12px',
                    marginBottom: 8,
                    borderRadius: 6,
                    border: `1px solid ${node.color}40`,
                    backgroundColor: `${node.color}10`,
                    cursor: 'grab',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ color: node.color }}>{node.icon}</span>
                  <span>{node.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Space>
            <Button onClick={() => navigate('/workflows')}>返回</Button>
            <Title level={4} style={{ margin: 0 }}>{workflow?.name}</Title>
            <Tag color={statusMap[workflow?.status]?.color || 'default'}>
              {statusMap[workflow?.status]?.text || workflow?.status}
            </Tag>
          </Space>
          <Space>
            <Tooltip title="工作流设置">
              <Button icon={<SettingOutlined />} onClick={() => setSettingsDrawerVisible(true)}>
                设置
              </Button>
            </Tooltip>
            <Button icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
              保存
            </Button>
            {workflow?.status !== 'published' && (
              <Button type="primary" onClick={handlePublish} loading={publishing}>
                发布
              </Button>
            )}
            {workflow?.status === 'published' && (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleExecute} loading={executing}>
                执行
              </Button>
            )}
          </Space>
        </div>

        <div style={{ flex: 1 }} ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
          >
            <Background color="#f0f0f0" gap={15} />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
      </div>

      <Drawer
        title={
          <Space>
            <span>节点配置</span>
            {selectedNode && <Tag>{selectedNode.data.label}</Tag>}
          </Space>
        }
        placement="right"
        width={400}
        open={nodeDrawerVisible}
        onClose={() => setNodeDrawerVisible(false)}
        extra={
          <Space>
            <Button type="primary" onClick={handleUpdateNodeConfig}>
              应用
            </Button>
            <Popconfirm title="删除此节点？" onConfirm={handleDeleteNode}>
              <Button danger>删除</Button>
            </Popconfirm>
          </Space>
        }
      >
        {selectedNode && (
          <Form layout="vertical">
            <Form.Item label="节点名称">
              <Input
                value={selectedNode.data.label}
                onChange={(e) => {
                  setNodes((nds) =>
                    nds.map((n) => {
                      if (n.id === selectedNode.id) {
                        return { ...n, data: { ...n.data, label: e.target.value } };
                      }
                      return n;
                    })
                  );
                }}
              />
            </Form.Item>
            <Divider />
            {renderNodeConfigPanel()}
          </Form>
        )}
      </Drawer>

      <Drawer
        title="工作流设置"
        placement="right"
        width={400}
        open={settingsDrawerVisible}
        onClose={() => setSettingsDrawerVisible(false)}
        extra={
          <Button type="primary" onClick={handleSaveSettings} loading={settingsSaving}>
            保存设置
          </Button>
        }
      >
        <Form form={settingsForm} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="工作流名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={3} placeholder="工作流描述" />
          </Form.Item>
          <Form.Item name="trigger_type" label="触发方式">
            <Select>
              <Option value="manual">手动触发</Option>
              <Option value="scheduled">定时触发</Option>
              <Option value="webhook">Webhook</Option>
            </Select>
          </Form.Item>
          <Form.Item 
            name={['trigger_config', 'cron']} 
            label="Cron表达式"
            extra="定时触发时使用，如：0 * * * * 表示每小时执行"
          >
            <Input placeholder="0 * * * *" />
          </Form.Item>
        </Form>
      </Drawer>

      {renderExecutionModal()}
    </div>
  );
};

export default WorkflowEditor;