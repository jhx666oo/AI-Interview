import React, { useState, useRef, useEffect } from 'react';
import { Modal, Input, Button, message, Spin, Typography, Card, Divider, Space } from 'antd';
import { SendOutlined, CheckOutlined, ReloadOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface JDGeneratorModalProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (description: string, requirements: string) => void;
  title: string;
  department?: string;
  location?: string;
  salary_range?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const JDGeneratorModal: React.FC<JDGeneratorModalProps> = ({
  visible,
  onCancel,
  onConfirm,
  title,
  department,
  location,
  salary_range,
}) => {
  const [generating, setGenerating] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatting, setChatting] = useState(false);
  const [generated, setGenerated] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible && title) {
      handleGenerate();
    }
  }, [visible, title]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamContent, chatMessages]);

  const parseJDContent = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      return {
        description: parsed.description || '',
        requirements: parsed.requirements || '',
      };
    } catch {
      return { description: '', requirements: '' };
    }
  };

  const handleGenerate = async () => {
    if (!title) {
      message.error('请先填写岗位名称');
      return;
    }

    setGenerating(true);
    setStreamContent('');
    setDescription('');
    setRequirements('');
    setChatMessages([]);
    setGenerated(false);

    try {
      const response = await fetch('/api/positions/generate-jd-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          title,
          department: department || '',
          location: location || '',
          salary_range: salary_range || '',
          keywords: '',
        }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullContent += data.content;
                setStreamContent(fullContent);
              }
              if (data.done) {
                const parsed = parseJDContent(fullContent);
                setDescription(parsed.description);
                setRequirements(parsed.requirements);
                setGenerated(true);
              }
              if (data.error) {
                message.error(data.error);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      message.error('生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim() || chatting) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setChatting(true);

    try {
      const response = await fetch('/api/positions/chat-jd-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          messages: [...chatMessages, { role: 'user', content: userMessage }].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          current_description: description,
          current_requirements: requirements,
        }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullContent += data.content;
              }
              if (data.done) {
                const parsed = parseJDContent(fullContent);
                if (parsed.description && parsed.requirements) {
                  setDescription(parsed.description);
                  setRequirements(parsed.requirements);
                }
                setChatMessages((prev) => [
                  ...prev,
                  { role: 'assistant', content: '已根据您的要求更新了岗位描述，请查看下方内容。' },
                ]);
              }
              if (data.error) {
                message.error(data.error);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      message.error('对话失败，请重试');
    } finally {
      setChatting(false);
    }
  };

  const handleConfirm = () => {
    if (!description && !requirements) {
      message.error('请先生成岗位描述');
      return;
    }
    onConfirm(description, requirements);
    message.success('已采纳生成的内容');
    onCancel();
  };

  const handleCancel = () => {
    setStreamContent('');
    setDescription('');
    setRequirements('');
    setChatMessages([]);
    setChatInput('');
    setGenerated(false);
    onCancel();
  };

  return (
    <Modal
      title={
        <Space>
          <span>AI 生成岗位描述</span>
          {generating && <Spin size="small" />}
        </Space>
      }
      open={visible}
      onCancel={handleCancel}
      width={900}
      zIndex={1100}
      footer={[
        <Button key="regenerate" icon={<ReloadOutlined />} onClick={handleGenerate} disabled={generating}>
          重新生成
        </Button>,
        <Button key="cancel" onClick={handleCancel}>
          取消
        </Button>,
        <Button key="confirm" type="primary" icon={<CheckOutlined />} onClick={handleConfirm} disabled={!generated}>
          采纳并填入表单
        </Button>,
      ]}
    >
      <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
        {generating && !generated && (
          <Card style={{ marginBottom: 16, background: '#f8fafc' }}>
            <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13 }}>
              {streamContent || <Text type="secondary">正在生成中...</Text>}
            </div>
          </Card>
        )}

        {generated && (
          <>
            <Card 
              title={<Text strong style={{ color: '#0f172a' }}>岗位职责</Text>} 
              style={{ marginBottom: 16 }}
              bodyStyle={{ background: '#f8fafc' }}
            >
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                {description || <Text type="secondary">暂无内容</Text>}
              </div>
            </Card>

            <Card 
              title={<Text strong style={{ color: '#0f172a' }}>任职要求</Text>} 
              style={{ marginBottom: 16 }}
              bodyStyle={{ background: '#f8fafc' }}
            >
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                {requirements || <Text type="secondary">暂无内容</Text>}
              </div>
            </Card>

            <Divider style={{ margin: '16px 0' }} />

            <div style={{ marginBottom: 8 }}>
              <Text type="secondary">如需修改，请在下方输入您的需求，例如："增加 Python 技能要求" 或 "简化职责描述"</Text>
            </div>

            <div style={{ marginBottom: 16 }}>
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  style={{
                    marginBottom: 8,
                    textAlign: msg.role === 'user' ? 'right' : 'left',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: msg.role === 'user' ? '#3b82f6' : '#f1f5f9',
                      color: msg.role === 'user' ? '#fff' : '#334155',
                      maxWidth: '80%',
                      textAlign: 'left',
                    }}
                  >
                    {msg.content}
                  </span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                placeholder="输入修改需求..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onPressEnter={handleChat}
                disabled={chatting}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleChat}
                loading={chatting}
              >
                发送
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default JDGeneratorModal;