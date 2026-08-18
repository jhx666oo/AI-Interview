import { useEffect, useMemo, useState } from 'react';
import { Button, Empty, List, Space, Spin, Tag, Typography, message } from 'antd';
import { DownloadOutlined, FileExcelOutlined, ReloadOutlined } from '@ant-design/icons';
import { ResponsiveModal } from '../../../components/Responsive';
import { downloadDashboardExcelArchive, listDashboardExcelArchives } from '../api';
import { buildExcelArchiveGroups, formatExcelArchiveBytes, type DashboardExcelArchive } from '../excelArchive';
import styles from '../dashboard.module.css';

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function archiveTypeLabel(fileType?: string) {
  if (fileType === 'zhipei') return '职培';
  if (fileType === 'yanglao') return '养老';
  return '看板汇总';
}

function archiveTypeColor(fileType?: string) {
  if (fileType === 'zhipei') return 'blue';
  if (fileType === 'yanglao') return 'red';
  return 'default';
}

export function ExcelArchiveModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate?: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const [archives, setArchives] = useState<DashboardExcelArchive[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const groups = useMemo(() => buildExcelArchiveGroups(archives), [archives]);

  const load = async () => {
    setLoading(true);
    try {
      setArchives(await listDashboardExcelArchives());
    } catch {
      message.error('历史 Excel 列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) void load(); }, [open]);

  const downloadOne = async (archive: DashboardExcelArchive) => {
    setDownloading(archive.id);
    try {
      downloadBlob(await downloadDashboardExcelArchive(archive.id), archive.file_name);
    } catch {
      message.error(`下载失败：${archive.file_name}`);
    } finally {
      setDownloading(null);
    }
  };

  const downloadBatch = async (files: DashboardExcelArchive[]) => {
    for (const file of files) await downloadOne(file);
  };

  const createArchive = async () => {
    if (!onCreate) return;
    await onCreate();
    await load();
  };

  const totalSize = archives.reduce((sum, archive) => sum + archive.file_size, 0);
  return (
    <ResponsiveModal title="历史 Excel 存档" open={open} onCancel={onClose} footer={null} destroyOnHidden width={760}>
      <div className={styles.excelArchiveDescription}>
        <Typography.Text type="secondary">按日期保存妙搭同口径的真实 Excel 文件（职培、养老各一份），可单独下载或批量下载。</Typography.Text>
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
          <Button size="small" icon={<DownloadOutlined />} disabled={!archives.length || Boolean(downloading)} onClick={() => void downloadBatch(archives)}>一键下载全部</Button>
          {onCreate && <Button size="small" type="primary" icon={<FileExcelOutlined />} onClick={() => void createArchive()}>保存今日 Excel</Button>}
        </Space>
      </div>
      <Typography.Paragraph type="secondary" className={styles.excelArchiveSummary}>
        共 {groups.length} 天，{archives.length} 个 Excel，累计 {formatExcelArchiveBytes(totalSize)}
      </Typography.Paragraph>
      {loading && <div className={styles.excelArchiveLoading}><Spin /></div>}
      {!loading && groups.length === 0 && <Empty description="暂无历史 Excel 文件" />}
      {!loading && groups.length > 0 && (
        <div className={styles.excelArchiveGroups}>
          {groups.map((group) => (
            <section className={styles.excelArchiveGroup} key={group.date}>
              <div className={styles.excelArchiveGroupHeader}>
                <div><Tag color="red">{group.date}</Tag><Typography.Text type="secondary">{group.files.length} 个文件 · {formatExcelArchiveBytes(group.totalSize)}</Typography.Text></div>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => void downloadBatch(group.files)}>下载当天</Button>
              </div>
              <List
                size="small"
                dataSource={group.files}
                renderItem={(archive) => (
                  <List.Item actions={[<Button key="download" type="link" icon={<DownloadOutlined />} loading={downloading === archive.id} onClick={() => void downloadOne(archive)}>下载</Button>] }>
                    <Space size="small">
                      <Tag color={archiveTypeColor(archive.file_type)}>{archiveTypeLabel(archive.file_type)}</Tag>
                      <span>{archive.file_name} · {formatExcelArchiveBytes(archive.file_size)}</span>
                    </Space>
                  </List.Item>
                )}
              />
            </section>
          ))}
        </div>
      )}
    </ResponsiveModal>
  );
}
