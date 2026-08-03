import React, { useEffect, useState } from 'react';
import { Form, Button, Card, Upload, Select, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import request from '../../utils/request';

const ResumeUpload: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [fileList, setFileList] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [posLoading, setPosLoading] = useState(false);

  useEffect(() => {
    fetchPositions();
  }, []);

  const fetchPositions = async () => {
    setPosLoading(true);
    try {
      const res = await request.get('/positions');
      const list = Array.isArray(res) ? res : (res?.positions || res?.data || []);
      setPositions(list);
      if (list.length === 0) message.warning('暂无岗位数据，请先在岗位管理中添加岗位');
    } catch (error) {
      message.error('获取岗位列表失败');
      setPositions([]);
    } finally {
      setPosLoading(false);
    }
  };

  const onFinish = async (values: any) => {
    if (fileList.length === 0) {
      message.error('请上传简历文件');
      return;
    }

    const formData = new FormData();
    if (values.position_id) formData.append('position_id', values.position_id);
    formData.append('file', fileList[0]);

    setLoading(true);
    try {
      await request.post('/resumes', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      message.success('上传成功');
      navigate('/resumes');
    } catch (error) {
      message.error('上传失败');
    } finally {
      setLoading(false);
    }
  };

  const uploadProps = {
    onRemove: (file) => {
      setFileList([]);
    },
    beforeUpload: (file) => {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        message.error('只允许上传 PDF 格式的文件');
        return Upload.LIST_IGNORE;
      }
      setFileList([file]);
      return false;
    },
    fileList,
    accept: '.pdf',
  };

  return (
    <Card title="上传简历">
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
      >
        <Form.Item
          name="position_id"
          label="应聘岗位"
        >
          <Select placeholder="请选择岗位" showSearch loading={posLoading}
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }>
            {positions.map(position => (
              <Select.Option key={position.id} value={position.id}>
                {position.title}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="file"
          label="简历文件"
          rules={[{ required: true, message: '请上传简历' }]}
          extra="仅支持 PDF 格式"
        >
          <Upload {...uploadProps}>
            <Button icon={<UploadOutlined />}>选择文件</Button>
          </Upload>
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            上传
          </Button>
          <Button style={{ marginLeft: 8 }} onClick={() => navigate('/resumes')}>
            取消
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
};

export default ResumeUpload;
