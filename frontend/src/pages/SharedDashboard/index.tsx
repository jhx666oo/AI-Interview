import { useEffect, useState } from 'react';
import { Alert, Spin, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { RecruitingBoardView } from '../Dashboard/components/RecruitingBoardView';
import { MiaodaDashboardView } from '../Dashboard/components/MiaodaDashboardView';
import type { RecruitingBoard } from '../Dashboard/types';
import { isDashboardV3Board, type DashboardV3Board } from '../Dashboard/v3-types';
import request from '../../utils/request';

const { Title, Text } = Typography;

function FullPageSpinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <Spin size="large" description="加载招聘看板..." />
    </div>
  );
}

function InvalidShareLink() {
  return (
    <div style={{ maxWidth: 560, margin: '16vh auto', padding: 24 }}>
      <Alert
        type="warning"
        showIcon
        message="分享链接不可用"
        description="该链接已过期、被撤销或不存在。"
      />
    </div>
  );
}

const SharedDashboard = () => {
  const { token } = useParams();
  const [result, setResult] = useState<{
    token: string;
    board: RecruitingBoard | DashboardV3Board | null;
    invalid: boolean;
  } | null>(null);

  useEffect(() => {
    if (!token) return;

    let active = true;
    request.get(`/shared/dashboard/${token}`)
      .then((data: RecruitingBoard | DashboardV3Board) => {
        if (active) setResult({ token, board: data, invalid: false });
      })
      .catch(() => {
        if (active) setResult({ token, board: null, invalid: true });
      });

    return () => {
      active = false;
    };
  }, [token]);

  if (!token) return <InvalidShareLink />;
  if (!result || result.token !== token) return <FullPageSpinner />;
  if (result.invalid || !result.board) return <InvalidShareLink />;
  const { board } = result;
  const refreshSharedBoard = async () => {
    if (!token) return;
    const data = await request.get(`/shared/dashboard/${token}`) as RecruitingBoard | DashboardV3Board;
    setResult({ token, board: data, invalid: false });
  };

  return (
    <main style={{ maxWidth: 1600, margin: '0 auto', padding: '32px 24px 48px' }}>
      <header style={{ marginBottom: 28 }}>
        <Title level={3} style={{ marginBottom: 4 }}>招聘运营看板</Title>
        <Text type="secondary">数据截止：{board.snapshot_date || '最新实时数据'} · 仅含聚合数据</Text>
      </header>
      {isDashboardV3Board(board)
        ? <MiaodaDashboardView board={board} onRefresh={refreshSharedBoard} />
        : <RecruitingBoardView board={board} />}
    </main>
  );
};

export default SharedDashboard;
