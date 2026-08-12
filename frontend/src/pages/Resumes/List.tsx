import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Table, Button, Space, message, Tag, Modal, Tooltip, Typography, Form, Select, Upload, Input, DatePicker, InputNumber, Card, Row, Col, Checkbox, Statistic, Pagination, Empty, Avatar, Badge, Dropdown, Progress } from 'antd';
import { PlusOutlined, EyeOutlined, TeamOutlined, DeleteOutlined, DownloadOutlined, UploadOutlined, ReloadOutlined, CloseCircleOutlined, SearchOutlined, SolutionOutlined, SyncOutlined, FileTextOutlined, CheckOutlined, CloseOutlined, UserOutlined, EnvironmentOutlined, BookOutlined, InfoCircleOutlined, EditOutlined, SettingOutlined, RobotOutlined, CloudUploadOutlined } from '@ant-design/icons';
import DOMPurify from 'dompurify';
import request from '../../utils/request';
import { downloadExcel } from '../../utils/exportExcel';
import SimplePagination from '../../components/SimplePagination';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { formatWeightedScore, getDimensionScoreTotal, getScreeningGateRows, normalizeResumeEvaluation } from '../../utils/resumeEvaluation';
import { sortResumesNewestFirst } from '../../utils/resumeSort';
import { getCurrentPageSelectionState, toggleCurrentPageSelection } from '../../utils/resumeSelection';
import { createRefreshVersion } from '../../utils/resumeRefresh';
import { buildResumeExportRows } from '../../utils/resumeExport';
import { PageHeader, ResponsiveModal, ResponsiveToolbar, TableViewport } from '../../components/Responsive';
import ResumeReprocessProgress from '../../components/ResumeReprocessProgress';
import { getEvaluationCardState } from '../../utils/resumeReprocess';
import { type ReprocessBatchView } from '../../utils/resumeReprocess';

// PdfViewer 只在使用时动态加载（参见 renderPreviewModal）
let PdfViewer: any = null;
let pdfjsModulePromise: Promise<typeof import('pdfjs-dist')> | null = null;

const loadPdfjs = () => {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist').then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.js',
        import.meta.url,
      ).toString();
      return pdfjsLib;
    });
  }
  return pdfjsModulePromise;
};

const { Title, Text } = Typography;
const RESUME_PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
const DEFAULT_RESUME_PAGE_SIZE = 20;

type ResumeListStats = {
  total: number;
  pending_screening: number;
  approved: number;
  rejected: number;
  offer_pending: number;
  offer_accepted: number;
  offer_rejected: number;
  onboarding: number;
  completed: number;
};

const EMPTY_RESUME_LIST_STATS: ResumeListStats = {
  total: 0,
  pending_screening: 0,
  approved: 0,
  rejected: 0,
  offer_pending: 0,
  offer_accepted: 0,
  offer_rejected: 0,
  onboarding: 0,
  completed: 0,
};

function getResumeListStats(response: any, items: any[]): ResumeListStats {
  const supplied = !Array.isArray(response) && response?.stats && typeof response.stats === 'object'
    ? response.stats
    : {};
  const countStatus = (status: string) => items.filter((item) => item?.status === status).length;
  const value = (key: keyof ResumeListStats, fallback: number) => Number.isFinite(Number(supplied[key]))
    ? Number(supplied[key])
    : fallback;
  return {
    total: value('total', Number(response?.total) || items.length),
    pending_screening: value('pending_screening', countStatus('pending_screening')),
    approved: value('approved', countStatus('approved')),
    rejected: value('rejected', countStatus('rejected')),
    offer_pending: value('offer_pending', countStatus('offer_pending')),
    offer_accepted: value('offer_accepted', countStatus('offer_accepted')),
    offer_rejected: value('offer_rejected', countStatus('offer_rejected')),
    onboarding: value('onboarding', countStatus('onboarding')),
    completed: value('completed', countStatus('completed')),
  };
}

const ResumesList: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [listStats, setListStats] = useState<ResumeListStats>(EMPTY_RESUME_LIST_STATS);
  const [cardPage, setCardPage] = useState(1);
  const [cardPageSize, setCardPageSize] = useState(DEFAULT_RESUME_PAGE_SIZE);
  const cardPageRef = useRef(1);
  const cardPageSizeRef = useRef(DEFAULT_RESUME_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState([]);
  const [questionBanks, setQuestionBanks] = useState([]);
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchApproving, setBatchApproving] = useState(false);
  const canBatchApproveToTalentPool = user?.role === 'admin' || user?.role === 'hr';

  // Batch reprocess state
  const [reprocessBatch, setReprocessBatch] = useState<ReprocessBatchView | null>(null);
  const reprocessPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reprocessVersionRef = useRef(0);
  
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [interviewModalVisible, setInterviewModalVisible] = useState(false);
  const [interviewRecord, setInterviewRecord] = useState<any>(null);
  const [existingInterviews, setExistingInterviews] = useState<any[]>([]);
  const [emailPreviewVisible, setEmailPreviewVisible] = useState(false);
  const [emailContent, setEmailContent] = useState<any>(null);
  const [createdInterviewId, setCreatedInterviewId] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailForm] = Form.useForm();
  const watchedEmailContent = Form.useWatch('content', emailForm);
  const [pendingInterviewData, setPendingInterviewData] = useState<any>(null);

  const [fileList, setFileList] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  
  const [form] = Form.useForm();
  const [interviewForm] = Form.useForm();
  
  const navigate = useNavigate();

  // 筛选条件持久化到 sessionStorage，从详情页返回后自动恢复
  const FILTER_KEY = 'resume_list_filters';
  const loadFilters = (): Record<string, string> => {
    try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; }
  };
  const saveFilters = (f: Record<string, string>) => {
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch {}
  };
  const [filters, setFiltersState] = useState<Record<string, string>>(loadFilters);
  const setFilters = (f: Record<string, string>) => { setFiltersState(f); saveFilters(f); };
  const filterVal = (key: string) => filters[key] || undefined;
  const setFilter = (key: string, v: string | undefined) => {
    const next = { ...filters };
    if (v) next[key] = v; else delete next[key];
    setFilters(next);
  };
  const searchStatus = filterVal('status');
  const setSearchStatus = (v: string | undefined) => setFilter('status', v);
  const searchCandidateName = filterVal('candidate_name');
  const setSearchCandidateName = (v: string | undefined) => setFilter('candidate_name', v);
  const searchPosition = filterVal('position');
  const setSearchPosition = (v: string | undefined) => setFilter('position', v);
  const searchMajor = filterVal('major');
  const setSearchMajor = (v: string | undefined) => setFilter('major', v);
  const searchEducation = filterVal('education');
  const setSearchEducation = (v: string | undefined) => setFilter('education', v);
  const minimumAge = filterVal('min_age') ? Number(filterVal('min_age')) : null;
  const setMinimumAge = (v: number | null) => setFilter('min_age', v !== null ? String(v) : undefined);
  const maximumAge = filterVal('max_age') ? Number(filterVal('max_age')) : null;
  const setMaximumAge = (v: number | null) => setFilter('max_age', v !== null ? String(v) : undefined);
  const genderFilters = filterVal('genders') ? filterVal('genders')!.split(',') : [];
  const setGenderFilters = (v: string[]) => setFilter('genders', v.length > 0 ? v.join(',') : undefined);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewRecord, setPreviewRecord] = useState<any>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string>('');
  // 前端缓存，切页面回来不重新拉飞书
  const dataCache = useRef<any[]>([]);
  const loadedRef = useRef(false);
  const resumeRefreshVersion = useRef(createRefreshVersion());

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

  const handleStartReprocess = async (scope: 'all' | 'incomplete_or_failed') => {
    const scopeLabel = scope === 'all' ? '全部重评' : '重评未评估/失败简历';
    Modal.confirm({
      title: `确认${scopeLabel}`,
      content: scope === 'all'
        ? `将对当前登录用户可见的全部简历进行重新评估。本次会清除这些简历当前的 AI 评估结果，并重新提取字段和评分。人工复核状态、面试记录和候选人业务状态不会被修改。`
        : `将对当前用户可见且符合未评估或最近评估失败规则的简历进行重新评估。本次会清除这些简历当前的 AI 评估结果，并重新提取字段和评分。`,
      okText: '确认',
      cancelText: '取消',
      okType: 'primary',
      onOk: async () => {
        const hide = message.loading('正在提交批量重新评估...', 0);
        try {
          const res = await request.post('/resumes/batch-reprocess-scoped', { scope });
          hide();
          if (res.batch_id) {
            setReprocessBatch(null);
            await fetchReprocessBatch(res.batch_id);
            fetchResumes(false, 1, cardPageSizeRef.current);
            message.success(`已提交 ${scopeLabel}，共 ${res.total || 0} 份简历`);
          } else if (res.message) {
            message.info(res.message);
          }
        } catch (error: any) {
          hide();
          const detail = error?.response?.data?.detail || '批量重新评估失败';
          if (error?.response?.status === 409) {
            const existingBatchId = error?.response?.data?.batch_id;
            if (existingBatchId) {
              await fetchReprocessBatch(existingBatchId);
              message.warning('当前已有批次在处理中，请等待完成');
            }
          } else {
            message.error(detail);
          }
        }
      },
    });
  };

  const fetchReprocessBatch = async (batchId: string, silent = false) => {
    try {
      const res = await request.get(`/resumes/reprocess-batches/${batchId}`);
      setReprocessBatch(res);
      if (!silent) fetchResumes(false, cardPageRef.current, cardPageSizeRef.current);
    } catch {
      if (!silent) {}
    }
  };

  const fetchActiveReprocessBatch = async () => {
    try {
      const res = await request.get('/resumes/reprocess-batches/active');
      const batch = res?.batch || null;
      setReprocessBatch(batch);
      return batch;
    } catch {
      return null;
    }
  };

  const startReprocessPolling = () => {
    stopReprocessPolling();
    const poll = async () => {
      const version = ++reprocessVersionRef.current;
      if (reprocessBatch?.batch_id) {
        try {
          const res = await request.get(`/resumes/reprocess-batches/${reprocessBatch.batch_id}`);
          if (version === reprocessVersionRef.current) {
            setReprocessBatch(res);
            fetchResumes(true, cardPageRef.current, cardPageSizeRef.current);
          }
        } catch {}
      }
    };
    poll();
    reprocessPollingRef.current = setInterval(poll, 4000);
  };

  const stopReprocessPolling = () => {
    reprocessVersionRef.current += 1;
    if (reprocessPollingRef.current) {
      clearInterval(reprocessPollingRef.current);
      reprocessPollingRef.current = null;
    }
  };

  const handleCancelReprocess = async () => {
    const batchId = reprocessBatch?.batch_id;
    if (!batchId) return;
    stopReprocessPolling();
    setPollingEnabled(false);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    try {
      const res = await request.post(`/resumes/reprocess-batches/${batchId}/cancel`);
      setReprocessBatch(res);
      message.success('已停止批量重新评估');
    } catch (error: any) {
      const detail = error?.response?.data?.detail || '停止批量重新评估失败';
      message.error(detail);
      await fetchReprocessBatch(batchId, true);
    }
  };

  const handleBatchReparse = async () => {
    // Deprecated: use handleStartReprocess('all') instead
  };

  const buildListParams = (page: number, pageSize: number) => {
    const params: any = { page, page_size: pageSize };
    if (searchCandidateName?.trim()) params.candidate_name = searchCandidateName.trim();
    if (searchStatus) {
      if (searchStatus === 'screening_passed') {
        params.screening_result = '通过';
      } else if (searchStatus === 'screening_failed') {
        params.screening_result = '不通过';
      } else {
        params.status = searchStatus;
      }
    }
    if (searchPosition) params.position = searchPosition;
    if (searchMajor) params.major = searchMajor;
    if (searchEducation) params.education = searchEducation;
    if (minimumAge !== null) params.min_age = minimumAge;
    if (maximumAge !== null) params.max_age = maximumAge;
    if (genderFilters.length > 0) params.genders = genderFilters.join(',');
    return params;
  };

  const fetchResumes = async (
    silent = false,
    requestedPage = cardPageRef.current,
    requestedPageSize = cardPageSizeRef.current,
  ) => {
    const requestVersion = resumeRefreshVersion.current.capture();
    if (!silent) setLoading(true);
    try {
      const params = buildListParams(requestedPage, requestedPageSize);
      const res = await request.get('/resumes', { params });
      if (!resumeRefreshVersion.current.isCurrent(requestVersion)) return res;
      const items = Array.isArray(res) ? res : (res.items || []);
      // 岗位/专业/年龄/性别筛选已由服务端 SQL 完成（支持跨页 + 分页统计）
      const sorted = sortResumesNewestFirst(items);
      setData(sorted);
      const nextStats = getResumeListStats(res, items);
      const lastPage = Math.max(1, Math.ceil(nextStats.total / requestedPageSize));
      if (requestedPage > lastPage) {
        cardPageRef.current = lastPage;
        setCardPage(lastPage);
        return fetchResumes(silent, lastPage, requestedPageSize);
      }
      setListStats(nextStats);
      dataCache.current = sortResumesNewestFirst(items);
      loadedRef.current = true;

      // 页面只观察 D1 中的任务状态，绝不因加载/刷新/路由切换而创建 AI 任务。
      const activeStatuses = new Set(['queued', 'extracting_text', 'extracting_fields', 'screening']);
      setPollingEnabled(items.some((r: any) => activeStatuses.has(r.parse_status)));

      return res;
    } catch (error) {
      if (!silent) message.error('获取简历列表失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // 轮询检查解析状态 - 每 5 秒刷新数据，让用户能看到评估进度
  useEffect(() => {
    if (pollingEnabled) {
      pollingRef.current = setInterval(async () => {
        const requestVersion = resumeRefreshVersion.current.capture();
        try {
          const res = await request.get('/resumes', {
            params: buildListParams(cardPageRef.current, cardPageSizeRef.current),
          });
          if (!resumeRefreshVersion.current.isCurrent(requestVersion)) return;
          const pollItems = Array.isArray(res) ? res : (res.items || []);
          if (pollItems.length > 0 || Array.isArray(res)) {
            // 更新数据展示（让用户看到实时进度）
            setData(sortResumesNewestFirst(pollItems));
            setListStats(getResumeListStats(res, pollItems));
            
            const activeStatuses = new Set(['queued', 'extracting_text', 'extracting_fields', 'screening']);
            const hasProcessing = pollItems.some((r: any) => activeStatuses.has(r.parse_status));
            if (!hasProcessing) {
              setPollingEnabled(false);
              setLoading(false);
              clearInterval(pollingRef.current!);
              pollingRef.current = null;
              // 延迟 500ms 再刷新一次，确保最后的数据写入完成
              setTimeout(() => fetchResumes(true), 500);
            }
          }
        } catch {}
      }, 5000);
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
  }, [pollingEnabled, searchStatus, searchPosition, searchMajor, searchEducation, minimumAge, maximumAge, genderFilters]);

  // Batch reprocess polling
  useEffect(() => {
    if (reprocessBatch && (reprocessBatch.status === 'queued' || reprocessBatch.status === 'running')) {
      startReprocessPolling();
    } else {
      stopReprocessPolling();
    }
    return stopReprocessPolling;
  }, [reprocessBatch?.batch_id, reprocessBatch?.status]);

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
    fetchPositions();
    fetchResumes(false, 1, cardPageSizeRef.current);
    fetchActiveReprocessBatch();
    const loadDeferredConfig = () => {
      fetchQuestionBanks();
      fetchInterviewers();
      fetchCapDims();
      fetchEvalDims();
    };
    const idle = (window as any).requestIdleCallback;
    if (typeof idle === 'function') {
      const idleId = idle(loadDeferredConfig, { timeout: 1500 });
      return () => (window as any).cancelIdleCallback?.(idleId);
    }
    const timer = window.setTimeout(loadDeferredConfig, 0);
    return () => window.clearTimeout(timer);
  }, []);



  const handleSearch = () => {
    cardPageRef.current = 1;
    setCardPage(1);
    fetchResumes(false, 1, cardPageSizeRef.current);
  };

  const handleReset = () => {
    setSearchStatus(undefined);
    setSearchCandidateName(undefined);
    setSearchPosition(undefined);
    setSearchMajor(undefined);
    setMinimumAge(null);
    setMaximumAge(null);
    setGenderFilters([]);
    setCardPage(1);
    dataCache.current = [];
    loadedRef.current = false;
    cardPageRef.current = 1;
    setLoading(true);
    request.get('/resumes', { params: { page: 1, page_size: cardPageSizeRef.current } })
      .then(res => {
        const items = Array.isArray(res) ? res : (res.items || []);
        setData(items);
        setListStats(getResumeListStats(res, items));
        const hasProcessing = items.some((r: any) => r.parse_status === 'processing' || r.parse_status === 'pending_screening');
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

  const handleBatchApproveToTalentPool = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要入库的简历');
      return;
    }
    const selectedIds = selectedRowKeys.map(String);
    Modal.confirm({
      title: '确认批量入库',
      content: `确定将选中的 ${selectedIds.length} 份简历入人才库吗？`,
      okText: '确认入库',
      cancelText: '取消',
      onOk: async () => {
        setBatchApproving(true);
        try {
          const res = await request.post('/resumes/batch-approve-to-talent-pool', { ids: selectedIds });
          const approvedIds = Array.isArray(res.approved) ? res.approved : [];
          const skipped = Array.isArray(res.skipped) ? res.skipped.length : 0;
          const failed = Array.isArray(res.failed) ? res.failed.length : 0;
          message.success(`批量入库完成：成功 ${approvedIds.length} 份，跳过 ${skipped} 份，失败 ${failed} 份`);
          setSelectedRowKeys(keys => keys.filter(id => !approvedIds.includes(String(id))));
          dataCache.current = [];
          loadedRef.current = false;
          fetchResumes();
        } catch (error: any) {
          message.error(error?.response?.data?.detail || '批量入库失败');
        } finally {
          setBatchApproving(false);
        }
      },
    });
  };

  const handleApproveToTalentPool = async (record: any) => {
    // 乐观更新：立即更新本地卡片状态，不等后端返回
    resumeRefreshVersion.current.invalidate();
    setData(prev => prev.map(r => r.id === record.id ? { ...r, status: 'approved', screening_result: '通过' } : r));
    dataCache.current = [];
    loadedRef.current = false;
    try {
      await request.post(`/resumes/${record.id}/approve-to-talent-pool`);
      message.success(`${record.candidate_name} 已入库`);
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '入库失败');
    }
    // 后台刷新，不阻塞 UI
    fetchResumes(true);
  };

  // 从 PDF 文件提取纯文本（零 Token，带超时保护）
  const extractPdfText = async (file: File): Promise<string> => {
    try {
      const pdfjsLib = await loadPdfjs();
      const arrayBuffer = await file.arrayBuffer();
      // 10 秒超时：大 PDF 或扫描件可能在本地提取太慢，直接走服务端 AI
      const pdf = await Promise.race([
        pdfjsLib.getDocument({ data: arrayBuffer }).promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]);
      let fullText = '';
      for (let i = 1; i <= pdf.numPages && i <= 20; i++) { // 最多 20 页，避免超大 PDF 卡死
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        fullText += pageText + '\n';
      }
      return fullText.trim() || '';
    } catch {
      return ''; // 扫描版 PDF / 超时 / 超�� → 回落服务端 AI 解析
    }
  };

  
  const handleExportExcel = () => {
    if (data.length === 0) { message.warning('暂无数据可导出'); return; }
    const rows = buildResumeExportRows(data);
    downloadExcel(rows, `简历导出_${new Date().toISOString().slice(0, 10)}`);
    message.success('导出成功');
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

  // MinerU 扫描件解析流程：sign → PUT 直传 → 轮询 → 建记录 + ocr-parse 落库
  const mineruFlow = async (file: File, positionId: string): Promise<void> => {
    const isOcr = true; // 扫描件场景，强制开启 OCR
    const authHeader = { Authorization: `Bearer ${localStorage.getItem('token') || ''}` };

    // ① 获取签名上传 URL
    const signRes = await request.post('/mineru/sign', { file_name: file.name, is_ocr: isOcr }) as any;
    if (!signRes?.task_id || !signRes?.file_url) {
      throw new Error(signRes?.detail || 'MinerU 签名失败');
    }
    const { task_id: taskId, file_url: fileUrl } = signRes;

    // ② PUT 直传文件到 MinerU OSS
    const putRes = await fetch(fileUrl, { method: 'PUT', body: file });
    if (putRes.status !== 200 && putRes.status !== 201) {
      throw new Error(`文件上传 MinerU 失败 (HTTP ${putRes.status})`);
    }

    // ③ 轮询解析状态（前端轮询，最多约 4 分钟）
    let markdown = '';
    const pollStart = Date.now();
    while (Date.now() - pollStart < 240000) {
      await new Promise((r) => setTimeout(r, 3000));
      const st = await request.get(`/mineru/status/${taskId}`) as any;
      if (st?.status === 'done' && st.markdown) {
        markdown = st.markdown;
        break;
      }
      if (st?.status === 'failed') {
        throw new Error(st?.detail || 'MinerU 解析失败');
      }
    }
    if (!markdown) throw new Error('MinerU 解析超时，请稍后在详情页点击「重新解析」');

    // ④ 先建空记录（ocr_pending）拿 id，再 ocr-parse 落库
    const fd = new FormData();
    if (positionId) fd.append('position_id', positionId);
    fd.append('file', file);
    fd.append('ocr_pending', 'true');
    const created = await request.post('/resumes', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }) as any;
    if (!created?.id) throw new Error('创建简历记录失败');

    await request.post(`/resumes/${created.id}/ocr-parse`, { markdown });
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
      if (fileList.length === 1 && (firstFile.type === 'application/pdf' || firstFile.name?.endsWith('.pdf'))) {
        try {
          rawText = await extractPdfText(firstFile);
          if (rawText) console.log(`[PDF] 提取文本 ${rawText.length} 字符`);
        } catch { /* 回落 AI */ }
      }
      
      // Determine if single or batch upload
      if (fileList.length === 1) {
        // 文本和扫描件都只上传一次并入队；MinerU 由 Worker consumer 调用，
        // 避免浏览器跨域直传 OSS 被 CORS 拦截，也保证离开页面后仍会继续处理。
        const formData = new FormData();
        if (values.position_id) formData.append('position_id', values.position_id);
        formData.append('file', fileList[0]);
        if (rawText) formData.append('raw_text', rawText);
        await request.post('/resumes', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        message.success(rawText ? '简历已入队，AI 初筛将在后台进行...' : '扫描简历已入队，正在后台 OCR 和初筛...');
        loadedRef.current = false;
        dataCache.current = [];
        fetchResumes();
      } else {
        // 批量上传：逐文件异步上传，每个 ~2s 返回不阻塞
        let uploadedCount = 0;
        for (const file of fileList) {
          try {
            const formData = new FormData();
            if (values.position_id) formData.append('position_id', values.position_id);
            formData.append('file', file);
            // 尝试用 pdfjs 提取文本
            let fileRawText = '';
            try { fileRawText = await extractPdfText(file); } catch {}
            if (fileRawText) formData.append('raw_text', fileRawText);
            const uploadRes = await request.post('/resumes', formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
            uploadedCount++;
          } catch (e) {
            console.error('批量上传单文件失败:', file.name, e);
          }
        }
        message.success(`成功上传 ${uploadedCount}/${fileList.length} 份简历，AI 初筛将在后台自动进行...`);
        // 清除缓存并刷新列表
        loadedRef.current = false;
        dataCache.current = [];
      }

      setIsModalVisible(false);
      // 上传后强制刷新（不走缓存）
      loadedRef.current = false;
      dataCache.current = [];
      fetchResumes();
    } catch (error) {
      message.error(error?.response?.data?.detail || error?.message || '上传失败');
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
      if (file.size && file.size > 10 * 1024 * 1024) {
        message.error('文件大小不能超过 10MB');
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

    return (
      <Space size="small" wrap>
        <Tooltip title="预览"><Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => handlePreview(record)} /></Tooltip>
        <Tooltip title="下载"><Button type="text" size="small" icon={<DownloadOutlined style={{ color: '#22C55E' }} />} onClick={() => handleDownload(record)} /></Tooltip>
        {hardResult?.passed === false && <Tag color="error">❌ 硬性不通过</Tag>}
        {isPending && (
          <>
            <Button type="primary" size="small" icon={<CheckOutlined style={{ color: '#52c41a' }} />} onClick={() => handleApproveToTalentPool(record)}>入库</Button>
            <Button size="small" icon={<CloseOutlined />} onClick={() => handleReject(record)}>不入库</Button>
          </>
        )}
        {isApproved && <Tag color="success">已入库</Tag>}
        {isRejected && <Tag color="error">已淘汰</Tag>}
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

  const parseHardRequirementResult = (value: any): { passed?: boolean; unmet_items?: string[]; unknown_items?: string[] } | null => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return null; }
  };

  // 服务端分页：data 只包含当前页，total 来自后端统计。
  const pagedData = data;
  const handleCardPageChange = (page: number) => {
    cardPageRef.current = page;
    setCardPage(page);
    fetchResumes(false, page, cardPageSizeRef.current);
  };
  const handleCardPageSizeChange = (nextPageSize: number) => {
    cardPageSizeRef.current = nextPageSize;
    cardPageRef.current = 1;
    setCardPageSize(nextPageSize);
    setCardPage(1);
    fetchResumes(false, 1, nextPageSize);
  };
  const currentPageIds = useMemo(() => pagedData.map((record: any) => record.id).filter(Boolean), [pagedData]);
  const currentPageSelection = useMemo(
    () => getCurrentPageSelectionState(selectedRowKeys, currentPageIds),
    [selectedRowKeys, currentPageIds],
  );

  // 专业筛选选项：从全部加载数据中提取去重（兼容数组和字符串）
  const majorOptions = Array.from(new Set((dataCache.current || []).map((r: any) => {
    const v = r.major;
    if (Array.isArray(v)) return v.filter(Boolean).join('、');
    return (v || '').toString().trim();
  }).filter(Boolean)));
  // 学历筛选选项：从全部加载数据中提取去重（兼容数组和字符串）
  const educationOptions = Array.from(new Set((dataCache.current || []).map((r: any) => {
    const v = r.education;
    if (Array.isArray(v)) return v.filter(Boolean).join('、');
    return (v || '').toString().trim();
  }).filter(Boolean)));

  return (
    <div style={{ maxWidth: '100%' }}>
      <PageHeader
        title="简历管理"
        description="管理候选人简历及面试流程"
        actions={
          <>
            <Space size="small" wrap>
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleUploadClick}>上传简历</Button>
              <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={handleExportExcel}>导出 Excel</Button>
              <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={() => setBossImportOpen(true)}>BOSS导入</Button>
              <Button type="primary" size="small" icon={<CloudUploadOutlined />} onClick={handleFeishuSync}>飞书导入</Button>
            </Space>
            <Space size="small" wrap>
              <Button size="small" icon={pollingEnabled ? <SyncOutlined spin /> : <ReloadOutlined />} onClick={() => fetchResumes()}>
                {pollingEnabled ? '解析中...' : '刷新数据'}
              </Button>
              <Dropdown menu={{
                items: [
                  { key: 'all-reprocess', label: '全部重评', icon: <SyncOutlined />, onClick: () => handleStartReprocess('all') },
                  { key: 'incomplete-reprocess', label: '重评未评估/失败简历', icon: <SyncOutlined />, onClick: () => handleStartReprocess('incomplete_or_failed') },
                  { type: 'divider' },
                  { key: 'clear', label: '清除已淘汰', icon: <CloseCircleOutlined />, danger: true, onClick: handleClearRejected },
                ]
              }}>
                <Button size="small" icon={<RobotOutlined />}>AI 工具</Button>
              </Dropdown>
            </Space>
          </>
        }
      />

      <ResumeReprocessProgress
        batch={reprocessBatch}
        onShowFailed={() => handleStartReprocess('incomplete_or_failed')}
        onCancel={handleCancelReprocess}
      />

      {/* 统计卡片：精简为 4 项 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={12} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title={<span style={{ fontSize: 13 }}>总简历数</span>}
              value={listStats.total}
              suffix="份"
              styles={{ content: { color: '#1677ff', fontSize: 22, fontWeight: 600 } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={12} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title={<span style={{ fontSize: 13 }}>待处理</span>}
              value={listStats.pending_screening}
              suffix="人"
              styles={{ content: { color: '#fa8c16', fontSize: 22, fontWeight: 600 } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={12} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title={<span style={{ fontSize: 13 }}>已入库</span>}
              value={listStats.approved}
              suffix="人"
              styles={{ content: { color: '#52c41a', fontSize: 22, fontWeight: 600 } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={12} lg={6}>
          <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title={<span style={{ fontSize: 13 }}>已入职</span>}
              value={listStats.completed + listStats.offer_accepted}
              suffix="人"
              styles={{ content: { color: '#722ed1', fontSize: 22, fontWeight: 600 } }}
            />
          </Card>
        </Col>
      </Row>

        <Card size="small" style={{ marginBottom: 16, borderRadius: 6 }} styles={{ body: { padding: '12px 16px', overflow: 'visible' } }}>
          <ResponsiveToolbar
            actions={<>
              {selectedRowKeys.length > 0 && (
                <>
                  <span style={{ color: '#64748B' }}>已选 {selectedRowKeys.length} 项</span>
                  {canBatchApproveToTalentPool && (
                    <Button type="primary" size="small" loading={batchApproving} disabled={batchApproving} onClick={handleBatchApproveToTalentPool}>批量入库</Button>
                  )}
                  <Button danger size="small" onClick={handleBatchReject}>批量淘汰</Button>
                  <Button danger size="small" onClick={handleBatchDelete}>批量删除</Button>
                  <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
                </>
              )}
              <Checkbox
                checked={currentPageSelection.checked}
                indeterminate={currentPageSelection.indeterminate}
                disabled={currentPageIds.length === 0}
                onChange={(event) => setSelectedRowKeys((previous) => toggleCurrentPageSelection(previous, currentPageIds, event.target.checked))}
              >
                全选本页
              </Checkbox>
              <div className="resume-toolbar__search-actions">
                <span style={{ width: 1, height: 20, background: '#E2E8F0' }} />
                <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
                <Button onClick={handleReset}>重置</Button>
              </div>
            </>}
          >
            <div className="resume-toolbar__field">
              <Space size={4}>
                <Text style={{ fontSize: 13, color: '#333' }}>面试者：</Text>
                <Input
                  allowClear
                  value={searchCandidateName}
                  onChange={event => setSearchCandidateName(event.target.value)}
                  onPressEnter={handleSearch}
                  placeholder="搜索面试者姓名"
                  style={{ width: 150 }}
                />
              </Space>
            </div>
            <div className="resume-toolbar__field">
              <Space size={4}>
              <Text style={{ fontSize: 13, color: '#333' }}>筛选：</Text>
              <Select
                placeholder="全部"
                value={searchStatus}
                onChange={val => setSearchStatus(val)}
                style={{ width: 140 }}
                allowClear
              >
                <Select.Option value="pending_screening">待初筛</Select.Option>
                <Select.Option value="approved">已入库</Select.Option>
                <Select.Option value="rejected">已淘汰</Select.Option>
                <Select.Option value="screening_passed">AI 通过</Select.Option>
                <Select.Option value="screening_failed">AI 不通过</Select.Option>
              </Select>
              </Space>
            </div>
            <div className="resume-toolbar__field"><Space size={4}>
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
            </Space></div>
            <div className="resume-toolbar__field"><Space size={4}>
              <Text style={{ fontSize: 13, color: '#333' }}>专业：</Text>
              <Select
                placeholder="全部"
                value={searchMajor}
                onChange={val => setSearchMajor(val)}
                style={{ width: 130 }}
                allowClear
                showSearch
                optionFilterProp="children"
              >
                {majorOptions.map((m: string) => (
                  <Select.Option key={m} value={m}>{m}</Select.Option>
                ))}
              </Select>
            </Space></div>

            <div className="resume-toolbar__field"><Space size={4}>
              <Text style={{ fontSize: 13, color: '#333' }}>学历：</Text>
              <Select
                placeholder="全部"
                value={searchEducation}
                onChange={val => setSearchEducation(val)}
                style={{ width: 110 }}
                allowClear
                showSearch
                optionFilterProp="children"
              >
                {educationOptions.map((e: string) => (
                  <Select.Option key={e} value={e}>{e}</Select.Option>
                ))}
              </Select>
            </Space></div>

            <div className="resume-toolbar__field"><Space size={4}>
              <Text style={{ fontSize: 13, color: '#333' }}>年龄：</Text>
              <InputNumber min={0} max={100} value={minimumAge} onChange={value => setMinimumAge(value == null ? null : Number(value))} placeholder="最小" style={{ width: 70 }} />
              <span style={{ color: '#94A3B8' }}>—</span>
              <InputNumber min={0} max={100} value={maximumAge} onChange={value => setMaximumAge(value == null ? null : Number(value))} placeholder="最大" style={{ width: 70 }} />
            </Space></div>
            <div className="resume-toolbar__field"><Space size={4}>
              <Text style={{ fontSize: 13, color: '#333' }}>性别：</Text>
              <Checkbox.Group
                options={['男', '女', '未识别']}
                value={genderFilters}
                onChange={(values) => setGenderFilters(values.map(String))}
              />
            </Space></div>
          </ResponsiveToolbar>
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
              const normalizedEvaluation = normalizeResumeEvaluation(record);
              const scoreDetails = normalizedEvaluation.dimensions;
              const scoreTotal = getDimensionScoreTotal(scoreDetails);
              const gateRows = getScreeningGateRows(normalizedEvaluation);
              const hasGateResults = Object.keys(normalizedEvaluation.gateResults).length > 0;
              const matchCount = scoreDetails?.filter(d => d.score >= 3).length || 0;
              const totalDims = scoreDetails?.length || 0;
              const hardResult = parseHardRequirementResult(record.hard_requirement_result);
              const evalCardState = getEvaluationCardState(record);

              return (
                <Card
                  key={record.id}
                  size="small"
                  style={{ border: '1px solid #f0f0f0', borderRadius: 8 }}
                  styles={{ body: { padding: '12px 16px' } }}
                  hoverable
                  onClick={() => navigate(`/resumes/${record.id}`)}
                >
                  {/* 顶部：身份、状态和操作分区，窄屏时自然换行 */}
                  <div className="resume-card__header">
                    <div className="resume-card__identity">
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
                      <span className="resume-card__name">{record.candidate_name || '未知'}</span>
                      <Tooltip title={[genderText, ageText, record.education, record.major].filter(Boolean).join(' · ') || '暂无信息'}>
                        <span className="resume-card__summary">
                          {[genderText, ageText, record.education, record.major].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </Tooltip>
                    </div>
                    <div className="resume-card__status">
                      {record.position_applied && (
                        <Tag style={{ margin: 0 }}>{record.standard_position || record.position_applied}</Tag>
                      )}
                      {record.screening_label ? (
                        <Tag color={record.screening_label === '通过' ? 'green' : 'red'} style={{ margin: 0 }}>
                          AI{record.screening_label}
                        </Tag>
                      ) : (
                        statusTag(record.status)
                      )}
                      {hasGateResults && gateRows.map((gate) => (
                        <Tag key={gate.key} color={gate.passed ? 'green' : 'red'} style={{ margin: 0 }}>
                          {gate.passed ? `${gate.label}已通过` : gate.reason}
                        </Tag>
                      ))}
                      {hardResult?.passed === false && (
                        <Tag color="red" style={{ margin: 0 }}>硬条件未满足{hardResult.unmet_items?.length ? `：${hardResult.unmet_items.join('、')}` : ''}</Tag>
                      )}
                      {hardResult?.passed !== false && (hardResult?.unknown_items || []).length > 0 && (
                        <Tag color="orange" style={{ margin: 0 }}>硬条件待复核{hardResult.unknown_items?.length ? `：${hardResult.unknown_items.join('、')}` : ''}</Tag>
                      )}
                      {record.create_time && (
                        <span className="resume-card__created-at">
                          入库: {new Date(Number(record.create_time)).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <div className="resume-card__actions" onClick={e => e.stopPropagation()}>
                      {renderActionButtons(record)}
                    </div>
                  </div>

                  {/* 评估任务状态提示 */}
                  {evalCardState.status !== 'idle' && (
                    <div className="resume-card__evaluation">
                      <span className="resume-card__long-label" style={{ color: evalCardState.status === 'failed' ? '#ff4d4f' : evalCardState.status === 'cancelled' ? '#8c8c8c' : '#1677ff', fontSize: 12 }}>
                        {evalCardState.label}{evalCardState.error ? `：${evalCardState.error}` : ''}
                      </span>
                    </div>
                  )}

                  {/* AI 评估维度 — 横向标签式 */}
                  {evalCardState.status === 'idle' && scoreDetails && scoreDetails.length > 0 && (
                    <div className="resume-card__evaluation">
                      <div className="resume-card__evaluation-summary">
                        <span style={{ fontSize: 12, color: '#1677ff', fontWeight: 600, background: '#f0f5ff', padding: '1px 8px', borderRadius: 4 }}>
                          AI 评估 {matchCount}/{totalDims} 符合
                        </span>
                        <span style={{ fontSize: 12, color: '#8c8c8c' }}>加权分：{formatWeightedScore(normalizedEvaluation.overallScore)}</span>
                        <span style={{ fontSize: 12, color: '#8c8c8c' }}>维度合计：{scoreTotal.total}/{scoreTotal.maximum}</span>
                      </div>
                      <div className="resume-card__dimensions">
                        {scoreDetails.map((d: any, i: number) => {
                          const isMatch = d.score >= 3;
                          const color = d.score >= 4 ? '#52c41a' : d.score >= 3 ? '#1677ff' : d.score >= 2 ? '#fa8c16' : '#ff4d4f';
                          return (
                            <Tooltip key={i} title={d.reason || d.name}>
                              <Tag
                                color={isMatch ? (d.score >= 4 ? 'green' : 'blue') : (d.score >= 2 ? 'orange' : 'red')}
                                className="resume-card__dimension"
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
                  {evalCardState.status === 'idle' && scoreDetails.length === 0 && normalizedEvaluation.overallScore != null && (
                    <div className="resume-card__evaluation">
                      <span className="resume-card__long-label" style={{ color: '#1677ff', fontSize: 12 }}>AI 加权分 {formatWeightedScore(normalizedEvaluation.overallScore)}</span>
                    </div>
                  )}
                  {evalCardState.status === 'idle' && normalizedEvaluation.screeningReason && (
                    <div className="resume-card__evaluation">
                      <span className="resume-card__long-label" style={{ color: hasGateResults && normalizedEvaluation.overallScore == null ? '#cf1322' : '#8c8c8c', fontSize: 12 }}>
                        初筛结论：{normalizedEvaluation.screeningReason}
                      </span>
                    </div>
                  )}
                  {evalCardState.status === 'idle' && scoreDetails.length === 0 && normalizedEvaluation.overallScore == null && (
                    <div className="resume-card__evaluation">
                      <span style={{ color: '#bfbfbf', fontSize: 12 }}>暂无 AI 评估</span>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          <SimplePagination
            current={cardPage}
            pageSize={cardPageSize}
            total={listStats.total}
            onChange={handleCardPageChange}
            pageSizeOptions={RESUME_PAGE_SIZE_OPTIONS}
            onPageSizeChange={handleCardPageSizeChange}
            showQuickJumper
            showLastPage
          />
        </>
      )}

      {/* Upload Modal */}
      <ResponsiveModal
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
      </ResponsiveModal>

      {/* Interview Modal */}
      <ResponsiveModal
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
            <Col xs={24} sm={12} md={8}>
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
            <Col xs={24} sm={12} md={8}>
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
            <Col xs={24} sm={12} md={8}>
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
      </ResponsiveModal>

      {/* 邮件预览模态框 */}
      <ResponsiveModal
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
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(watchedEmailContent || '') }}
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
      </ResponsiveModal>

      {/* 简历预览 Modal - 展示原始 PDF */}
      <ResponsiveModal
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
      </ResponsiveModal>

      {/* 评估维度配置弹窗 */}
      <ResponsiveModal
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
      </ResponsiveModal>

      {/* BOSS 直聘 Excel 批量导入 */}
      <ResponsiveModal
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
            <TableViewport className="resume-import-table resume-import-table--preview">
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
            </TableViewport>
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
            <TableViewport className="resume-import-table resume-import-table--result">
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
            </TableViewport>
            <Space>
              <Button onClick={() => { setBossImportOpen(false); setBossPreview([]); setBossImportResult(null); fetchResumes(); }}>关闭</Button>
            </Space>
          </div>
        )}
      </ResponsiveModal>
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
