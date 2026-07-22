import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Table, Button, Space, message, Tag, Modal, Tooltip, Typography, Form, Select, Upload, Input, DatePicker, InputNumber, Card, Row, Col, Checkbox, Statistic, Pagination, Empty, Avatar, Badge, Dropdown, Progress } from 'antd';
import { PlusOutlined, EyeOutlined, TeamOutlined, DeleteOutlined, DownloadOutlined, UploadOutlined, ReloadOutlined, CloseCircleOutlined, SearchOutlined, SolutionOutlined, SyncOutlined, FileTextOutlined, CheckOutlined, CloseOutlined, UserOutlined, StarOutlined, StarFilled, EnvironmentOutlined, BookOutlined, InfoCircleOutlined, EditOutlined, SettingOutlined, RobotOutlined, ThunderboltOutlined, CloudUploadOutlined } from '@ant-design/icons';
import * as pdfjsLib from 'pdfjs-dist';
import request from '../../utils/request';
import SimplePagination from '../../components/SimplePagination';
import { useOwner } from '../../contexts/OwnerContext';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

// PdfViewer 只在使用时动态加载（参见 renderPreviewModal）
let PdfViewer: any = null;

const { Title, Text } = Typography;

const ResumesList: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState([]);
  const [questionBanks, setQuestionBanks] = useState([]);
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [interviewModalVisible, setInterviewModalVisible] = useState(false);
  const [interviewRecord, setInterviewRecord] = useState<any>(null);
  const [existingInterviews, setExistingInterviews] = useState<any[]>([]);
  const [emailPreviewVisible, setEmailPreviewVisible] = useState(false);
  const [emailContent, setEmailContent] = useState<any>(null);
  const [createdInterviewId, setCreatedInterviewId] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailForm] = Form.useForm();
  const [pendingInterviewData, setPendingInterviewData] = useState<any>(null);

  const [fileList, setFileList] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  
  const [form] = Form.useForm();
  const [interviewForm] = Form.useForm();
  
  const navigate = useNavigate();

  const [searchName, setSearchName] = useState('');
  const [searchStatus, setSearchStatus] = useState<string | undefined>(undefined);
  const [searchPerson, setSearchPerson] = useState<string | undefined>(undefined);
  const [responsiblePersons, setResponsiblePersons] = useState<string[]>([]);
  const [searchPosition, setSearchPosition] = useState<string | undefined>(undefined);
  const { selectedOwner } = useOwner();
  const fetchResponsiblePersons = async () => {
    try {
      const res = await request.get('/positions');
      // 从岗位列表收集所有非空责任人
      const names: string[] = [];
      (res || []).forEach((p: any) => {
        if (p.responsible_person) names.push(p.responsible_person);
      });
      // 去重排序
      setResponsiblePersons([...new Set(names)].sort());
    } catch { /* ignore */ }
  };
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewRecord, setPreviewRecord] = useState<any>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string>('');
  // 前端缓存，切页面回来不重新拉飞书
  const dataCache = useRef<any[]>([]);
  const loadedRef = useRef(false);

  // 统计卡片（基于筛选后的 data 实时计算）
  const statsOffer = useMemo(() => data.filter((r: any) => r.status === 'offer_pending' || r.status === 'offer_accepted' || r.status === 'offer_rejected').length, [data]);
  const statsPendingOnboard = useMemo(() => data.filter((r: any) => r.status === 'onboarding').length, [data]);
  const statsCompletedOnboard = useMemo(() => data.filter((r: any) => r.status === 'completed' || r.status === 'offer_accepted').length, [data]);

  // 能力维度（评估依据）
  const [capDims, setCapDims] = useState<Record<string, any>>({});
  const fetchCapDims = async () => {
    try {
      const res = await request.get('/capability-dimensions');
      const map: Record<string, any> = {};
      (res || []).forEach((item: any) => {
        let dims: any[] = [];
        if (item.dimensions_json) {
          try { dims = JSON.parse(item.dimensions_json); } catch {}
        }
        map[item.position_name] = {
          dims,
          personalized: item.personalized_requirements || '',
        };
      });
      setCapDims(map);
    } catch {}
  };

  // BOSS 导入
  const [bossImportOpen, setBossImportOpen] = useState(false);
  const [bossPreview, setBossPreview] = useState<any[]>([]);
  const [bossImporting, setBossImporting] = useState(false);
  const [bossImportResult, setBossImportResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [evalDims, setEvalDims] = useState<any[]>([]);
  const [dimModalOpen, setDimModalOpen] = useState(false);
  const [dimForm] = Form.useForm();
  const fetchEvalDims = async () => {
    try {
      const res = await request.get('/settings/evaluation-dimensions');
      setEvalDims(Array.isArray(res) ? res : []);
    } catch { /* ignore */ }
  };
  const handleSaveEvalDims = async () => {
    try {
      const values = await dimForm.validateFields();
      const items = (values.dimensions || []).filter((d: any) => d.key && d.label);
      if (items.length === 0) { message.warning('请至少添加一个维度'); return; }
      await request.put('/settings/evaluation-dimensions', { items });
      message.success('评估维度已更新，下次 AI 评估将使用新维度');
      setDimModalOpen(false);
      fetchEvalDims();
    } catch (e: any) {
      if (e.errorFields) return; // 表单验证错误
      message.error('保存失败: ' + (e.message || e));
    }
  };

  // BOSS 导入：选择文件并解析
  const handleBossFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];
      if (json.length === 0) {
        message.warning('未解析到数据，请检查文件格式');
        return;
      }

      // 字段映射：匹配 BOSS 直聘导出的常见列名
      const rows = json.map((row: any) => ({
        name: row['姓名'] || row['名字'] || row['候选人'] || row['候选人姓名'] || '',
        gender: row['性别'] || '',
        age: row['年龄'] || '',
        education: row['学历'] || row['最高学历'] || '',
        school: row['学校'] || row['毕业院校'] || '',
        major: row['专业'] || '',
        work_years: row['工作经验'] || row['工作年限'] || '',
        phone: row['手机号'] || row['手机号码'] || row['电话'] || '',
        current_status: row['目前状态'] || row['求职状态'] || '',
        expected_salary: row['期望薪资'] || row['薪资'] || '',
        position_applied: row['应聘岗位'] || row['投递岗位'] || row['匹配职位'] || row['职位'] || '',
        work_history: row['工作经历'] || row['工作经验详情'] || '',
        project_experience: row['项目经验'] || '',
        self_evaluation: row['自我评价'] || '',
        skills: row['技能'] || row['技能标签'] || '',
        advantage_summary: row['优势总结'] || row['亮点'] || '',
        resume_summary: row['简历摘要'] || row['摘要'] || '',
      })).filter((r: any) => r.name); // 跳过无姓名的行

      if (rows.length === 0) {
        message.warning('未找到有效的候选人数据，请检查列名是否匹配');
        return;
      }

      setBossPreview(rows);
      setBossImportResult(null);
      message.success(`解析到 ${rows.length} 条候选人数据`);
    } catch (err: any) {
      message.error('文件解析失败: ' + (err.message || err));
    }
    // 重置 input 以便下次选同一文件
    e.target.value = '';
  };

  // BOSS 导入：提交到后端
  const handleBossImport = async () => {
    if (bossPreview.length === 0) return;
    setBossImporting(true);
    try {
      const res = await request.post('/resumes/import-boss', { items: bossPreview });
      setBossImportResult(res);
      message.success(`导入完成：成功 ${res.imported} 条，跳过 ${res.skipped} 条`);
    } catch (err: any) {
      message.error('导入失败: ' + (err.response?.data?.detail || err.message));
    } finally {
      setBossImporting(false);
    }
  };

  const handleBatchAIEvaluate = async () => {
    const hide = message.loading('正在批量AI评估简历...', 0);
    try {
      const res = await request.post('/resumes/batch-ai-evaluate');
      hide();
      message.success(`评估完成：成功 ${res.evaluated} 份，跳过 ${res.skipped} 份，失败 ${res.failed} 份`);
      if (res.errors?.length > 0) {
        console.warn('AI评估失败详情:', res.errors);
      }
      fetchResumes();
    } catch (err: any) {
      hide();
      message.error('批量AI评估失败: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleBatchReparse = async () => {
    Modal.confirm({
      title: '批量重新解析所有简历',
      content: '将通过 MinerU 重新解析所有简历的 PDF 文件，然后重新运行 AI 分析（评分+匹配）。\n\n此操作会覆盖现有解析结果。',
      okText: '确认重解析',
      cancelText: '取消',
      okType: 'primary',
      onOk: async () => {
        const hide = message.loading('正在提交批量重新解析...', 0);
        try {
          const res = await request.post('/resumes/batch-reparse');
          hide();
          message.success(res.message || `已提交 ${res.count} 个简历重新解析`);
          setTimeout(() => fetchResumes(), 3000);
        } catch (error: any) {
          hide();
          message.error(error?.response?.data?.detail || '批量重新解析失败');
        }
      },
    });
  };

  const handleAutoEvaluateAll = async () => {
    Modal.confirm({
      title: '自动AI评估',
      content: '将对所有尚无评估的简历进行：\n1. 从PDF源文件提取简历文本\n2. AI根据评估维度评分\n3. 保存评估结果到页面显示\n\n已有评估的简历将被跳过。',
      okText: '开始评估',
      cancelText: '取消',
      onOk: async () => {
        const hide = message.loading('正在自动评估简历（从PDF提取文本 + AI评分）...', 0);
        try {
          const res = await request.post('/resumes/auto-evaluate-all', {});
          hide();
          message.success(`自动评估完成：成功 ${res.evaluated} 份，跳过 ${res.skipped} 份，失败 ${res.failed} 份`);
          if (res.errors?.length > 0) {
            console.warn('自动评估失败详情:', res.errors);
            message.warning(`${res.failed} 份评估失败，查看控制台了解详情`);
          }
          fetchResumes();
        } catch (err: any) {
          hide();
          message.error('自动评估失败: ' + (err.response?.data?.detail || err.message));
        }
      }
    });
  };

  const fetchResumes = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params: any = {};
      if (searchName) params.candidate_name = searchName;
      if (searchStatus) params.status = searchStatus;
      const personFilter = searchPerson || selectedOwner;
      if (personFilter) params.responsible_person = personFilter;

      // 不再区分 role，统一显示全部

      // 没有筛选条件且有缓存时直接复用（缓存已排序）
      if (!searchName && !searchStatus && !searchPosition && loadedRef.current && dataCache.current.length > 0) {
        setData(dataCache.current);
        if (!silent) setLoading(false);
        return;
      }

      const res = await request.get('/resumes', { params });
      let filtered = res;
      // 岗位筛选（客户端过滤，因为 API 不支持岗位参数）
      if (searchPosition) {
        filtered = res.filter((r: any) => r.mapped_position === searchPosition);
      }
      setData(filtered);
      dataCache.current = res;

      // 按创建时间降序：最新的排最前
      const sortData = (arr: any[]) => {
        arr.sort((a, b) => {
          const ta = a.create_time || a._raw_fields?.['创建时间-测试'] || a._raw_fields?.['创建时间'] || 0;
          const tb = b.create_time || b._raw_fields?.['创建时间-测试'] || b._raw_fields?.['创建时间'] || 0;
          return (tb || 0) - (ta || 0);
        });
      };
      sortData(filtered);
      sortData(res);
      setData(filtered);
      loadedRef.current = true;

      // 后台触发 PDF 缓存（静默执行，不阻塞展示）
      request.post('/resumes/cache-files').catch(() => {});

      // 检查是否有需要自动评估的简历（无 ai_evaluation 且非仅飞书导入时触发）
      const noEval = res.filter((r: any) => !r.ai_evaluation);
      if (noEval.length > 0 && !silent) {
        console.log(`[AutoEval] 发现 ${noEval.length} 份简历无评估，自动触发评估...`);
        request.post('/resumes/auto-evaluate-all', {}).then((evalRes) => {
          if (evalRes.evaluated > 0) {
            message.success(`自动评估完成：成功 ${evalRes.evaluated} 份，跳过 ${evalRes.skipped} 份`);
            // 重新加载数据
            fetchResumes(true);
          }
        }).catch((err) => {
          console.warn('[AutoEval] 自动评估失败:', err.message);
        });
      }

      // 检查是否有正在解析中的简历
      const hasProcessing = res.some((r: any) => r.parse_status === 'processing');
      setPollingEnabled(hasProcessing);

      return res;
    } catch (error) {
      if (!silent) message.error('获取简历列表失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // 轮询检查解析状态（不触动数据缓存，避免翻页被重置）
  useEffect(() => {
    if (pollingEnabled) {
      pollingRef.current = setInterval(async () => {
        try {
          const res = await request.get('/resumes', { params: {} });
          if (Array.isArray(res)) {
            const hasProcessing = res.some((r: any) => r.parse_status === 'processing');
            if (!hasProcessing) {
              setPollingEnabled(false);
              fetchResumes(); // 解析完成，刷新数据
            }
          }
        } catch {}
      }, 3000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [pollingEnabled]);

  const fetchPositions = async () => {
    try {
      // 优先从岗位管理获取标准岗位名
      const res = await request.get('/positions');
      const list = Array.isArray(res) ? res : (res?.positions || []);
      if (list && list.length > 0) {
        setPositions(list.map((r: any) => ({ id: r.id, title: r.title })));
        return;
      }
      // 回退：从岗位映射表获取
      const mappings = await request.get('/position-mappings');
      if (mappings && mappings.length > 0) {
        const unique = [...new Set(mappings.map((r: any) => r.mapped_name).filter(Boolean))] as string[];
        setPositions(unique.sort().map((name: string) => ({ id: name, title: name })));
      }
    } catch (error) {
      console.error('获取岗位列表失败');
    }
  };

  const fetchQuestionBanks = async () => {
    const cached = sessionStorage.getItem('_cached_question_banks');
    if (cached) { try { setQuestionBanks(JSON.parse(cached)); return; } catch {} }
    try {
      const res = await request.get('/question-banks');
      sessionStorage.setItem('_cached_question_banks', JSON.stringify(res));
      setQuestionBanks(res);
    } catch (error) {
      console.error('获取题库列表失败');
    }
  };

  const [interviewers, setInterviewers] = useState([]);

  const fetchInterviewers = async () => {
    const cached = sessionStorage.getItem('_cached_interviewers');
    if (cached) { try { setInterviewers(JSON.parse(cached)); return; } catch {} }
    try {
      const res = await request.get('/auth/interviewers');
      sessionStorage.setItem('_cached_interviewers', JSON.stringify(res));
      setInterviewers(res);
    } catch (error) {
      console.error('获取面试官列表失败');
    }
  };


  useEffect(() => {
    fetchResumes();
    fetchPositions();
    fetchResponsiblePersons();
    fetchQuestionBanks();
    fetchInterviewers();
    fetchCapDims();
    fetchEvalDims();
  }, []);

  // 全局负责人筛选变化时自动刷新
  useEffect(() => {
    fetchResumes();
  }, [selectedOwner]);

  const handleSearch = () => {
    setCardPage(1);
    fetchResumes();
  };

  const handleReset = () => {
    setSearchName('');
    setSearchStatus(undefined);
    setSearchPerson(undefined);
    setSearchPosition(undefined);
    setCardPage(1);
    dataCache.current = [];
    loadedRef.current = false;
    setLoading(true);
    request.get('/resumes')
      .then(res => {
        setData(res);
        const hasProcessing = res.some((r: any) => r.parse_status === 'processing');
        setPollingEnabled(hasProcessing);
      })
      .catch(() => message.error('获取简历列表失败'))
      .finally(() => setLoading(false));
  };

  const handleCreateInterviewClick = async (record: any) => {
    setInterviewRecord(record);
    interviewForm.resetFields();

    // 获取该候选人已有的面试记录
    try {
      const allInterviews = await request.get('/interviews') as any[];
      const resumeInterviews = allInterviews.filter((i: any) => i.resume_id === record.id);
      setExistingInterviews(resumeInterviews);

      // 检查是否已被录用
      const hiredInterview = resumeInterviews.find((i: any) => i.result === 'hired');
      if (hiredInterview) {
        message.warning('该候选人已被录用，无法安排下一轮面试');
        return;
      }

      // 自动设置下一轮轮次
      const maxRound = resumeInterviews.reduce((max: number, i: any) => Math.max(max, i.round || 1), 0);
      interviewForm.setFieldsValue({
        question_count: 5,
        interview_type: 'onsite',
        interview_category: 'technical',
        round: maxRound + 1
      });
    } catch (error) {
      console.error('获取面试记录失败', error);
      interviewForm.setFieldsValue({
        question_count: 5,
        interview_type: 'onsite',
        round: 1
      });
    }

    setInterviewModalVisible(true);
  };

  const handleInterviewOk = async () => {
    try {
      const values = await interviewForm.validateFields();
      setSubmitting(true);

      // 准备面试数据
      const interviewData = {
        resume_id: interviewRecord.id,
        position_id: interviewRecord.position_id,
        interviewer: '面试小组',
        panel_members: values.panel_members,
        interview_time: values.interview_time ? values.interview_time.toISOString() : new Date().toISOString(),
        question_bank_ids: values.question_bank_ids,
        question_count: values.question_count,
        round: values.round || 1,
        interview_type: values.interview_type || 'onsite',
        interview_category: values.interview_category || 'technical',
        interview_location: values.interview_location,
        meeting_link: values.meeting_link,
        skip_ai_questions: values.skip_ai_questions || false
      };

      // 保存数据供后续创建
      setPendingInterviewData(interviewData);

      // 获取邮件预览（不创建面试）
      try {
        const emailPreview = await request.post('/interviews/email-preview', {
          resume_id: interviewRecord.id,
          position_id: interviewRecord.position_id,
          interview_time: values.interview_time ? values.interview_time.toISOString() : null,
          round: values.round || 1,
          interview_type: values.interview_type || 'onsite',
          interview_category: values.interview_category || 'technical',
          interview_location: values.interview_location,
          meeting_link: values.meeting_link
        });

        setEmailContent(emailPreview);
        emailForm.setFieldsValue({
          subject: emailPreview.subject,
          content: emailPreview.content,
          send_email: true
        });
        setInterviewModalVisible(false);
        setEmailPreviewVisible(true);
      } catch (error) {
        // 如果获取邮件预览失败，直接创建面试
        console.error('获取邮件预览失败', error);
        const res = await request.post('/interviews', {
          ...interviewData,
          skip_email: true
        });
        message.success('面试安排成功');
        navigate(`/interviews/${res.id}/score`);
      }
    } catch (error) {
      message.error('安排面试失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmAndSend = async () => {
    try {
      const values = await emailForm.validateFields();
      setSendingEmail(true);

      // 创建面试
      const res = await request.post('/interviews', {
        ...pendingInterviewData,
        skip_email: true  // 稍后手动发送
      });

      setCreatedInterviewId(res.id);

      // 如果勾选发送邮件，则发送
      if (values.send_email && res.id) {
        try {
          await request.post(`/interviews/${res.id}/send-email`, {
            subject: values.subject,
            content: values.content
          });
          message.success('面试安排成功，邮件已发送');
        } catch (error) {
          message.warning('面试安排成功，但邮件发送失败');
        }
      } else {
        message.success('面试安排成功');
      }

      setEmailPreviewVisible(false);
      navigate(`/interviews/${res.id}/score`);
    } catch (error) {
      message.error('安排面试失败');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleCancelPreview = () => {
    setEmailPreviewVisible(false);
    // 返回面试表单
    setInterviewModalVisible(true);
  };

  const handleReject = async (record: any) => {
    // 乐观更新：立即更新本地状态
    setData(prev => prev.map(item =>
      item.id === record.id ? { ...item, status: 'rejected' } : item
    ));
    try {
      await request.post(`/resumes/${record.id}/reject-from-screening`);
      message.success(`${record.candidate_name} 已淘汰`);
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '操作失败');
      // 回滚
      setData(prev => prev.map(item =>
        item.id === record.id ? { ...item, status: record.status } : item
      ));
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这份简历吗？此操作不可恢复。',
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await request.delete(`/resumes/${id}`);
          message.success('删除成功');
          // 清缓存强制刷新
          dataCache.current = [];
          loadedRef.current = false;
          fetchResumes();
        } catch (error) {
          message.error('删除失败');
        }
      },
    });
  };

  const handleClearRejected = () => {
    Modal.confirm({
      title: '一键清除已淘汰',
      content: '确定要删除所有 HR复核结果为"未通过"的候选人记录吗？此操作不可恢复。',
      okText: '确认清除',
      cancelText: '取消',
      okType: 'danger',
      okButtonProps: { danger: true },
      onOk: async () => {
        const hide = message.loading('正在清除已淘汰记录...', 0);
        try {
          const res = await request.post('/resumes/clear-rejected');
          hide();
          message.success(`已清除 ${res.deleted} 条已淘汰记录`);
          dataCache.current = [];
          loadedRef.current = false;
          fetchResumes();
        } catch (error: any) {
          hide();
          message.error(error?.response?.data?.detail || '清除失败');
        }
      },
    });
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的简历');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 份简历吗？此操作不可恢复。`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.delete(`/resumes/${id}`)));
          message.success(`成功删除 ${selectedRowKeys.length} 份简历`);
          setSelectedRowKeys([]);
          dataCache.current = [];
          loadedRef.current = false;
          fetchResumes();
        } catch (error) {
          message.error('批量删除失败');
        }
      },
    });
  };

  const handleBatchReject = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要淘汰的简历');
      return;
    }
    Modal.confirm({
      title: '确认批量淘汰',
      content: `确定要淘汰选中的 ${selectedRowKeys.length} 份简历吗？`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => 
            request.post(`/resumes/${id}/confirm-rejection`, null, {
              params: { reason_category: 'other', reason_detail: '批量淘汰' }
            })
          ));
          message.success(`成功淘汰 ${selectedRowKeys.length} 份简历`);
          setSelectedRowKeys([]);
          fetchResumes();
        } catch (error) {
          message.error('批量淘汰失败');
        }
      },
    });
  };

  const handleReparse = (record: any) => {
    Modal.confirm({
      title: '重新解析简历',
      content: '将重新调用 AI 解析该简历，并覆盖现有解析结果。',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        const hide = message.loading('正在重新解析...', 0);
        try {
          const res = await request.post(`/resumes/${record.id}/reparse`);
          hide();
          message.success('重新解析完成');
          fetchResumes();
        } catch (error: any) {
          hide();
          message.error(error?.response?.data?.detail || '重新解析失败');
        }
      },
    });
  };

  const handleApproveToTalentPool = async (record: any) => {
    // 乐观更新：立即更新本地状态
    setData(prev => prev.map(item =>
      item.id === record.id ? { ...item, status: 'approved' } : item
    ));
    try {
      await request.post(`/resumes/${record.id}/approve-to-talent-pool`);
      message.success(`${record.candidate_name} 已入库`);
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '入库失败');
      // 回滚
      setData(prev => prev.map(item =>
        item.id === record.id ? { ...item, status: record.status } : item
      ));
    }
  };

  // pdf.js worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  // 从 PDF 文件提取纯文本（零 Token）
  const extractPdfText = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        fullText += pageText + '\n';
      }
      return fullText.trim() || '';
    } catch {
      return ''; // 扫描版 PDF 无法提取，回落 AI
    }
  };

  const handleUploadClick = () => {
    form.resetFields();
    setFileList([]);
    setIsModalVisible(true);
  };

  const handleFeishuSync = async () => {
    const key = 'feishuSync';
    message.loading({ content: '正在从飞书导入...', key });
    try {
      const res = await request.post('/resumes/sync-from-feishu') as any;
      message.success({ content: `已同步 ${res.created || 0} 条，已有 ${res.skipped || 0} 条`, key });
      fetchResumes();
    } catch { message.error({ content: '同步失败', key }); }
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      if (fileList.length === 0) {
        message.error('请上传简历文件');
        return;
      }

      setSubmitting(true);
      
      // v2.0: 前端提取 PDF 文本（零 Token）
      let rawText = '';
      const firstFile = fileList[0];
      if (firstFile.type === 'application/pdf' || firstFile.name?.endsWith('.pdf')) {
        try {
          rawText = await extractPdfText(firstFile);
          if (rawText) console.log(`[PDF] 提取文本 ${rawText.length} 字符`);
        } catch { /* 回落 AI */ }
      }
      
      // Determine if single or batch upload
      if (fileList.length === 1) {
        const formData = new FormData();
        formData.append('position_id', values.position_id);
        formData.append('file', fileList[0]);
        if (rawText) formData.append('raw_text', rawText);
        await request.post('/resumes', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        message.success('简历上传成功，AI正在解析中...');
      } else {
        const formData = new FormData();
        formData.append('position_id', values.position_id);
        fileList.forEach(file => {
          formData.append('files', file);
        });
        await request.post('/resumes/batch', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        message.success(`成功上传 ${fileList.length} 份简历，AI正在解析中...`);
      }

      setIsModalVisible(false);
      fetchResumes();
    } catch (error) {
      message.error('上传失败');
    } finally {
      setSubmitting(false);
    }
  };

  const uploadProps = {
    onRemove: (file: any) => {
      setFileList((prev) => {
        const index = prev.indexOf(file);
        const newFileList = prev.slice();
        newFileList.splice(index, 1);
        return newFileList;
      });
    },
    beforeUpload: (file: any) => {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        message.error('只允许上传 PDF 格式的文件');
        return Upload.LIST_IGNORE;
      }
      setFileList((prev) => [...prev, file]);
      return false;
    },
    fileList,
    multiple: true,
    accept: '.pdf'
  };

  const handlePreview = (record: any) => {
    setPreviewRecord(record);
    const token = localStorage.getItem('token') || '';
    setPreviewPdfUrl(`/api/resumes/${record.id}/file?token=${encodeURIComponent(token)}`);
    setPreviewVisible(true);
  };

  const handleDownload = (record: any) => {
    const token = localStorage.getItem('token') || '';
    const url = `/api/resumes/${record.id}/file?download=true&token=${encodeURIComponent(token)}`;
    // 创建临时 a 标签触发下载
    const a = document.createElement('a');
    a.href = url;
    a.download = (record.candidate_name || 'resume') + '.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const renderActionButtons = (record: any) => {
    const isPending = record.status === 'pending_screening';
    const isApproved = record.status === 'approved';
    const isRejected = record.status === 'rejected';
    const hardResult = record.hard_requirement_result ? (typeof record.hard_requirement_result === 'string' ? JSON.parse(record.hard_requirement_result) : record.hard_requirement_result) : null;
    const capScores = record.capability_scores ? (typeof record.capability_scores === 'string' ? JSON.parse(record.capability_scores) : record.capability_scores) : null;

    const handleCheckHard = async () => {
      try {
        message.loading({ content: '硬性要求检查中...', key: 'hard' });
        const res = await request.post(`/resumes/${record.id}/check-hard-requirements`) as any;
        message.success({ content: '硬性检查完成', key: 'hard' });
        fetchResumes();
      } catch (e: any) {
        message.error({ content: e.response?.data?.detail || '检查失败', key: 'hard' });
      }
    };

    const handleScoreCap = async () => {
      try {
        message.loading({ content: '能力评分中...', key: 'score' });
        const res = await request.post(`/resumes/${record.id}/score-capabilities`) as any;
        message.success({ content: '能力评分完成', key: 'score' });
        fetchResumes();
      } catch (e: any) {
        message.error({ content: e.response?.data?.detail || '评分失败', key: 'score' });
      }
    };

    return (
      <Space size="small" wrap>
        <Tooltip title="预览"><Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => handlePreview(record)} /></Tooltip>
        <Tooltip title="下载"><Button type="text" size="small" icon={<DownloadOutlined style={{ color: '#22C55E' }} />} onClick={() => handleDownload(record)} /></Tooltip>
        <Tooltip title="硬性要求检查"><Button type="text" size="small" icon={<ThunderboltOutlined style={{ color: '#F59E0B' }} />} onClick={handleCheckHard} /></Tooltip>
        <Tooltip title="能力维度评分"><Button type="text" size="small" icon={<StarOutlined style={{ color: '#8B5CF6' }} />} onClick={handleScoreCap} /></Tooltip>
        {isPending && (
          <>
            <Button type="primary" size="small" icon={<CheckOutlined style={{ color: '#52c41a' }} />} onClick={() => handleApproveToTalentPool(record)}>入库</Button>
            <Button size="small" icon={<CloseOutlined />} onClick={() => handleReject(record)}>不入库</Button>
          </>
        )}
        {isApproved && <Tag color="success">已入库</Tag>}
        {isRejected && <Tag color="error">已淘汰</Tag>}
        {hardResult && (
          <Tag color={hardResult.passed ? 'success' : 'error'}>
            {hardResult.passed ? '✅ 硬性通过' : '❌ 硬性不通过'}
          </Tag>
        )}
        {capScores?.scores?.length > 0 && (
          <Tooltip title={capScores.scores.map((s: any) => `${s.dimension}: ${'⭐'.repeat(s.score)}`).join('\n')}>
            <Tag color="purple">能力已评分</Tag>
          </Tooltip>
        )}
        <Tooltip title="删除"><Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)} /></Tooltip>
      </Space>
    );
  };

  const statusTag = (status: string) => {
    const m: Record<string, { color: string; text: string }> = {
      'pending_screening': { color: 'warning', text: '待初筛' },
      'approved': { color: 'success', text: '已入库' },
      'rejected': { color: 'error', text: '已淘汰' },
    };
    const c = m[status] || { color: 'default', text: status || '待初筛' };
    return <Tag color={c.color}>{c.text}</Tag>;
  };

  const screeningResultColor = (result: string) => {
    const cm: Record<string, string> = {
      '强烈推荐': 'success', '推荐': 'cyan', '待定': 'warning',
      '不推荐': 'error', '强烈不推荐': 'error', '通过': 'success', '未通过': 'error',
    };
    if (!result) return null;
    return <Tag color={cm[result] || 'default'}>{result}</Tag>;
  };

  /** 清理年龄显示 */
  const cleanAge = (age: any): string | null => {
    if (age === null || age === undefined || age === '' || age === '无') return null;
    const s = String(age).replace(/岁/g, '').trim();
    if (!s || s === '无' || s === 'None') return null;
    return s + '岁';
  };

  /** 清理性别显示 */
  const cleanGender = (g: any): string | null => {
    if (!g || g === '无' || g === '无相关信息' || g === 'None') return null;
    return g === '男' ? '男' : g === '女' ? '女' : null;
  };

  /** 从 ai_evaluation 中解析能力维度评分明细 */
  const parseScoreDetail = (aiEval: any): { name: string; score: number; reason: string }[] | null => {
    // === 格式1：JSON 对象（来自 D1 ai_evaluation） ===
    if (aiEval && typeof aiEval === 'object' && !Array.isArray(aiEval)) {
      if (Array.isArray(aiEval.dimensions)) return aiEval.dimensions;
    }
    if (typeof aiEval !== 'string' || !aiEval) return null;

    // === 格式2：JSON 双重转义字符串 ===
    // 数据库里存的格式：{"summary": "{\\"dimensions\\": [...]}"}
    // 或者内层 JSON 可能被截断（>500字符），需降级为正则提取
    if (aiEval.startsWith('{')) {
      try {
        const outer = JSON.parse(aiEval);
        if (outer.summary && typeof outer.summary === 'string') {
          try {
            const inner = JSON.parse(outer.summary);
            if (Array.isArray(inner.dimensions) && inner.dimensions.length > 0) {
              return inner.dimensions.map((d: any) => ({
                name: d.name || '',
                score: d.score ?? 0,
                reason: d.reason || '',
              }));
            }
          } catch (_innerErr) {
            // 内层 JSON 被截断，用正则从 summary 字符串中提取维度
            const dims: { name: string; score: number; reason: string }[] = [];
            const re = /"name"\s*:\s*"([^"]*?)"\s*,\s*"score"\s*:\s*(\d+(?:\.\d+)?)\s*,/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(outer.summary)) !== null) {
              dims.push({ name: m[1], score: parseFloat(m[2]), reason: '' });
            }
            if (dims.length > 0) return dims;
          }
        }
      } catch (_outerErr) {
        // 外层 JSON 非标准，看看别的格式
      }
    }

    // === 格式3：文本格式（能力维度匹配） ===
    // 支持各种变体：能力维度匹配：、能力维度匹配**：、能力维度匹配**:
    // 维度行格式：**名称：X/5分。依据：理由、**名称：X/5分**。依据：理由、**名称：X/5分。依据**：理由
    if (aiEval.includes('能力维度匹配')) {
      // 提取维度区块：每个维度行以 "  - **" 开头，下一个章节以 "\n-" 开头（非两个空格后跟短杠）
      const dimSection = aiEval.match(/能力维度匹配\*{0,2}[：:]\s*([\s\S]*?)(?=\n(?!  - )|$)/);
      if (!dimSection) return null;
      const lines = dimSection[1].split('\n').filter(l => l.includes('**'));
      const results: { name: string; score: number; reason: string }[] = [];
      for (const line of lines) {
        // 匹配各种变体：分数可以是整数或小数；** 可能出现在分数后或依据前
        const m = line.match(/\*\*(.+?)[：:]\s*(\d+(?:\.\d+)?)\/5分\*{0,2}[。.]*\s*依据\*{0,2}[：:](.*)/);
        if (m) {
          results.push({
            name: m[1].trim(),
            score: parseFloat(m[2]),
            reason: m[3].replace(/\*\*/g, '').trim(),
          });
        }
      }
      if (results.length > 0) return results;
    }

    return null;
  };

  /** 算总分（根据明细） */
  const calcTotalScore = (details: { score: number }[]): number => {
    return details.length > 0 ? Math.round(details.reduce((s, d) => s + d.score, 0) / details.length * 10) / 10 : 0;
  };

  // 卡片分页
  const pageSize = 20;
  const [cardPage, setCardPage] = useState(1);
  const pagedData = useMemo(() => data.slice((cardPage - 1) * pageSize, cardPage * pageSize), [data, cardPage, pageSize]);

  return (
    <div style={{ maxWidth: '100%' }}>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>简历管理</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>管理候选人简历及面试流程</Text>
        </div>
        <Space size="small" wrap>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleUploadClick}>上传简历</Button>
          <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={() => setBossImportOpen(true)}>BOSS导入</Button>
          <Button type="primary" size="small" icon={<CloudUploadOutlined />} onClick={handleFeishuSync}>飞书导入</Button>
          <Button size="small" icon={pollingEnabled ? <SyncOutlined spin /> : <ReloadOutlined />} onClick={() => fetchResumes()}>
            {pollingEnabled ? '解析中...' : '刷新数据'}
          </Button>
          <Dropdown menu={{
            items: [
              { key: 'auto', label: 'AI 自动评估', icon: <RobotOutlined />, onClick: handleAutoEvaluateAll },
              { key: 'batch', label: 'AI 批量评估', icon: <RobotOutlined />, onClick: handleBatchAIEvaluate },
              { key: 'reparse', label: '全部重解析', icon: <SyncOutlined />, onClick: handleBatchReparse },
              { type: 'divider' },
              { key: 'clear', label: '清除已淘汰', icon: <CloseCircleOutlined />, danger: true, onClick: handleClearRejected },
            ]
          }}>
            <Button size="small" icon={<RobotOutlined />}>AI 工具</Button>
          </Dropdown>
        </Space>
      </div>

      {/* 统计卡片：精简为 4 项 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title={<span style={{ fontSize: 13 }}>总简历数</span>}
              value={data.length}
              suffix="份"
              styles={{ content: { color: '#1677ff', fontSize: 22, fontWeight: 600 } }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title={<span style={{ fontSize: 13 }}>待处理</span>}
              value={data.filter((r: any) => r.status === 'pending_screening').length}
              suffix="人"
              styles={{ content: { color: '#fa8c16', fontSize: 22, fontWeight: 600 } }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title={<span style={{ fontSize: 13 }}>已入库</span>}
              value={data.filter((r: any) => r.status === 'approved').length}
              suffix="人"
              styles={{ content: { color: '#52c41a', fontSize: 22, fontWeight: 600 } }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title={<span style={{ fontSize: 13 }}>已入职</span>}
              value={statsCompletedOnboard}
              suffix="人"
              styles={{ content: { color: '#722ed1', fontSize: 22, fontWeight: 600 } }}
            />
          </Card>
        </Col>
      </Row>

        <Card size="small" style={{ marginBottom: 16, borderRadius: 6 }} styles={{ body: { padding: '12px 16px', overflow: 'visible' } }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <Space size={4}>
              <Text style={{ fontSize: 13, color: '#333' }}>候选人：</Text>
              <Input
                placeholder="姓名"
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                style={{ width: 130 }}
                allowClear
              />
            </Space>
            <Space size={4}>
              <Text style={{ fontSize: 13, color: '#333' }}>状态：</Text>
              <Select
                placeholder="全部"
                value={searchStatus}
                onChange={val => setSearchStatus(val)}
                style={{ width: 120 }}
                allowClear
              >
                <Select.Option value="pending_screening">待初筛</Select.Option>
                <Select.Option value="approved">已入库</Select.Option>
                <Select.Option value="rejected">已淘汰</Select.Option>
              </Select>
            </Space>
            <Space size={4}>
              <Text style={{ fontSize: 13, color: '#333' }}>负责人：</Text>
              <Select
                placeholder="全部"
                value={searchPerson}
                onChange={val => { setSearchPerson(val); }}
                style={{ width: 120 }}
                allowClear
                showSearch
                optionFilterProp="children"
              >
                {responsiblePersons.map((name: string) => (
                  <Select.Option key={name} value={name}>{name}</Select.Option>
                ))}
              </Select>
            </Space>
            <Space size={4}>
              <Text style={{ fontSize: 13, color: '#333' }}>岗位：</Text>
              <Select
                placeholder="全部"
                value={searchPosition}
                onChange={val => setSearchPosition(val)}
                style={{ width: 130 }}
                allowClear
                showSearch
                optionFilterProp="children"
              >
                {positions.map((p: any) => (
                  <Select.Option key={p.id || p.title} value={p.title}>{p.title}</Select.Option>
                ))}
              </Select>
            </Space>
            {selectedRowKeys.length > 0 && (
              <>
                <span style={{ color: '#64748B' }}>已选 {selectedRowKeys.length} 项</span>
                <Button danger size="small" onClick={handleBatchReject}>批量淘汰</Button>
                <Button danger size="small" onClick={handleBatchDelete}>批量删除</Button>
                <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
              </>
            )}
            <div style={{ marginLeft: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 1, height: 20, background: '#E2E8F0' }} />
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
              <Button onClick={handleReset}>重置</Button>
            </div>
          </div>
        </Card>

      {/* 候选人卡片列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <SyncOutlined spin style={{ fontSize: 32, color: '#1677ff' }} />
          <p style={{ marginTop: 12, color: '#666' }}>加载中...</p>
        </div>
      ) : data.length === 0 ? (
        <Empty description="暂无简历数据" style={{ padding: 60 }} />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pagedData.map((record: any) => {
              const ageText = cleanAge(record.age);
              const genderText = cleanGender(record.gender);
              const scoreDetails = parseScoreDetail(record.ai_evaluation);
              const totalScore = scoreDetails ? calcTotalScore(scoreDetails) : null;
              const matchCount = scoreDetails?.filter(d => d.score >= 3).length || 0;
              const totalDims = scoreDetails?.length || 0;

              return (
                <Card
                  key={record.id}
                  size="small"
                  style={{ border: '1px solid #f0f0f0', borderRadius: 8 }}
                  styles={{ body: { padding: '12px 16px' } }}
                  hoverable
                  onClick={() => navigate(`/resumes/${record.id}`)}
                >
                  {/* 顶部：复选框 + 姓名 + 状态 + 操作 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, minHeight: 32 }}>
                    <Checkbox
                      checked={selectedRowKeys.includes(record.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedRowKeys([...selectedRowKeys, record.id]);
                        } else {
                          setSelectedRowKeys(selectedRowKeys.filter(k => k !== record.id));
                        }
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{record.candidate_name || '未知'}</span>
                    <Tooltip title={[genderText, ageText, record.education, record.major].filter(Boolean).join(' · ') || '暂无信息'}>
                      <span style={{ color: '#bfbfbf', fontSize: 12, cursor: 'default', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[genderText, ageText, record.education].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </Tooltip>
                    {record.position_applied && (
                      <Tag style={{ margin: 0 }}>{record.standard_position || record.position_applied}</Tag>
                    )}
                    {statusTag(record.status)}
                    <div style={{ marginLeft: 'auto' }} onClick={e => e.stopPropagation()}>
                      {renderActionButtons(record)}
                    </div>
                  </div>

                  {/* AI 评估维度 — 横向标签式 */}
                  {scoreDetails && scoreDetails.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: '#1677ff', fontWeight: 600, background: '#f0f5ff', padding: '1px 8px', borderRadius: 4 }}>
                          AI 评估 {matchCount}/{totalDims} 符合
                        </span>
                        {totalScore != null && (
                          <span style={{ fontSize: 12, color: '#8c8c8c' }}>综合分 {totalScore}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 4 }}>
                        {scoreDetails.map((d: any, i: number) => {
                          const isMatch = d.score >= 3;
                          const color = d.score >= 4 ? '#52c41a' : d.score >= 3 ? '#1677ff' : d.score >= 2 ? '#fa8c16' : '#ff4d4f';
                          return (
                            <Tooltip key={i} title={d.reason || d.name}>
                              <Tag
                                color={isMatch ? (d.score >= 4 ? 'green' : 'blue') : (d.score >= 2 ? 'orange' : 'red')}
                                style={{ margin: 0, cursor: 'pointer', fontSize: 11, lineHeight: '18px' }}
                              >
                                {d.name} {d.score}/5
                              </Tag>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {(!scoreDetails || scoreDetails.length === 0) && (
                    <div style={{ marginTop: 4 }}>
                      <span style={{ color: '#bfbfbf', fontSize: 12 }}>暂无 AI 评估</span>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          <SimplePagination current={cardPage} pageSize={pageSize} total={data.length} onChange={setCardPage} />
        </>
      )}

      {/* Upload Modal */}
      <Modal
        title="上传简历"
        open={isModalVisible}
        onOk={handleOk}
        onCancel={() => setIsModalVisible(false)}
        confirmLoading={submitting}
        width={500}
        centered
        destroyOnHidden
        okText="上传"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 24 }}
        >
          <Form.Item
            name="position_id"
            label="应聘岗位"
            rules={[{ required: true, message: '请选择应聘岗位' }]}
          >
            <Select placeholder="请选择应聘岗位" size="large" showSearch
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }>
              {positions.map((pos: any) => (
                <Select.Option key={pos.id} value={pos.id}>{pos.title}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="file"
            label="简历文件"
            rules={[{ required: true, message: '请上传简历文件' }]}
            extra="仅支持 PDF 格式，可批量上传"
          >
            <Upload {...uploadProps} maxCount={10}>
              <Button icon={<UploadOutlined />} size="large">选择文件（可多选）</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* Interview Modal */}
      <Modal
        title="安排面试"
        open={interviewModalVisible}
        onOk={handleInterviewOk}
        onCancel={() => setInterviewModalVisible(false)}
        confirmLoading={submitting}
        width={700}
        centered
        destroyOnHidden
        okText="确认"
        cancelText="取消"
      >
        {/* 显示已有面试记录 */}
        {existingInterviews.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
            <Text strong>该候选人已有 {existingInterviews.length} 轮面试：</Text>
            <div style={{ marginTop: 8 }}>
              {existingInterviews.map((i: any) => (
                <Tag key={i.id} color={i.status === 'completed' ? 'green' : 'blue'}>
                  第{i.round || 1}轮 - {i.status === 'completed' ? '已完成' : '待面试'}
                </Tag>
              ))}
            </div>
          </div>
        )}

        <Form
          form={interviewForm}
          layout="vertical"
          style={{ marginTop: 24 }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="round"
                label="面试轮次"
                rules={[{ required: true, message: '请选择面试轮次' }]}
              >
                <Select placeholder="选择轮次" size="large">
                  <Select.Option value={1}>第1轮面试</Select.Option>
                  <Select.Option value={2}>第2轮面试</Select.Option>
                  <Select.Option value={3}>第3轮面试</Select.Option>
                  <Select.Option value={4}>第4轮面试</Select.Option>
                  <Select.Option value={5}>第5轮面试</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="interview_category"
                label="面试类型"
                rules={[{ required: true, message: '请选择面试类型' }]}
                extra="不同类型会生成不同侧重点的面试题"
              >
                <Select placeholder="选择面试类型" size="large">
                  <Select.Option value="hr">HR面</Select.Option>
                  <Select.Option value="technical">技术面</Select.Option>
                  <Select.Option value="manager">主管面</Select.Option>
                  <Select.Option value="ceo">CEO面</Select.Option>
                  <Select.Option value="comprehensive">综合面</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="interview_type"
                label="面试形式"
                rules={[{ required: true, message: '请选择面试形式' }]}
              >
                <Select placeholder="选择面试形式" size="large">
                  <Select.Option value="onsite">现场面试</Select.Option>
                  <Select.Option value="video">视频面试</Select.Option>
                  <Select.Option value="phone">电话面试</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="panel_members"
            label="面试官"
            rules={[{ required: true, message: '请选择面试官' }]}
            extra="选择参与此次面试的面试官（可多选）"
          >
            <Select
              mode="multiple"
              placeholder="选择面试官"
              size="large"
              style={{ width: '100%' }}
            >
              {interviewers.map((user: any) => (
                <Select.Option key={user.id} value={user.id}>{user.full_name || user.email}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="interview_time"
            label="面试时间"
          >
            <DatePicker showTime style={{ width: '100%' }} size="large" />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.interview_type !== currentValues.interview_type}
          >
            {({ getFieldValue }) => {
              const interviewType = getFieldValue('interview_type');
              return (
                <>
                  {interviewType === 'onsite' && (
                    <Form.Item
                      name="interview_location"
                      label="面试地点"
                    >
                      <Input placeholder="请输入面试地点，如：北京市朝阳区xxx大厦A座10层" size="large" />
                    </Form.Item>
                  )}
                  {interviewType === 'video' && (
                    <Form.Item
                      name="meeting_link"
                      label="会议链接"
                    >
                      <Input placeholder="请输入视频会议链接，如：https://meeting.xxx.com/xxx" size="large" />
                    </Form.Item>
                  )}
                </>
              );
            }}
          </Form.Item>

          <Form.Item
            name="skip_ai_questions"
            valuePropName="checked"
            initialValue={false}
            extra="勾选后将跳过AI生成面试题，您可以稍后手动添加题目"
          >
            <Checkbox>跳过AI生成面试题</Checkbox>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.skip_ai_questions !== currentValues.skip_ai_questions}
          >
            {({ getFieldValue }) =>
              !getFieldValue('skip_ai_questions') ? (
                <>
                  <Form.Item
                    name="question_bank_ids"
                    label="参考题库"
                    extra="选择题库后，AI 将参考题库内容生成更精准的面试题"
                  >
                    <Select
                      mode="multiple"
                      placeholder="选择参考题库"
                      size="large"
                      style={{ width: '100%' }}
                    >
                      {questionBanks.map((qb: any) => (
                        <Select.Option key={qb.id} value={qb.id}>{qb.name}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>

                  <Form.Item
                    name="question_count"
                    label="生成题目数量"
                    initialValue={5}
                  >
                    <InputNumber min={1} max={20} size="large" style={{ width: '100%' }} />
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      {/* 邮件预览模态框 */}
      <Modal
        title="邮件预览"
        open={emailPreviewVisible}
        onCancel={handleCancelPreview}
        width={800}
        centered
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={handleCancelPreview}>
            取消
          </Button>,
          <Button key="confirm" type="primary" loading={sendingEmail} onClick={handleConfirmAndSend}>
            确认
          </Button>
        ]}
      >
        {emailContent && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
            <p><strong>收件人：</strong>{emailContent.to_email}</p>
            <p><strong>候选人：</strong>{emailContent.candidate_name}</p>
          </div>
        )}

        <Form form={emailForm} layout="vertical">
          <Form.Item
            name="subject"
            label="邮件主题"
            rules={[{ required: true, message: '请输入邮件主题' }]}
          >
            <Input placeholder="邮件主题" size="large" />
          </Form.Item>

          <Form.Item
            name="content"
            label="邮件内容"
            rules={[{ required: true, message: '请输入邮件内容' }]}
          >
            <Input.TextArea
              rows={10}
              placeholder="邮件内容（支持 HTML 格式）"
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>

          <Form.Item
            label="邮件预览"
          >
            <div
              style={{
                border: '1px solid #d9d9d9',
                borderRadius: 8,
                padding: 16,
                maxHeight: 300,
                overflow: 'auto',
                background: '#fff'
              }}
              dangerouslySetInnerHTML={{ __html: emailForm.getFieldValue('content') || '' }}
            />
          </Form.Item>

          <Form.Item
            name="send_email"
            valuePropName="checked"
            initialValue={true}
          >
            <Checkbox>发送邮件通知候选人</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      {/* 简历预览 Modal - 展示原始 PDF */}
      <Modal
        title={`简历 - ${previewRecord?.candidate_name || ''}`}
        open={previewVisible}
        onCancel={() => { setPreviewPdfUrl(''); setPreviewVisible(false); }}
        footer={[
          <Button key="detail" type="default" onClick={() => { setPreviewPdfUrl(''); setPreviewVisible(false); navigate(`/resumes/${previewRecord?.id}`); }}>
            查看详情
          </Button>,
          <Button key="close" type="primary" onClick={() => { setPreviewPdfUrl(''); setPreviewVisible(false); }}>关闭</Button>
        ]}
        width={1000}
        styles={{ body: { height: '85vh', padding: 0 } }}
      >
        {previewPdfUrl ? (
          <DynamicPdfViewer pdfUrl={previewPdfUrl} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            加载中...
          </div>
        )}
      </Modal>

      {/* 评估维度配置弹窗 */}
      <Modal
        title="设置评估维度"
        open={dimModalOpen}
        onCancel={() => setDimModalOpen(false)}
        afterOpenChange={(open) => {
          if (open) {
            // 打开弹窗时同步最新维度配置到表单
            dimForm.setFieldsValue({
              dimensions: evalDims.map(d => ({ key: d.key, label: d.label, description: d.description, prompt_hint: d.prompt_hint }))
            });
          }
        }}
        onOk={handleSaveEvalDims}
        width={700}
        centered
        destroyOnHidden
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={dimForm}
          layout="vertical"
          style={{ marginTop: 16 }}
        >
          <Form.List name="dimensions">
            {(fields, { add, remove }) => (
              <div>
                {fields.map(({ key, name, ...restField }) => (
                  <Card
                    key={key}
                    size="small"
                    style={{ marginBottom: 12 }}
                    styles={{ body: { padding: 12 } }}
                  >
                    <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontWeight: 500 }}>维度 #{name + 1}</span>
                      {fields.length > 1 && (
                        <Button type="link" danger onClick={() => remove(name)}>删除</Button>
                      )}
                    </Space>
                    <Form.Item
                      {...restField}
                      name={[name, 'label']}
                      label="维度名称"
                      rules={[{ required: true, message: '请输入维度名称' }]}
                    >
                      <Input placeholder="例如：本科、AI 能力" />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'description']}
                      label="维度说明（简短描述此维度评估什么）"
                    >
                      <Input.TextArea rows={2} placeholder="例如：候选人是否具备本科及以上学历" />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'prompt_hint']}
                      label="评估提示词（英文，给 AI 的判断依据）"
                    >
                      <Input.TextArea rows={2} placeholder="例如：Does the candidate have a bachelor's degree or above?" />
                    </Form.Item>
                    {/* 隐藏 key 字段 */}
                    <Form.Item {...restField} name={[name, 'key']} hidden>
                      <Input />
                    </Form.Item>
                  </Card>
                ))}
                <Button type="dashed" onClick={() => add({ key: '', label: '', description: '', prompt_hint: '' })} block icon={<PlusOutlined />}>
                  添加维度
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* BOSS 直聘 Excel 批量导入 */}
      <Modal
        title="BOSS 直聘候选人批量导入"
        open={bossImportOpen}
        onCancel={() => { setBossImportOpen(false); setBossPreview([]); setBossImportResult(null); }}
        footer={null}
        width={800}
        centered
        destroyOnHidden
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            从 BOSS 直聘后台导出候选人 Excel 文件，系统将自动解析并批量进行 AI 评估。
          </Text>
        </div>

        {/* 文件选择 */}
        {bossPreview.length === 0 && !bossImportResult && (
          <div
            style={{
              border: '2px dashed #d9d9d9', borderRadius: 8, padding: 40,
              textAlign: 'center', cursor: 'pointer', background: '#fafafa',
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadOutlined style={{ fontSize: 32, color: '#1677ff' }} />
            <p style={{ marginTop: 12, color: '#666' }}>点击选择 BOSS 导出的 Excel 文件（.xlsx / .xls）</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={handleBossFileSelect}
            />
          </div>
        )}

        {/* 预览数据 */}
        {bossPreview.length > 0 && !bossImportResult && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Text strong>解析到 {bossPreview.length} 条候选人数据</Text>
            </div>
            <div style={{ maxHeight: 400, overflow: 'auto', marginBottom: 16, border: '1px solid #f0f0f0', borderRadius: 4 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fafafa', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>姓名</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>性别</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>年龄</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>学历</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>学校</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>应聘岗位</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>手机号</th>
                  </tr>
                </thead>
                <tbody>
                  {bossPreview.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{row.name}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{row.gender}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{row.age}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{row.education}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{row.school}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{row.position_applied}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{row.phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Space>
              <Button onClick={() => { setBossPreview([]); setBossImportResult(null); }}>重新选择文件</Button>
              <Button type="primary" icon={<DownloadOutlined />} loading={bossImporting} onClick={handleBossImport}>
                确认导入 {bossPreview.length} 条
              </Button>
            </Space>
          </div>
        )}

        {/* 导入结果 */}
        {bossImportResult && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ color: bossImportResult.imported > 0 ? '#52c41a' : '#faad14' }}>
                导入完成：成功 {bossImportResult.imported} 条
                {bossImportResult.skipped > 0 && `，跳过 ${bossImportResult.skipped} 条`}
                {bossImportResult.failed > 0 && `，失败 ${bossImportResult.failed} 条`}
              </Text>
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', marginBottom: 16, border: '1px solid #f0f0f0', borderRadius: 4 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fafafa', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>姓名</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>结果</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {bossImportResult.results?.map((r: any, i: number) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{r.name}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>
                        {r.success ? <Text style={{ color: '#52c41a' }}>✅ 成功</Text> : <Text style={{ color: '#ff4d4f' }}>❌ 失败</Text>}
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Space>
              <Button onClick={() => { setBossImportOpen(false); setBossPreview([]); setBossImportResult(null); fetchResumes(); }}>关闭</Button>
            </Space>
          </div>
        )}
      </Modal>
    </div>
  );
};

/**
 * 动态加载的 PdfViewer：仅在 Modal 打开时才开始加载 pdf.js chunk
 */
function DynamicPdfViewer({ pdfUrl }: { pdfUrl: string }) {
  const [Comp, setComp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    import('../../components/PdfViewer').then(mod => {
      if (!cancelled) { setComp(() => mod.default); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [pdfUrl]);
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'80vh', color:'#999' }}>加载 PDF 引擎...</div>;
  return <Comp pdfUrl={pdfUrl} />;
}

/** 自定义 hover 浮层 — 跟随鼠标位置，不受 Ant Design Popover 布局影响 */
const HoverDetail: React.FC<{
  dimKey: string;
  isMatch: boolean;
  name: string;
  score: number;
  reason: string;
}> = ({ dimKey, isMatch, name, score, reason }) => {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = (e: React.MouseEvent) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setPos({ x: e.clientX, y: e.clientY });
      setHover(true);
    }, 200);
  };
  const handleMove = (e: React.MouseEvent) => {
    if (hover) setPos({ x: e.clientX, y: e.clientY });
  };
  const handleLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setHover(false);
  };

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12,
        padding: '3px 10px', borderRadius: 4, cursor: 'default',
        background: isMatch ? '#f6ffed' : '#fff2f0',
        border: `1px solid ${isMatch ? '#b7eb8f' : '#ffccc7'}`,
      }}
      onMouseEnter={handleEnter}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <span style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>
        {isMatch ? '✅' : '❌'}
      </span>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
        {name}
      </span>
      <span style={{ fontWeight: 600, color: isMatch ? '#52c41a' : '#ff4d4f', flexShrink: 0, minWidth: 20, textAlign: 'right' }}>
        {score}
      </span>
      {hover && (
        <span style={{
          position: 'fixed',
          left: pos.x + 18,
          top: pos.y - 10,
          transform: 'translateY(-100%)',
          zIndex: 9999,
          maxWidth: 320,
          fontSize: 13,
          lineHeight: 1.6,
          background: '#fff',
          border: '1px solid #d9d9d9',
          borderRadius: 8,
          padding: '10px 14px',
          boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
          pointerEvents: 'none',
          whiteSpace: 'normal',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{name}</div>
          <div style={{ color: isMatch ? '#52c41a' : '#ff4d4f', fontSize: 12, marginBottom: 4 }}>
            {isMatch ? '符合' : '不符合'}（分数：{score}）
          </div>
          <div style={{ color: '#595959', fontSize: 12, whiteSpace: 'pre-wrap' }}>{reason}</div>
        </span>
      )}
    </span>
  );
};

export default ResumesList;
