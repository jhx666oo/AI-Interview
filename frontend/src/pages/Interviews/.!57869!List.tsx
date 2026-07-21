import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Space, message, Tag, Modal, Select, Input, Form,
  Radio, Typography, Card, Tooltip, DatePicker
} from 'antd';
import {
  ReloadOutlined, EditOutlined, EyeOutlined, SearchOutlined,
  BellOutlined, DownloadOutlined, TeamOutlined, UserOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';
import { useOwner } from '../../contexts/OwnerContext';

const { TextArea } = Input;
const { Text } = Typography;

// =================== 统一候选人面试管理 ===================

const interviewStatusConfig: Record<string, { color: string; text: string }> = {
  scheduled: { color: 'processing', text: '待面试' },
  completed: { color: 'success', text: '已完成' },
  cancelled: { color: 'default', text: '已取消' },
};

const resultLabels: Record<string, { color: string; text: string }> = {
  passed: { color: 'success', text: '通过' },
  failed: { color: 'error', text: '不通过' },
};

const talentStatusConfig: Record<string, { color: string; text: string }> = {
  approved: { color: 'success', text: '已入库' },
  pending_screening: { color: 'warning', text: '待初筛' },
  rejected: { color: 'error', text: '已淘汰' },
};

interface MergedRow {
  id: string;
  candidate_name: string;
  position: string;
  position_applied: string;
  standard_position: string;
  education: string;
  city: string;
