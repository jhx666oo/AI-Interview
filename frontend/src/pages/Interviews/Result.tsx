import React, { useEffect, useState } from 'react';
import { Card, Descriptions, Button, Result, Typography, Divider, Tag, List, Space, message, Dropdown, Spin } from 'antd';
import type { MenuProps } from 'antd';
import { useParams, useNavigate } from 'react-router-dom';
import { DownloadOutlined, FileMarkdownOutlined, FilePdfOutlined, DownOutlined, ThunderboltOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// @ts-ignore
import html2pdf from 'html2pdf.js';

const { Title, Paragraph, Text } = Typography;

const InterviewResultPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [interview, setInterview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isEditingResult, setIsEditingResult] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmingResult, setConfirmingResult] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (id) {
      fetchInterview(id);
    }
  }, [id]);

  const fetchInterview = async (interviewId: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await request.get(`/interviews/${interviewId}`) as any;
      if (res && res.scores) {
          // Ensure comments is present
          if (!res.comments) res.comments = {};
      }
      setInterview(res);
    } catch (error) {
      // message.error('获取面试详情失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const isGeneratingEvaluation = !!interview && interview.result === 'pending' && !interview.evaluation;

  useEffect(() => {
    if (!id || !isGeneratingEvaluation) return;
    const interval = setInterval(() => {
      fetchInterview(id, true);
    }, 3000);
    return () => clearInterval(interval);
  }, [id, isGeneratingEvaluation]);

  const handleAIAnalysis = async () => {
    if (!id) return;
    setAnalyzing(true);
    try {
      const res = await request.post(`/interviews/${id}/ai-analysis`) as any;
      setInterview(res);
      message.success('AI综合分析已生成');
    } catch (error: any) {
      message.error(error?.response?.data?.detail || 'AI分析失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleConfirmResult = async (result: string) => {
      setConfirmingResult(true);
      try {
          await request.post(`/interviews/${id}/confirm`, { result });
          message.success('已更新面试结果');
          setIsEditingResult(false);
          fetchInterview(id!);
      } catch (error) {
          message.error('操作失败');
      } finally {
          setConfirmingResult(false);
      }
  };

  const handleExport = async (format: string = 'markdown') => {
    // Avoid event object being passed as format
    if (typeof format !== 'string') format = 'markdown';
    
    if (format === 'pdf') {
        setExporting(true);
        const element = document.getElementById('interview-result-content');
        if (!element) { setExporting(false); return; }
        
        const opt = {
            margin:       [15, 15, 15, 15],
            filename:     `面试评估报告_${interview.resume?.candidate_name || '候选人'}_${interview.id}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, logging: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
        } as any;
        
        // Remove buttons for PDF
        const extraButtons = document.getElementById('result-extra-buttons');
        if (extraButtons) extraButtons.style.display = 'none';
        
        html2pdf().from(element).set(opt).save().then(() => {
             if (extraButtons) extraButtons.style.display = 'block';
             setExporting(false);
             message.success('导出 PDF 成功');
        }).catch(() => {
             if (extraButtons) extraButtons.style.display = 'block';
             setExporting(false);
             message.error('导出 PDF 失败');
        });
        return;
    }
    
    setExporting(true);
    try {
      const response = await request.get(`/interviews/${id}/export`, {
        params: { format },
        responseType: 'blob'
      });
      
      const mimeType = 'text/markdown';
      const ext = 'md';
      
      const blob = new Blob([response as any], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `面试评估报告_${interview.resume?.candidate_name || '候选人'}_${interview.id}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch (error) {
      message.error('导出失败');
    } finally {
      setExporting(false);
    }
  };

  if (loading || !interview) {
    return <Card loading={loading} />;
  }

  if (isGeneratingEvaluation) {
    return (
      <Card id="interview-result-content">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360 }}>
          <Spin size="large" />
          <Title level={4} style={{ marginTop: 16 }}>正在生成面试评估意见</Title>
          <Text type="secondary">AI 正在分析评分与评语，请稍候…</Text>
          <div style={{ marginTop: 16 }}>
            <Button onClick={() => navigate('/interviews')}>返回列表</Button>
          </div>
        </div>
      </Card>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed': return 'success';
      case 'hired': return 'success';
      case 'rejected': return 'error';
      case 'waitlist': return 'warning';
      case 'next_round': return 'info';
      default: return 'info';
    }
  };

  const resultMap: Record<string, string> = {
    passed: '通过',
    hired: '录用',
    rejected: '不录用',
    waitlist: '待定',
    next_round: '进入下一轮',
    pending: '待处理'
  };

  const calculateAverage = () => {
    if (!interview.scores) return '0.0';
    const values = Object.values(interview.scores) as number[];
    if (values.length === 0) return '0.0';
    const sum = values.reduce((a, b) => a + b, 0);
    return (sum / values.length).toFixed(1);
  };

  const exportItems: MenuProps['items'] = [
    {
      key: 'markdown',
      label: '导出 Markdown',
      icon: <FileMarkdownOutlined />,
      onClick: () => handleExport('markdown'),
    },
    {
      key: 'pdf',
      label: '导出 PDF',
      icon: <FilePdfOutlined />,
      onClick: () => handleExport('pdf'),
    },
  ];

  const pendingConfirmContent = (
      <div style={{ marginTop: 24, textAlign: 'center', background: '#F0F9FF', padding: 24, borderRadius: 8, border: '1px solid #BAE6FD' }}>
          <Title level={4} style={{ color: '#0369A1' }}>AI 建议结果: {interview.suggestion || '无建议'} (待确认)</Title>
          <Paragraph style={{ marginBottom: 24 }}>
             请根据 AI 的评估意见和您的判断，确认最终的面试录用结果。
          </Paragraph>
          <Space size="large">
              <Button type="primary" size="large" disabled={confirmingResult} onClick={() => handleConfirmResult('hired')} style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}>
                  录用
              </Button>
              <Button type="primary" size="large" disabled={confirmingResult} onClick={() => handleConfirmResult('next_round')} style={{ backgroundColor: '#1890ff', borderColor: '#1890ff' }}>
                  进入下一轮
              </Button>
              <Button size="large" disabled={confirmingResult} onClick={() => handleConfirmResult('waitlist')}>
                  待定
              </Button>
              <Button type="primary" size="large" danger disabled={confirmingResult} onClick={() => handleConfirmResult('rejected')}>
                  淘汰
              </Button>
          </Space>
      </div>
  );
  
  const editResultContent = (
      <div style={{ marginTop: 16, marginBottom: 16, textAlign: 'center', background: '#F9F9F9', padding: 16, borderRadius: 8, border: '1px dashed #D9D9D9' }}>
          <Paragraph style={{ marginBottom: 16 }}>
             重新设置面试录用结果：
          </Paragraph>
          <Space>
              <Button type={interview.result === 'hired' ? 'primary' : 'default'} disabled={confirmingResult} onClick={() => handleConfirmResult('hired')} style={interview.result === 'hired' ? { backgroundColor: '#52c41a', borderColor: '#52c41a' } : {}}>
                  录用
              </Button>
              <Button type={interview.result === 'next_round' ? 'primary' : 'default'} disabled={confirmingResult} onClick={() => handleConfirmResult('next_round')} style={interview.result === 'next_round' ? { backgroundColor: '#1890ff', borderColor: '#1890ff' } : {}}>
                  进入下一轮
              </Button>
              <Button type={interview.result === 'waitlist' ? 'primary' : 'default'} disabled={confirmingResult} onClick={() => handleConfirmResult('waitlist')}>
                  待定
              </Button>
              <Button type={interview.result === 'rejected' ? 'primary' : 'default'} danger={interview.result === 'rejected'} disabled={confirmingResult} onClick={() => handleConfirmResult('rejected')}>
                  淘汰
              </Button>
              <Button type="text" onClick={() => setIsEditingResult(false)}>取消</Button>
          </Space>
      </div>
  );

  const isPendingReview = interview.status !== 'completed' && interview.result === 'pending';

  return (
    <Card id="interview-result-content">
      {isPendingReview ? (
         // Pending review state
         <>
            <Result
                status="info"
                title="面试评分已提交"
                subTitle="AI 评估意见已生成，请确认最终结果"
                extra={
                    <div id="result-extra-buttons">
                        <Button type="primary" key="console" onClick={() => navigate('/interviews')} style={{ marginRight: 8 }}>
                        返回列表
                        </Button>
                        <Dropdown key="export" menu={{ items: exportItems }} disabled={exporting}>
                        <Button icon={<DownloadOutlined />} style={{ marginRight: 8 }} loading={exporting}>
                            导出结果 <DownOutlined />
                        </Button>
                        </Dropdown>
                        <Button key="buy" onClick={() => navigate(`/resumes/${interview.resume_id}`)}>
                        查看简历
                        </Button>
                    </div>
                }
            />
            {pendingConfirmContent}
         </>
      ) : (
          <>
            <Result
                status={getStatusIcon(interview.result)}
                title={`面试结果: ${resultMap[interview.result] || interview.result}`}
                subTitle={`总分: ${calculateAverage()} / 10`}
                extra={
                <div id="result-extra-buttons">
                    <Button type="primary" key="console" onClick={() => navigate('/interviews')} style={{ marginRight: 8 }}>
                    返回列表
                    </Button>
                    <Dropdown key="export" menu={{ items: exportItems }} disabled={exporting}>
                    <Button icon={<DownloadOutlined />} style={{ marginRight: 8 }} loading={exporting}>
                        导出结果 <DownOutlined />
                    </Button>
                    </Dropdown>
                    <Button key="buy" onClick={() => navigate(`/resumes/${interview.resume_id}`)}>
                    查看简历
                    </Button>
                    {!isEditingResult && (
                        <Button key="ai-analysis" type="primary" loading={analyzing} icon={<ThunderboltOutlined />} onClick={handleAIAnalysis} style={{ marginLeft: 8, background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)', border: 'none' }}>AI综合分析</Button>
                    )}
                    {!isEditingResult && (
                        <Button type="dashed" onClick={() => setIsEditingResult(true)} style={{ marginLeft: 8 }}>
                        修改结果
                        </Button>
                    )}
                </div>
                }
            />
            {isEditingResult && editResultContent}
          </>
      )}

      <Divider />
      
      {interview.resume && (
        <>
          <Title level={4}>简历初审评价</Title>
          <Descriptions bordered column={1}>
             <Descriptions.Item label="匹配度评分">
                <Tag color={interview.resume.match_score >= 80 ? 'green' : interview.resume.match_score >= 60 ? 'orange' : 'red'}>
                   {interview.resume.match_score ?? 'N/A'} 分
                </Tag>
             </Descriptions.Item>
             <Descriptions.Item label="初审结果">
                <Tag color={!interview.resume.screening_result ? 'default' : interview.resume.screening_result === 'passed' || interview.resume.screening_result === '通过' ? 'success' : 'error'}>
                  {!interview.resume.screening_result ? '待初筛' : interview.resume.screening_result === 'passed' || interview.resume.screening_result === '通过' ? '通过' : '不通过'}
                </Tag>
             </Descriptions.Item>
             <Descriptions.Item label="AI 评价">
                <div style={{ fontSize: 14, lineHeight: 1.8, color: '#334155' }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h3: ({node, ...props}) => <h3 style={{ color: '#0F172A', marginTop: 12, marginBottom: 8, fontSize: 15 }} {...props} />,
                      p: ({node, ...props}) => <p style={{ marginBottom: 10 }} {...props} />,
                      ul: ({node, ...props}) => <ul style={{ paddingLeft: 18, marginBottom: 10 }} {...props} />,
                      li: ({node, ...props}) => <li style={{ marginBottom: 4 }} {...props} />
                    }}
                  >
                    {interview.resume.ai_review || '暂无评价'}
                  </ReactMarkdown>
                </div>
             </Descriptions.Item>
          </Descriptions>
          <Divider />
        </>
      )}

      <Title level={4}>综合评价</Title>
      <div style={{ fontSize: 16, lineHeight: 1.9, color: '#334155' }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({node, ...props}) => <h1 style={{ fontSize: 20, marginTop: 16, marginBottom: 12, color: '#0F172A' }} {...props} />,
            h2: ({node, ...props}) => <h2 style={{ fontSize: 18, marginTop: 16, marginBottom: 10, color: '#0F172A' }} {...props} />,
            h3: ({node, ...props}) => <h3 style={{ fontSize: 16, marginTop: 14, marginBottom: 8, color: '#0F172A' }} {...props} />,
            p: ({node, ...props}) => <p style={{ marginBottom: 12 }} {...props} />,
            ul: ({node, ...props}) => <ul style={{ paddingLeft: 18, marginBottom: 12 }} {...props} />,
            li: ({node, ...props}) => <li style={{ marginBottom: 4 }} {...props} />
          }}
        >
          {interview.evaluation || '暂无评价'}
        </ReactMarkdown>
      </div>

      <Divider />

      <Title level={4}>得分详情</Title>
      <List
        bordered
        dataSource={interview.questions}
        renderItem={(item: any, index: number) => (
          <List.Item>
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                 <div style={{ flex: 1 }}>
                    <Space>
                        <Tag color="blue">第{index + 1}题</Tag>
                        <span style={{ fontWeight: 'bold', fontSize: '15px' }}>{item.title || '无标题'}</span>
                    </Space>
                 </div>
                 <div style={{ marginLeft: 16, textAlign: 'right' }}>
                    <Tag color="geekblue" style={{ fontSize: '14px', padding: '4px 10px' }}>
                        得分: {interview.scores?.[index] ?? 0}
                    </Tag>
                 </div>
              </div>
              
              <div style={{ background: '#F8FAFC', padding: '12px', borderRadius: 8, marginTop: 8, border: '1px solid #E2E8F0' }}>
                 {interview.comments?.[index] ? (
                     <div>
                        <Text strong style={{ marginRight: 8, color: '#0F172A' }}>面试官评语:</Text>
                        <Text>{interview.comments[index]}</Text>
                     </div>
                 ) : (
                    <Text type="secondary">暂无评语</Text>
                 )}
              </div>
            </div>
          </List.Item>
        )}
      />
    </Card>
  );
};

export default InterviewResultPage;
