import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, renderTemplate } from '../src/templates/config';
import { buildFeishuCard } from '../src/business-screening/routes';
import { buildInterviewerReminderCard } from '../src/interview-start/reminders';

/**
 * 对外卡片模板化测试：系统设置「消息模板」新增的飞书卡片模板，
 * 覆盖业务筛选推送卡片 / 面试安排通知 / 统一落款。
 * 默认值应包含全部新增 key，且 buildFeishuCard 能用自定义模板渲染占位符。
 */

const CARD_KEYS = [
  'business_card_title',
  'business_card_body',
  'business_card_button',
  'interview_notice_title',
  'interview_notice_body',
  'interview_notice_button',
  'card_footer',
] as const;

describe('对外卡片模板默认值', () => {
  it('DEFAULT_TEMPLATES 包含全部卡片模板 key 且非空', () => {
    for (const key of CARD_KEYS) {
      expect(typeof DEFAULT_TEMPLATES[key], key).toBe('string');
      expect((DEFAULT_TEMPLATES[key] as string).trim().length, key).toBeGreaterThan(0);
    }
  });

  it('业务卡片默认模板可渲染占位符', () => {
    const vars = { position: '前端工程师', count: '5' };
    expect(renderTemplate(DEFAULT_TEMPLATES.business_card_title, vars)).toBe('简历筛选待处理：前端工程师');
    expect(renderTemplate(DEFAULT_TEMPLATES.business_card_body, vars)).toContain('5 份候选人简历待处理');
    expect(renderTemplate(DEFAULT_TEMPLATES.business_card_button, vars)).toBe('进入待筛选简历');
  });
});

describe('buildFeishuCard 模板渲染', () => {
  it('未传 templates 时使用内置默认文案', () => {
    const card = buildFeishuCard({ positionTitle: '后端工程师', itemCount: 2, url: 'https://x/link' }) as any;
    expect(card.header.title.content).toBe('简历筛选待处理：后端工程师');
    expect(card.elements[0].text.content).toContain('2 份候选人简历待处理');
    expect(card.elements[1].actions[0].text.content).toBe('进入待筛选简历');
    expect(card.elements[1].actions[0].url).toBe('https://x/link');
    expect(card.elements[2].elements[0].content).toBe('发送自 招聘管理智能小助手');
  });

  it('自定义模板覆盖标题/正文/按钮/落款', () => {
    const card = buildFeishuCard({
      positionTitle: '测试岗位',
      itemCount: 8,
      url: 'https://x/link',
      templates: {
        ...DEFAULT_TEMPLATES,
        business_card_title: '【测试】{{position}} 待处理',
        business_card_body: '共有 {{count}} 份简历等待 {{position}} 负责人处理',
        business_card_button: '去处理',
        card_footer: '测试落款',
      },
    }) as any;
    expect(card.header.title.content).toBe('【测试】测试岗位 待处理');
    expect(card.elements[0].text.content).toBe('共有 8 份简历等待 测试岗位 负责人处理');
    expect(card.elements[1].actions[0].text.content).toBe('去处理');
    expect(card.elements[2].elements[0].content).toBe('测试落款');
  });

  it('未知占位符渲染为空串，不残留 {{}}', () => {
    const card = buildFeishuCard({
      positionTitle: '岗位A',
      itemCount: 1,
      url: 'https://x/link',
      templates: { ...DEFAULT_TEMPLATES, business_card_title: '{{unknown}} {{position}}' },
    }) as any;
    expect(card.header.title.content).toBe(' 岗位A');
    expect(card.header.title.content).not.toContain('{{');
  });
});

describe('buildInterviewerReminderCard 面试官提醒卡片', () => {
  it('线上面试：结构化数据行 + 正文提示语 + 会议按钮 + 档案按钮 + 落款', () => {
    const card = buildInterviewerReminderCard({
      candidateName: '张三',
      position: '前端工程师',
      interviewTime: '2026-08-25 14:00 ~ 15:00',
      bodyText: '请提前 10 分钟进入会议，并查看候选人简历',
      meetingLink: 'https://vc.feishu.cn/j/abc',
      interviewTypeLabel: '线上面试',
      cardLinkUrl: 'https://ai-interview-88r.pages.dev/business-screening/demo',
      footer: '发送自 招聘管理智能小助手',
    }) as any;
    expect(card.config.wide_screen_mode).toBe(true);
    expect(card.header.title.content).toBe('🔔 面试提醒');
    expect(card.header.template).toBe('blue');
    const text = JSON.stringify(card);
    expect(text).toContain('**候选人：** 张三');
    expect(text).toContain('**岗位：** 前端工程师');
    expect(text).toContain('**面试时间：** 2026-08-25 14:00 ~ 15:00');
    expect(text).toContain('请提前 10 分钟进入会议');
    expect(text).toContain('进入视频会议');
    expect(text).toContain('https://vc.feishu.cn/j/abc');
    expect(text).toContain('查看候选人档案');
    expect(text).toContain('面试卡片链接：https://ai-interview-88r.pages.dev/business-screening/demo');
    expect(text).toContain('发送自 招聘管理智能小助手');
  });

  it('线下面试：无会议按钮，显示地点，不带会议链接', () => {
    const card = buildInterviewerReminderCard({
      candidateName: '李四',
      position: '后端工程师',
      interviewTime: '2026-08-26 10:00 ~ 11:00',
      bodyText: '请准时到场',
      interviewTypeLabel: '线下面试',
      location: '北京总部 C5 栋 3 层 会议室1',
      cardLinkUrl: 'https://ai-interview-88r.pages.dev/business-screening/demo2',
    }) as any;
    const text = JSON.stringify(card);
    expect(text).toContain('**面试地点：** 北京总部 C5 栋 3 层 会议室1');
    expect(text).toContain('查看候选人档案');
    expect(text).not.toContain('进入视频会议');
    expect(text).not.toContain('会议链接');
  });
});
