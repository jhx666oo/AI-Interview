import React, { useState } from 'react';
import { Tag, Tooltip, Select, Input, Button, Space, Empty, Divider } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';

export type CapabilityDimensionValue = {
  name: string;
  description?: string;
  definition?: string;
  behavior?: string;
  weight?: number | null;
};

const WEIGHTED_SCORING_DIMENSIONS = ['核心画像', '核心职责', '任职要求', '企业背景', '加分项'] as const;
const WEIGHTED_GATE_DIMENSIONS = ['关键词匹配', '避坑雷区'] as const;
const DEFAULT_WEIGHTS: Record<string, number> = {
  核心画像: 25,
  核心职责: 22,
  任职要求: 22,
  企业背景: 13,
  加分项: 10,
};

const isWeightedScoringDimension = (name: string) =>
  (WEIGHTED_SCORING_DIMENSIONS as readonly string[]).includes(name);
const isScreeningGateDimension = (name: string) =>
  (WEIGHTED_GATE_DIMENSIONS as readonly string[]).includes(name);

/** 规范化维度值：兼容字符串 / 旧格式对象 */
const normalize = (value: any[] | undefined): CapabilityDimensionValue[] =>
  (Array.isArray(value) ? value : []).map((d) => {
    if (typeof d === 'string') {
      return { name: d, description: '', weight: isWeightedScoringDimension(d) ? DEFAULT_WEIGHTS[d] : null };
    }
    const name = String(d?.name || '');
    if (!name) return null as any;
    const description = d?.description || d?.definition || '';
    const weight = Number(d?.weight);
    return {
      name,
      description,
      weight: isWeightedScoringDimension(name)
        ? (Number.isFinite(weight) ? weight : DEFAULT_WEIGHTS[name])
        : isScreeningGateDimension(name) ? 0 : (Number.isFinite(weight) ? weight : null),
    };
  }).filter((d) => d && d.name);

interface CapabilityDimensionsFieldProps {
  value?: any[];
  onChange?: (value: CapabilityDimensionValue[]) => void;
  allDimensionNames: string[];
}

const CapabilityDimensionsField: React.FC<CapabilityDimensionsFieldProps> = ({
  value,
  onChange,
  allDimensionNames,
}) => {
  const [customName, setCustomName] = useState('');

  const dims = normalize(value);
  const checkedNames = new Set(dims.map((d) => d.name));
  const availableNames = allDimensionNames.filter((n) => !checkedNames.has(n));

  const remove = (name: string) => {
    onChange?.(dims.filter((d) => d.name !== name));
  };

  const addFromDirectory = (names: string[]) => {
    if (!names.length) return;
    const existing = new Set(dims.map((d) => d.name));
    const fresh = names
      .filter((n) => !existing.has(n))
      .map((n) => ({ name: n, description: '', weight: isWeightedScoringDimension(n) ? DEFAULT_WEIGHTS[n] : null }));
    if (fresh.length) onChange?.([...dims, ...fresh]);
  };

  const addCustom = () => {
    const name = customName.trim();
    if (!name) return;
    if (checkedNames.has(name)) return;
    onChange?.([...dims, { name, description: '', weight: isWeightedScoringDimension(name) ? DEFAULT_WEIGHTS[name] : null }]);
    setCustomName('');
  };

  return (
    <div style={{ border: '1px solid #d9d9d9', borderRadius: 8, padding: '12px 16px', background: '#fafafa' }}>
      {dims.length > 0 ? (
        <Space wrap size={[6, 6]} style={{ marginBottom: 12 }}>
          {dims.map((d) => (
            <Tooltip
              key={d.name}
              title={
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  <div><strong>{d.name}</strong></div>
                  {d.description && <div style={{ marginTop: 4 }}>📌 {d.description}</div>}
                  <div style={{ marginTop: 4 }}>
                    {isWeightedScoringDimension(d.name)
                      ? `权重：${d.weight ?? DEFAULT_WEIGHTS[d.name]}%`
                      : isScreeningGateDimension(d.name) ? '硬门槛（一票否决）' : d.weight != null ? `权重：${d.weight}%` : '无权重'}
                  </div>
                </div>
              }
            >
              <Tag
                color={isScreeningGateDimension(d.name) ? 'orange' : isWeightedScoringDimension(d.name) ? 'blue' : 'green'}
                closable
                onClose={(e) => { e.preventDefault(); remove(d.name); }}
                style={{ cursor: 'pointer', marginInlineEnd: 0 }}
              >
                {d.name}
                {isWeightedScoringDimension(d.name) && ` · ${d.weight ?? DEFAULT_WEIGHTS[d.name]}%`}
                {isScreeningGateDimension(d.name) && ' · 硬门槛'}
              </Tag>
            </Tooltip>
          ))}
        </Space>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ fontSize: 12 }}>暂未配置评分维度，可点击上方「AI 一键生成」或手动添加</span>}
          style={{ margin: '8px 0 12px' }}
        />
      )}

      {availableNames.length > 0 && (
        <>
          <Select
            mode="multiple"
            size="small"
            style={{ width: '100%', marginBottom: 8 }}
            placeholder="从已有能力维度中选择添加"
            options={availableNames.map((n) => ({ label: n, value: n }))}
            onChange={addFromDirectory}
            value={[]}
            maxTagCount={3}
          />
          <Divider style={{ margin: '8px 0' }} />
        </>
      )}

      <Space.Compact style={{ width: '100%' }}>
        <Input
          size="small"
          placeholder="输入新维度名称，回车添加"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          onPressEnter={addCustom}
          style={{ flex: 1 }}
        />
        <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={addCustom}>
          添加
        </Button>
      </Space.Compact>
      <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 6 }}>
        <DeleteOutlined style={{ marginRight: 4 }} />点击维度标签的关闭图标可删除该维度
      </div>
    </div>
  );
};

export default CapabilityDimensionsField;
