import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Button, Space, Tag, Modal, message, Typography,
  Row, Col, Spin, Empty, Statistic, Divider, DatePicker, Select,
  Input, Alert, Tooltip
} from 'antd';
import {
  ThunderboltOutlined, LoadingOutlined, ReloadOutlined,
  DeleteOutlined, RobotOutlined, SendOutlined,
  ClockCircleOutlined, TeamOutlined, UserOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import ReactMarkdown from 'react-markdown';
import dayjs from 'dayjs';

const { Text, Title } = Typography;

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

