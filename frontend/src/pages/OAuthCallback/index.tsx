import { useEffect, useState } from 'react';
import { Card, Result, Spin, Button, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LinkOutlined } from '@ant-design/icons';
import request from '../../utils/request';

const { Text } = Typography;

const OAuthCallback: React.FC = () => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [name, setName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (!code) {
      setStatus('error');
      setErrorMsg('未收到授权码，请重新授权');
      return;
    }

    request.post('/auth/feishu/callback', { code })
      .then((res: any) => {
        if (res.ok) {
          setName(res.name || '');
          setStatus('success');
        } else {
          setStatus('error');
          setErrorMsg(res.detail || '授权失败');
        }
      })
      .catch((err: any) => {
        setStatus('error');
        setErrorMsg(err.response?.data?.detail || err.message || '授权请求失败');
      });
  }, []);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <Card style={{ width: 420, textAlign: 'center', borderRadius: 12 }}>
        {status === 'loading' && (
          <Result
            icon={<Spin size="large" />}
            title="飞书授权中..."
            subTitle="正在完成飞书登录授权，请稍候"
          />
        )}

        {status === 'success' && (
          <Result
            icon={<CheckCircleOutlined style={{ color: '#10B981' }} />}
            title="飞书授权成功！"
            subTitle={
              <div>
                <Text>你已以 <Text strong>{name}</Text> 的身份授权飞书</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 13 }}>
                  现在可以以你的身份发送面试通知消息了
                </Text>
              </div>
            }
            extra={
              <Button type="primary" onClick={() => window.close()}>
                关闭页面
              </Button>
            }
          />
        )}

        {status === 'error' && (
          <Result
            icon={<CloseCircleOutlined style={{ color: '#EF4444' }} />}
            title="授权失败"
            subTitle={errorMsg}
            extra={
              <Button
                type="primary"
                icon={<LinkOutlined />}
                onClick={() => {
                  request.get('/auth/feishu/authorize-url').then((res: any) => {
                    if (res.url) window.location.href = res.url;
                  }).catch(() => {
                    const appId = 'cli_aace77019aba9cdb';
                    const redirectUri = encodeURIComponent(window.location.origin + '/oauth/callback');
                    window.location.href = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${appId}&redirect_uri=${redirectUri}`;
                  });
                }}
              >
                重新授权
              </Button>
            }
          />
        )}
      </Card>
    </div>
  );
};

export default OAuthCallback;
