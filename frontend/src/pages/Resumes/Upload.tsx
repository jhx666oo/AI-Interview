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

  useEffect(() => {
    fetchPositions();
  }, []);

  const fetchPositions = async () => {
    try {
      const res = await request.get('/positions');
      setPositions(res);
    } catch (error) {
      message.error('获取岗位列表失败');
    }
  };

  const onFinish = async (values: any) => {
    if (fileList.length === 0) {
      message.error('请上传简历文件');
      return;
    }

    const formData = new FormData();
    formData.append('position_id', values.position_id);
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
          rules={[{ required: true, message: '请选择应聘岗位' }]}
        >
          <Select placeholder="请选择岗位">
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
