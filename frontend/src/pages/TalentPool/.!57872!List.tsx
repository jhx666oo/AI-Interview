import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Button, Space, Tag, Select, message,
  Input, Typography, Tooltip
} from 'antd';
import {
  ReloadOutlined, SearchOutlined, BellOutlined, LoadingOutlined, DownloadOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import dayjs from 'dayjs';

const { Option } = Select;
const { Text } = Typography;

const statusConfig: Record<string, { color: string; text: string }> = {
  approved: { color: 'success', text: '已入库' },
  pending_screening: { color: 'warning', text: '待初筛' },
  rejected: { color: 'error', text: '已淘汰' },
};

const TalentPoolList: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [notifyLoading, setNotifyLoading] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search) params.candidate_name = search;
      if (filterStatus) params.status = filterStatus;
      const res = await request.get('/talent-pool', { params });
      setData(res || []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus]);

  useEffect(() => { fetchData(); }, []); // eslint-disable-line

  const handleNotifyInterviewer = async (record: any) => {
    const name = record.candidate_name || '该候选人';
    setNotifyLoading(record.id);
    try {
