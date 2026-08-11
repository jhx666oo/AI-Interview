import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Button, Space, Tag, Modal, message, Typography,
  Row, Col, Spin, Empty, Statistic, Divider, DatePicker, Select,
  Alert, Tooltip
} from 'antd';
import {
  ThunderboltOutlined, LoadingOutlined, ReloadOutlined,
  DeleteOutlined, RobotOutlined, SendOutlined,
  ClockCircleOutlined, TeamOutlined, UserOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import { useOwner } from '../../contexts/OwnerContext';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';
import { normalizeDailyReportStats, type DailyReportStats, type DailyReportStatsRow } from './stats';
import { ResponsiveModal, ResponsiveToolbar, TableViewport } from '../../components/Responsive';
import { useViewportWidth } from '../../components/Layout/responsive';

const { Text, Title } = Typography;

const REPORT_METRIC_COLUMNS = [
  { key: 'open_requisitions', label: '开放岗位' },
  { key: 'today_new', label: '今日新增' },
  { key: 'pending_screening', label: '待初筛' },
  { key: 'approved_candidates', label: '今日通过' },
  { key: 'rejected_candidates', label: '今日淘汰' },
  { key: 'active_interviews', label: '今日面试' },
  { key: 'offers_count', label: 'Offer' },
  { key: 'onboarding_count', label: '入职' },
] as const;

function buildSnapshotTableRows(stats: DailyReportStats): DailyReportStatsRow[] {
  if (!stats.rows?.length) return [];
  return [
    ...stats.rows,
    {
      owner: '合计',
      open_requisitions: stats.open_requisitions,
      today_new: stats.today_new,
      pending_screening: stats.pending_screening,
      approved_candidates: stats.approved_candidates,
      rejected_candidates: stats.rejected_candidates,
      active_interviews: stats.active_interviews,
      offers_count: stats.offers_count,
      onboarding_count: stats.onboarding_count,
    },
  ];
}

function renderSnapshotTable(stats: DailyReportStats | null, dense = false): React.ReactNode {
  const rows = stats ? buildSnapshotTableRows(stats) : [];
  if (rows.length === 0) return null;
  const cellPadding = dense ? '6px 8px' : '8px 10px';

  return (
    <div style={{ marginBottom: 20 }}>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>📊 统计数据（与飞书同步）</Text>
      <TableViewport className="daily-report-snapshot-table">
        <div style={{ minWidth: 760, border: '1px solid #f0f0f0', borderRadius: 8 }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ padding: cellPadding, borderBottom: '1px solid #d9d9d9', textAlign: 'left', whiteSpace: 'nowrap' }}>负责人</th>
                {REPORT_METRIC_COLUMNS.map((column) => (
                  <th key={column.key} style={{ padding: cellPadding, borderBottom: '1px solid #d9d9d9', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.owner} style={{ background: row.owner === '合计' ? '#f5f5f5' : index % 2 === 0 ? '#fff' : '#fafafa', fontWeight: row.owner === '合计' ? 600 : 400 }}>
                  <td style={{ padding: cellPadding, borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>{row.owner}</td>
                  {REPORT_METRIC_COLUMNS.map((column) => (
                    <td key={column.key} style={{ padding: cellPadding, borderBottom: '1px solid #f0f0f0', textAlign: 'center' }}>
                      {row[column.key] ?? '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableViewport>
      {(stats.unassigned ?? 0) > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8 }}
          message={`未唯一归属记录 ${stats.unassigned} 条，未计入负责人表格`}
        />
      )}
    </div>
  );
}

interface ContactItem {
  id: string;
  name: string;
  role?: string;
  avatar?: string;
}

const DailyReportsList: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedDate, setSelectedDate] = useState<dayjs.Dayjs>(dayjs());
  const { selectedOwner } = useOwner();

  // 发送到飞书
  const [sendModal, setSendModal] = useState<any>(null);
  const [sendTargetType, setSendTargetType] = useState<'chat' | 'user'>('chat');
  const [sendTargetId, setSendTargetId] = useState('');
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 联系人列表
  const [contacts, setContacts] = useState<{ groups: ContactItem[]; users: ContactItem[] }>({ groups: [], users: [] });
  const [contactsLoading, setContactsLoading] = useState(false);
  // 日报详情（按负责人分组的候选人）
  const [detailModal, setDetailModal] = useState<any>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const viewportWidth = useViewportWidth();
  const isNarrow = viewportWidth < 480;
  const modalWidth = Math.min(900, Math.max(320, viewportWidth - 32));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get('/daily-reports');
      setData(res || []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, []) // eslint-disable-line;

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await request.post('/daily-reports/generate', {
        report_date: selectedDate.format('YYYY-MM-DD'),
        report_type: 'progress',
        responsible_person: selectedOwner || undefined,
      }, { timeout: 120000 }) as any;
      if (res && !res.detail) {
        message.success('日报已生成');
        fetchData();
      } else {
        message.error(res?.detail || '生成失败');
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await request.delete(`/daily-reports/${id}`);
      message.success('已删除');
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  // 查看日报详情（按负责人分组候选人）
  const handleViewDetail = async (record: any) => {
    setDetailModal(record);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const res = await request.get(`/daily-reports/${record.id}/details`);
      setDetailData(res);
    } catch {
      message.error('获取日报详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  // 打开发送对话框 → 拉取飞书联系人
  const handleOpenSend = async (record: any) => {
    setSendModal(record);
    setSendTargetType('chat');
    setSendTargetId('');
    setContactsLoading(true);
    try {
      const res = await request.get('/feishu/contacts') as any;
      if (res.ok) {
        setContacts({ groups: res.groups || [], users: res.users || [] });
      }
    } catch {
      // 加载失败，允许手动输入
    } finally {
      setContactsLoading(false);
    }
  };

  // 执行发送
  const handleSend = async () => {
    if (!sendTargetId.trim()) {
      message.warning('请输入飞书群 Chat ID 或用户 Open ID');
      return;
    }
    setSending(true);
    try {
      await request.post(`/daily-reports/${sendModal.id}/send`, {
        target_type: sendTargetType,
        target_id: sendTargetId.trim(),
      });
      message.success('✅ 已成功发送到飞书');
      setSendModal(null);
    } catch (e: any) {
      message.error('发送失败: ' + (e.response?.data?.detail || e.message));
    } finally {
      setSending(false);
    }
  };

  // 截取 AI 摘要前 150 字
  const summaryPreview = (text: any) => {
    if (!text) return '';
    if (typeof text !== 'string') {
      if (typeof text === 'object') return JSON.stringify(text).slice(0, 150) + '...';
      return String(text).slice(0, 150) + '...';
    }
    return text.length > 150 ? text.slice(0, 150) + '...' : text;
  };

  const detailStats = normalizeDailyReportStats(detailModal?.stats);

  return (
    <div>
      {/* 顶部操作栏 */}
      <ResponsiveToolbar
        actions={
          <Space wrap>
            <DatePicker
              value={selectedDate}
              onChange={(d) => d && setSelectedDate(d)}
              allowClear={false}
            />
            <Button
              type="primary"
              icon={generating ? <LoadingOutlined /> : <ThunderboltOutlined />}
              onClick={handleGenerate}
              loading={generating}
              size="large"
              style={{ borderRadius: 8 }}
            >
              生成日报
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading} size="large" style={{ borderRadius: 8 }}>
              刷新
            </Button>
          </Space>
        }
      >
        <div>
          <Title level={2} style={{ margin: 0, fontWeight: 700 }}>招聘日报</Title>
          <Text type="secondary">AI 自动生成每日招聘进展报告</Text>
        </div>
      </ResponsiveToolbar>

      {/* 列表区域 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : data.length === 0 ? (
        <Empty
          description={
            <span>暂无日报，点击上方<Text strong>「生成日报」</Text>按钮创建</span>
          }
          style={{ padding: 80 }}
        >
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleGenerate} loading={generating}>
            立即生成
          </Button>
        </Empty>
      ) : (
        <Row gutter={[16, 16]}>
          {data.map((record: any) => {
            // stats 列存的是 JSON 统计数据（transformRow 已解析为对象），ai_summary 是 AI 摘要文本
            const stats = normalizeDailyReportStats(record.stats);

            return (
              <Col key={record.id} xs={24} sm={24} md={12} lg={8}>
                <Card
                  hoverable
                  style={{
                    borderRadius: 12,
                    border: '1px solid #E8E8E8',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                  styles={{
                    body: {
                      padding: 20,
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                    },
                  }}
                >
                  {/* 卡片头部 */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text strong style={{ fontSize: 16 }}>📊 招聘日报 · {record.report_date || '-'}</Text>
                      <Tag color="blue" style={{ borderRadius: 4 }}>日报</Tag>
                    </div>
                    <Space size={12}>
                      <Space size={4}>
                        <ClockCircleOutlined style={{ color: '#999', fontSize: 12 }} />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {record.report_date} · {record.created_at ? dayjs(record.created_at).format('HH:mm') : '-'}
                        </Text>
                      </Space>
                    </Space>
                  </div>

                  {/* 关键指标 */}
                  {stats && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${isNarrow ? 2 : 3}, minmax(0, 1fr))`,
                      gap: 8,
                      marginBottom: 12,
                      padding: 12,
                      background: '#F9FAFB',
                      borderRadius: 8,
                    }}>
                      {[
                        { label: '待筛选', value: stats.pending_screening, color: '#1677ff' },
                        { label: '面试中', value: stats.active_interviews, color: '#722ed1' },
                        { label: '已通过', value: stats.approved_candidates, color: '#52c41a' },
                        { label: '入职中', value: stats.onboarding_count, color: '#13c2c2' },
                        { label: '简历库', value: stats.total_resumes, color: '#fa8c16' },
                        { label: '开放需求', value: stats.open_requisitions, color: '#eb2f96' },
                      ].map(item => (
                        <div key={item.label} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: item.color, lineHeight: 1.3 }}>
                            {item.value ?? '-'}
                          </div>
                          <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>{item.label}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* AI 摘要预览 */}
                  {record.ai_summary ? (
                    <div style={{ flex: 1, marginBottom: 12 }}>
                      <Space style={{ marginBottom: 4 }}>
                        <RobotOutlined style={{ color: '#1677ff' }} />
                        <Text type="secondary" style={{ fontSize: 12 }}>AI 摘要</Text>
                      </Space>
                      <div style={{
                        fontSize: 13,
                        lineHeight: 1.7,
                        color: '#434343',
                        background: '#F0F5FF',
                        padding: '8px 12px',
                        borderRadius: 6,
                        maxHeight: 120,
                        overflow: 'hidden',
                      }}>
                        {summaryPreview(record.ai_summary)}
                      </div>
                    </div>
                  ) : (
                    <div style={{ flex: 1 }} />
                  )}

                  {/* 底部操作按钮 */}
                  <Divider style={{ margin: '8px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Tooltip title="发送到飞书">
                      <Button
                        size="small"
                        icon={<SendOutlined />}
                        onClick={(e) => { e.stopPropagation(); handleOpenSend(record); }}
                      >
                        抄送飞书
                      </Button>
                    </Tooltip>
                    <Tooltip title="查看完整日报">
                      <Button
                        size="small"
                        icon={<FileTextOutlined />}
                        onClick={() => {
                          Modal.info({
                            title: `📊 招聘日报 · ${record.report_date}`,
                            width: modalWidth,
                            content: (
                              <div>
                                <Row gutter={16} style={{ marginBottom: 16, marginTop: 16 }}>
                                  <Col span={12}>
                                    <Text type="secondary">报告日期: </Text>
                                    <Text strong>{record.report_date}</Text>
                                  </Col>
                                  <Col span={12}>
                                    <Text type="secondary">生成时间: </Text>
                                    <Text strong>{record.created_at ? dayjs(record.created_at).format('MM-DD HH:mm') : '-'}</Text>
                                  </Col>
                                </Row>
                                {renderSnapshotTable(stats, isNarrow)}
                                {stats && (
                                  <>
                                    <Divider>统计数据</Divider>
                                    <Row gutter={16}>
                                      {[
                                        { label: '开放职位', key: 'open_requisitions', color: '#eb2f96' },
                                        { label: '简历总量', key: 'total_resumes', color: '#fa8c16' },
                                        { label: '待初筛', key: 'pending_screening', color: '#1677ff' },
                                        { label: '已通过', key: 'approved_candidates', color: '#52c41a' },
                                        { label: '已淘汰', key: 'rejected_candidates', color: '#ff4d4f' },
                                        { label: '面试中', key: 'active_interviews', color: '#722ed1' },
                                        { label: '入职中', key: 'onboarding_count', color: '#13c2c2' },
                                      ].map(item => (
                                        <Col key={item.key} xs={12} sm={8} md={6} style={{ marginBottom: 12 }}>
                                          <Statistic
                                            title={item.label}
                                            value={stats[item.key] ?? '-'}
                                            valueStyle={{ fontSize: 16, color: item.color }}
                                          />
                                        </Col>
                                      ))}
                                    </Row>
                                  </>
                                )}
                                <Divider>
                                  <Space><RobotOutlined /> AI 摘要</Space>
                                </Divider>
                                {record.ai_summary ? (
                                  <div style={{
                                    background: '#f5f5f5',
                                    padding: 16,
                                    borderRadius: 8,
                                    fontSize: 13,
                                    lineHeight: 1.8,
                                  }}>
                                    <ReactMarkdown>{String(record.ai_summary)}</ReactMarkdown>
                                  </div>
                                ) : (
                                  <Text type="secondary">无AI摘要</Text>
                                )}
                              </div>
                            ),
                            okText: '关闭',
                          });
                        }}
                      >
                        查看详情
                      </Button>
                    </Tooltip>
                    <Tooltip title="删除">
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        loading={deletingId === record.id}
                        onClick={(e) => { e.stopPropagation(); handleDelete(record.id); }}
                      />
                    </Tooltip>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* 日报详情对话框（按负责人分组表格） */}
      <ResponsiveModal
        title={
          <Space>
            <FileTextOutlined />
            <span>招聘日报详情 · {detailModal?.report_date || '-'}</span>
          </Space>
        }
        open={!!detailModal}
        onCancel={() => { setDetailModal(null); setDetailData(null); }}
        footer={[
          <Button key="close" onClick={() => { setDetailModal(null); setDetailData(null); }}>关闭</Button>,
          detailData && (
            <Button key="send" type="primary" icon={<SendOutlined />} onClick={() => detailModal && handleOpenSend(detailModal)}>
              发送到飞书
            </Button>
          ),
        ]}
        width={modalWidth}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /><p style={{ marginTop: 12, color: '#999' }}>加载候选人数据...</p></div>
        ) : detailData ? (
          <div>
            {/* 与飞书卡片保持同一份 v2 快照数据 */}
            {renderSnapshotTable(detailStats, isNarrow)}

            {/* 汇总统计 */}
            <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f0f5ff', borderRadius: 6 }}>
              <Text strong>📋 今日通过初筛：{detailData.stats?.total || 0} 人</Text>
            </div>

            {/* 按负责人分组表格 */}
            {(detailData.groups || []).map((group: any) => (
              <div key={group.responsible_person} style={{ marginBottom: 20 }}>
                <div style={{
                  padding: '8px 12px',
                  background: group.responsible_person === '何雨菱' ? '#fff7e6' : group.responsible_person === '杜雁玲' ? '#f6ffed' : group.responsible_person === '魏秋柠' ? '#fff0f6' : '#f5f5f5',
                  borderRadius: '6px 6px 0 0',
                  fontWeight: 600,
                  fontSize: 14,
                  border: '1px solid #f0f0f0',
                  borderBottom: 'none',
                }}>
                  {group.responsible_person === '何雨菱' ? '🌸' : group.responsible_person === '杜雁玲' ? '🌻' : group.responsible_person === '魏秋柠' ? '🌺' : '📋'} {group.responsible_person}
                  <Tag style={{ marginLeft: 8 }}>{group.candidates.length} 人</Tag>
                </div>
                <TableViewport className="daily-report-candidate-table">
                  <div style={{ minWidth: 780, border: '1px solid #f0f0f0', borderRadius: '0 0 6px 6px' }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                      <tr style={{ background: '#fafafa' }}>
                        <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left', whiteSpace: 'nowrap' }}>姓名</th>
                        <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left', whiteSpace: 'nowrap' }}>学历</th>
                        <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left', whiteSpace: 'nowrap' }}>年龄</th>
                        <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left', whiteSpace: 'nowrap' }}>性别</th>
                        <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left', whiteSpace: 'nowrap' }}>岗位</th>
                        <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left', whiteSpace: 'nowrap' }}>城市</th>
                        <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left', minWidth: 200 }}>AI 建议</th>
                        <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'center', whiteSpace: 'nowrap' }}>简历</th>
                      </tr>
                      </thead>
                      <tbody>
                      {group.candidates.map((c: any, idx: number) => (
                        <tr key={c.resume_id || idx} style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5', fontWeight: 500 }}>{c.name}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{c.education || '-'}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{c.age ? c.age + '岁' : '-'}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{c.gender || '-'}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.position || '-'}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{c.city || '-'}</td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5', fontSize: 11, color: '#666', maxWidth: 250 }}>
                            <Tooltip title={c.ai_summary}>
                              <span>{c.recommendation === 'strongly_recommend' ? '🟢' : c.recommendation === 'recommend' ? '🔵' : c.recommendation === 'neutral' ? '🟡' : '⚪'} {c.ai_summary ? c.ai_summary.slice(0, 60) + (c.ai_summary.length > 60 ? '...' : '') : '-'}</span>
                            </Tooltip>
                          </td>
                          <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5', textAlign: 'center' }}>
                            {c.resume_id ? (
                              <a href={`/resumes/${c.resume_id}`} target="_blank" rel="noopener noreferrer">
                                <Button type="link" size="small" icon={<FileTextOutlined />}>查看</Button>
                              </a>
                            ) : '-'}
                          </td>
                        </tr>
                      ))}
                      </tbody>
                    </table>
                  </div>
                </TableViewport>
              </div>
            ))}

            {/* 底部 AI 分析 */}
            <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 6, fontSize: 13, lineHeight: 1.8 }}>
              <Text strong><RobotOutlined /> 整体 AI 分析</Text>
              {detailModal?.ai_summary ? (
                <div style={{ marginTop: 8 }}>
                  <ReactMarkdown>{String(detailModal.ai_summary)}</ReactMarkdown>
                </div>
              ) : (
                <Text type="secondary" style={{ marginTop: 8, display: 'block' }}>无 AI 分析</Text>
              )}
            </div>
          </div>
        ) : (
          <Empty description="暂无数据" />
        )}
      </ResponsiveModal>

      {/* 发送到飞书对话框 */}
      <ResponsiveModal
        title={
          <Space>
            <SendOutlined />
            <span>抄送飞书</span>
          </Space>
        }
        open={!!sendModal}
        onCancel={() => setSendModal(null)}
        onOk={handleSend}
        confirmLoading={sending}
        okText="发送"
        cancelText="取消"
        width={Math.min(480, Math.max(320, viewportWidth - 32))}
      >
        {sendModal && (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16, borderRadius: 6 }}
              message={`发送日报：${sendModal.title || sendModal.report_date}`}
            />

            <div style={{ marginBottom: 8 }}>
              <Text strong>发送目标</Text>
            </div>
            <Select
              value={sendTargetType}
              onChange={(v) => { setSendTargetType(v); setSendTargetId(''); }}
              style={{ width: '100%', marginBottom: 12 }}
              options={[
                { value: 'chat', label: <><TeamOutlined /> 飞书群聊</> },
                { value: 'user', label: <><UserOutlined /> 飞书用户</> },
              ]}
            />

            {/* 联系人选择器 + 自定义输入 */}
            <Select
              showSearch
              value={sendTargetId || undefined}
              onChange={(val) => setSendTargetId(val)}
              style={{ width: '100%' }}
              placeholder={
                sendTargetType === 'chat'
                  ? '选择群聊或输入 Chat ID'
                  : '选择用户或输入 Open ID'
              }
              notFoundContent={contactsLoading ? <Spin size="small" /> : '未找到联系人，可手动输入'}
              filterOption={(input, option: any) =>
                option?.title?.toLowerCase().includes(input.toLowerCase())
              }
              options={(() => {
                const list = sendTargetType === 'chat' ? contacts.groups : contacts.users;
                const opts = list.map((c) => ({
                  value: c.id,
                  title: (c.name || '') + ' ' + (c.role || '') + ' ' + c.id,
                  label: (
                    <Space>
                      <span>{sendTargetType === 'chat' ? <TeamOutlined /> : <UserOutlined />}</span>
                      <span>{c.name}</span>
                      {c.role && <Tag style={{ fontSize: 10, lineHeight: '16px' }}>{c.role}</Tag>}
                      <Text type="secondary" style={{ fontSize: 11 }}>{c.id}</Text>
                    </Space>
                  ),
                }));
                return opts;
              })()}
            />

            <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
              {sendTargetType === 'chat'
                ? '可从群聊列表选择，或直接输入 Chat ID'
                : '可从已绑定飞书的用户中选择，或直接输入 Open ID'}
            </div>
          </div>
        )}
      </ResponsiveModal>
    </div>
  );
};

export default DailyReportsList;
