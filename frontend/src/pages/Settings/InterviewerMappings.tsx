import React, { useEffect, useState } from 'react';
import { Table, Button, Input, message, Popconfirm, Space, Card, Typography, Modal } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, BellOutlined, SearchOutlined, CloudSyncOutlined } from '@ant-design/icons';
import request from '../../utils/request';

const { Title } = Typography;

interface InterviewerMapping {
  name: string;
  open_id: string;
}

const InterviewerMappings: React.FC = () => {
  const [data, setData] = useState<InterviewerMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchName, setSearchName] = useState('');
  const [searchResults, setSearchResults] = useState<InterviewerMapping[]>([]);
  const [searching, setSearching] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { fetchMappings(); }, []);

  const fetchMappings = async () => {
    setLoading(true);
    try {
      const res = await request.get('/settings/interviewers') as any;
      setData(Array.isArray(res) ? res : []);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  };

  // 从飞书搜索用户 open_id
  const handleSearch = async () => {
    if (!searchName.trim()) return;
    setSearching(true);
    try {
      const res = await request.get('/settings/interviewers/search', { params: { q: searchName } }) as any;
      if (Array.isArray(res) && res.length > 0) {
        setSearchResults(res);
      } else {
        setSearchResults([]);
        message.info('未找到匹配用户');
      }
    } catch { message.error('搜索失败'); }
    finally { setSearching(false); }
  };  
  
  const handleAddFromSearch = (item: InterviewerMapping) => {
    if (data.some(d => d.name === item.name)) {
      message.warning(`${item.name} 已存在`);
      return;
    }
    setData([...data, item]);
    setSearchResults([]);
    setSearchName('');
  };

  const handleAdd = () => {
    setData([...data, { name: '', open_id: '' }]);
  };

  const handleDelete = (index: number) => {
    setData(data.filter((_, i) => i !== index));
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) { message.warning('请先选择要删除的项'); return; }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条记录吗？`,
      onOk: () => {
        const indices = selectedRowKeys.map(k => Number(k));
        setData(data.filter((_, i) => !indices.includes(i)));
        message.success(`已删除 ${selectedRowKeys.length} 条`);
        setSelectedRowKeys([]);
      }
    });
  };

  const handleChange = (index: number, field: 'name' | 'open_id', value: string) => {
    const updated = [...data];
    updated[index][field] = value;
    setData(updated);
  };

  const handleSave = async () => {
    const valid = data.filter(d => d.name.trim());
    if (valid.length === 0) {
      message.warning('请至少填写一个面试官姓名');
      return;
    }
    setSaving(true);
    try {
      await request.put('/settings/interviewers', { items: valid });
      message.success('保存成功');
      fetchMappings();
    } catch { message.error('保存失败'); }
    finally { setSaving(false); }
  };

  const handleNotifyAll = async () => {
    if (data.length === 0) { message.warning('没有配置面试官'); return; }
    setNotifyLoading(true);
    try {
      await request.post('/settings/interviewers/notify-all', {
        title: '📢 系统通知',
        content: '请登录 AI 智能招聘系统查看最新消息。',
      });
      message.success('已发送通知');
    } catch { message.error('通知发送失败'); }
    finally { setNotifyLoading(false); }
  };

  const handleSyncFromFeishu = async () => {
    setSyncing(true);
    try {
      const res = await request.post('/settings/interviewers/batch-sync-from-feishu') as any;
      if (res.ok) {
        const { synced, notFound, details, total_names } = res;
        Modal.info({
          title: '飞书同步完成',
          content: (
            <div>
              <p>收集到 <b>{total_names}</b> 位面试官姓名</p>
              <p>✅ 成功同步 open_id：<b>{synced}</b> 人</p>
              {notFound?.length > 0 && (
                <p style={{ color: '#faad14' }}>⚠️ 未在飞书通讯录找到：{notFound.join('、')}</p>
              )}
              {synced === 0 && notFound?.length === 0 && (
                <p>📭 没有需要同步的面试官（请先添加招聘任务或面试记录）</p>
              )}
            </div>
          ),
          okText: '知道了',
        });
        fetchMappings();
      } else {
        message.error(res.detail || res.message || '同步失败');
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '同步失败，请稍后重试');
    } finally {
      setSyncing(false);
    }
  };

  const columns = [
    {
      title: '姓名',
      dataIndex: 'name',
      render: (_: string, record: InterviewerMapping, index: number) => (
        <Input
          placeholder="面试官姓名"
          value={record.name}
          onChange={e => handleChange(index, 'name', e.target.value)}
          style={{ width: 160 }}
        />
      ),
    },
    {
      title: 'Open ID',
      dataIndex: 'open_id',
      render: (_: string, record: InterviewerMapping, index: number) => (
        <Input
          placeholder="ou_xxxxxxxx"
          value={record.open_id}
          onChange={e => handleChange(index, 'open_id', e.target.value)}
          style={{ width: 260 }}
        />
      ),
    },
    {
      title: '操作',
      width: 80,
      render: (_: any, __: InterviewerMapping, index: number) => (
        <Popconfirm title="确认删除？" onConfirm={() => handleDelete(index)}>
          <Button type="link" danger icon={<DeleteOutlined />} size="small">删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>面试官映射管理</Title>
          <Space>
            <Button icon={<BellOutlined />} loading={notifyLoading} disabled={notifyLoading} onClick={handleNotifyAll}>通知全部面试官</Button>
            <Button icon={<PlusOutlined />} type="dashed" onClick={handleAdd}>添加</Button>
            <Button icon={<SaveOutlined />} type="primary" loading={saving} onClick={handleSave}>保存</Button>
            <Button icon={<CloudSyncOutlined />} loading={syncing} onClick={handleSyncFromFeishu}>从飞书同步</Button>
          </Space>
        </div>
        {/* 飞书搜索 */}
        <div style={{ marginBottom: 12, padding: '12px 16px', background: '#F8FAFC', borderRadius: 8 }}>
          <Space>
            <Input.Search
              placeholder="输入姓名，从飞书搜索 open_id"
              value={searchName}
              onChange={e => setSearchName(e.target.value)}
              onSearch={handleSearch}
              enterButton={<Space><SearchOutlined /> 搜索</Space>}
              loading={searching}
              style={{ width: 360 }}
            />
          </Space>
          {searchResults.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {searchResults.map((item, idx) => (
                <Button
                  key={idx}
                  size="small"
                  style={{ marginRight: 8, marginBottom: 4 }}
                  onClick={() => handleAddFromSearch(item)}
                >
                  + {item.name} <span style={{ color: '#999', fontSize: 11 }}>{item.open_id}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
        {selectedRowKeys.length > 0 && (
          <div style={{ marginBottom: 16, padding: '8px 16px', background: '#e6f7ff', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>已选 <strong>{selectedRowKeys.length}</strong> 项</span>
            <Space>
              <Button danger size="small" onClick={handleBatchDelete}>批量删除</Button>
              <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </Space>
          </div>
        )}
        <Table
          dataSource={data}
          columns={columns}
          rowKey={(_, idx) => `${idx}`}
          loading={loading}
          pagination={false}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys, columnWidth: 40 }}
          locale={{ emptyText: '暂无映射，请点击「添加」配置面试官姓名与飞书 Open ID' }}
        />
      </Card>
    </div>
  );
};

export default InterviewerMappings;
