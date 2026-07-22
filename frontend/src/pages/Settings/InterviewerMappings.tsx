import React, { useEffect, useState } from 'react';
import { Table, Button, Input, message, Popconfirm, Space, Card, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, BellOutlined, SearchOutlined } from '@ant-design/icons';
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

  // 手机号/邮箱查找
  const [lookupValue, setLookupValue] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResults, setLookupResults] = useState<{ open_id: string; email: string; mobile: string }[]>([]);

  useEffect(() => { fetchMappings(); }, []);

  const fetchMappings = async () => {
    setLoading(true);
    try {
      const res = await request.get('/settings/interviewers') as any[];
      setData(res || []);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  };

  // 从飞书搜索用户 open_id
  const handleSearch = async () => {
    if (!searchName.trim()) return;
    setSearching(true);
    try {
      const res = await request.get('/settings/interviewers/search', { params: { q: searchName } }) as any[];
      if (Array.isArray(res) && res.length > 0) {
        setSearchResults(res);
      } else {
        setSearchResults([]);
        message.info('未找到匹配用户');
      }
    } catch { message.error('搜索失败'); }
    finally { setSearching(false); }
  };

  // 通过手机号/邮箱查找 open_id
  const handleLookup = async () => {
    const val = lookupValue.trim();
    if (!val) return;
    setLookupLoading(true);
    try {
      const isPhone = /^[\d+\- ]+$/.test(val);
      const payload = isPhone ? { mobiles: [val] } : { emails: [val] };
      const res = await request.post('/settings/interviewers/lookup', payload) as any[];
      if (Array.isArray(res) && res.length > 0) {
        setLookupResults(res);
      } else {
        setLookupResults([]);
        message.info('未找到匹配用户');
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '查找失败');
    }
    finally { setLookupLoading(false); }
  };

  const handleAddFromLookup = (item: { open_id: string }) => {
    if (!item.open_id) return;
    if (data.some(d => d.open_id === item.open_id)) {
      message.warning('该 open_id 已存在');
      return;
    }
    setData([...data, { name: '', open_id: item.open_id }]);
    setLookupResults([]);
    setLookupValue('');
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
    try {
      await request.put('/settings/interviewers', { items: valid });
      message.success('保存成功');
      fetchMappings();
    } catch { message.error('保存失败'); }
  };

  const handleNotifyAll = async () => {
    if (data.length === 0) { message.warning('没有配置面试官'); return; }
    try {
      await request.post('/settings/interviewers/notify-all', {
        title: '📢 系统通知',
        content: '请登录 AI 智能招聘系统查看最新消息。',
      });
      message.success('已发送通知');
    } catch { message.error('通知发送失败'); }
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
            <Button icon={<BellOutlined />} onClick={handleNotifyAll}>通知全部面试官</Button>
            <Button icon={<PlusOutlined />} type="dashed" onClick={handleAdd}>添加</Button>
            <Button icon={<SaveOutlined />} type="primary" onClick={handleSave}>保存</Button>
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
        {/* 手机号/邮箱查找 open_id */}
        <div style={{ marginBottom: 12, padding: '12px 16px', background: '#FFF7ED', borderRadius: 8 }}>
          <Space>
            <span style={{ fontSize: 13, color: '#92400E' }}>手机/邮箱查ID：</span>
            <Input.Search
              placeholder="输入手机号或邮箱查找 open_id"
              value={lookupValue}
              onChange={e => setLookupValue(e.target.value)}
              onSearch={handleLookup}
              enterButton={<Space><SearchOutlined /> 查找</Space>}
              loading={lookupLoading}
              style={{ width: 360 }}
            />
          </Space>
          {lookupResults.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {lookupResults.map((item, idx) => (
                <Button
                  key={idx}
                  size="small"
                  style={{ marginRight: 8, marginBottom: 4 }}
                  onClick={() => handleAddFromLookup(item)}
                >
                  + {item.open_id} <span style={{ color: '#999', fontSize: 11 }}>{item.email || item.mobile}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
        <Table
          dataSource={data}
          columns={columns}
          rowKey={(_, idx) => `${idx}`}
          loading={loading}
          pagination={false}
          locale={{ emptyText: '暂无映射，请点击「添加」配置面试官姓名与飞书 Open ID' }}
        />
      </Card>
    </div>
  );
};

export default InterviewerMappings;
