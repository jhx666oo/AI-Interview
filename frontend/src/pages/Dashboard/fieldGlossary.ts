export type FieldGlossaryCategory = '核心指标' | '基础字段' | '数据范围' | '状态分类' | '效能指标';
export type FieldGlossaryFilter = '全部' | FieldGlossaryCategory;

export interface FieldGlossaryItem {
  name: string;
  alias?: string;
  definition: string;
  category: FieldGlossaryCategory;
}

/** Field definitions mirrored from the Miaoda dashboard glossary. */
export const FIELD_GLOSSARY: FieldGlossaryItem[] = [
  { name: '数据范围', category: '数据范围', definition: 'KPI / 漏斗 / 事业部面板 / HRBP 效能 / AI 诊断 / 招聘动态均仅统计优先级为 P0-紧急 / P1-正常的岗位；P2-储备岗不计入任何统计，仅在【P2储备岗】明细板块单独展示。全量岗位明细表展示所有岗位（含 P2）。' },
  { name: '招聘漏斗口径', category: '数据范围', definition: '全事业部汇总漏斗使用 7 级指标：简历推送 → 安排1面 → 1面通过 → 2面通过 → 终面通过 → 发放Offer → 已入职。均为岗位累计值（各岗位该字段相加），非人数去重口径。终面通过 = 3面通过有值取3面，否则用2面通过代替。' },
  { name: '事业部 mini 漏斗口径', category: '数据范围', definition: '各事业部独立漏斗使用 6 级指标：简历推送 → 安排1面 → 1面通过 → 2面通过 → 发放Offer → 已入职。均为该事业部内岗位的累计值。' },
  { name: 'HRBP 转化链路口径', category: '数据范围', definition: '每位 HRBP 的转化链路为 4 段转化率：1面÷简历 / 终面÷1面 / Offer÷终面 / 入职÷Offer。转化率着色规则：≥30% 绿色 / ≥15% 橙色 / >0 红色 / =0 灰色。' },
  { name: '数据来源', category: '数据范围', definition: '数据来自飞书多维表格：职培招聘管理表（职培事业部）+ 养老及商业事业部月度招聘报表（养老及商业/AI创新/雏渐肥事业部）。通过筛选条件（在招人数 > 0 且招聘状态 ≠ 已取消）模拟视图效果。' },
  { name: '岗位名称', alias: '在招职位', category: '基础字段', definition: '招聘岗位的正式名称。明细表中以「岗位名称-城市」格式展示，如“养老护理员-长沙”。' },
  { name: '城市', category: '基础字段', definition: '岗位所在城市，用于明细表展示和 HRBP 匹配。' },
  { name: '所属部门', alias: '所属事业部', category: '基础字段', definition: '岗位所属的事业部。养老表中字段名为“所属事业部”，职培表中为“所属部门”。归一为：养老及商业事业部、AI创新事业部、雏渐肥事业部、职培事业部。' },
  { name: '负责HRBP', alias: 'HRBP', category: '基础字段', definition: '负责该岗位招聘的 HRBP（人力资源业务伙伴）。飞书表中为人员选择器字段，返回 User ID 数组；当 ID 无法解析为姓名时，按岗位名+城市从预设映射表匹配。' },
  { name: '优先级', category: '基础字段', definition: '岗位招聘优先级。可选值：P0-紧急、P1-正常、P2-储备。P0/P1 计入 KPI 统计，P2 不计入任何统计，仅在明细表 P2 储备岗板块展示。' },
  { name: '招聘状态', alias: '状态', category: '基础字段', definition: '岗位当前招聘进展状态。可选值：初筛中、复试中、OFFER中、已完成、已取消。“已完成”和“已取消”归为已完结，其余为在途。明细表中以彩色胶囊 Tag 展示。' },
  { name: '备注', category: '基础字段', definition: 'HRBP 填写的岗位进展备注说明。也可用于标记优先级（如备注含“P2”则该岗位归为 P2 储备岗）。' },
  { name: '在招岗位数', alias: '在招岗位', category: '核心指标', definition: '当前正在招聘的岗位总数（已剔除 P2 储备岗）。= 已完结岗位数 + 在途岗位数。' },
  { name: '在招人数', category: '核心指标', definition: '所有在招岗位计划招聘的人数总和（累计口径）。即每个岗位的“在招人数”字段值相加，不考虑当前招聘进度。' },
  { name: '简历推送', alias: '简历', category: '核心指标', definition: 'HRBP 向用人部门推送的简历总数（岗位累计值）。即每个岗位的“简历推送”字段值相加，是招聘漏斗的入口指标。' },
  { name: '安排面试', alias: '安排1面 / 1面', category: '核心指标', definition: '已安排第一轮面试的候选人总量（岗位累计值）。即每个岗位的“安排1面”字段值相加，是招聘漏斗的第二个节点，也是面试通过率的分母。' },
  { name: '1面通过', category: '核心指标', definition: '通过第一轮面试的候选人数量（岗位累计值）。即每个岗位的“1面通过”字段值相加。' },
  { name: '2面通过', category: '核心指标', definition: '通过第二轮面试的候选人数量（岗位累计值）。即每个岗位的“2面通过”字段值相加。' },
  { name: '终面通过', category: '核心指标', definition: '通过终面（最后一轮面试）的候选人数量（岗位累计值）。终面通过 = 3面通过有值取3面，否则用2面通过代替。是面试通过率的分子和 Offer 转化率的分母。' },
  { name: '面试通过率', category: '核心指标', definition: '公式 = Σ终面通过 ÷ Σ安排1面 × 100%。分母是“安排1面”而非“1面通过”；终面通过 = 3面通过有值取3面，否则用2面通过代替。KPI 卡片副文案展示“终面X÷1面Y”。' },
  { name: '发放Offer', alias: 'Offer 数量 / Offer', category: '核心指标', definition: '已发出正式录用通知（Offer）的总数量（岗位累计值）。即每个岗位的“发放Offer数”字段值相加。KPI 卡片副文案展示“已入职 X”。' },
  { name: 'Offer 转化率', category: '核心指标', definition: '公式 = Σ发放Offer ÷ Σ终面通过 × 100%。终面通过 = 3面通过有值取3面，否则用2面通过代替。反映终面通过后拿到 Offer 的比例。' },
  { name: '入职人数', alias: '已入职 / 入职', category: '核心指标', definition: '候选人实际办理入职手续的人数（岗位累计值）。即每个岗位的“入职数”字段值相加，是招聘漏斗的最终产出。' },
  { name: '入职转化率', category: '核心指标', definition: '公式 = Σ入职数 ÷ Σ发放Offer × 100%。反映 Offer 接受率，是招聘漏斗的最终转化结果。' },
  { name: '平均招聘周期', alias: '完结周期 / 平均周期', category: '核心指标', definition: '仅统计“已完结”（状态含“完成”或“取消”）且已耗时天数 > 0 的岗位的平均已耗时天数。在途岗位不计入，仅在“在途参考”中单独展示。保留 1 位小数，单位为“天”。' },
  { name: '本周需完结数', alias: '本周需求完结', category: '核心指标', definition: '本周内需要完成招聘流程的目标人数。仅职培事业部有此字段，养老及商业事业部无此字段。用于追踪本周招聘交付压力。' },
  { name: '已完结岗位', category: '状态分类', definition: '招聘状态为“已完成”或“已取消”的岗位（已剔除 P2 储备岗）。这些岗位的招聘流程已结束，计入平均招聘周期统计。' },
  { name: '在途岗位', category: '状态分类', definition: '招聘状态为初筛中 / 复试中 / OFFER中 等非完结状态的岗位（已剔除 P2 储备岗）。不计入平均招聘周期，仅在“在途参考”中展示数量和平均已耗时天数。' },
  { name: '在途参考', category: '状态分类', definition: '展示当前仍在招聘流程中的岗位数量及其平均已耗时天数。仅作参考，不计入平均招聘周期，因为这些岗位尚未完结，最终周期未知。格式：“在途岗位 N 个 · 平均已耗时 X.X 天（不计入平均周期）”。' },
  { name: 'P0-紧急岗位', category: '状态分类', definition: '优先级为 P0-紧急的在招岗位数量（已剔除 P2 储备）。用于事业部面板和 HRBP 卡片中标识高优先级招聘需求。' },
  { name: 'P1-正常岗位', category: '状态分类', definition: '优先级为 P1-正常的在招岗位数量（已剔除 P2 储备）。为常规招聘需求。' },
  { name: 'P2-储备岗', category: '状态分类', definition: '优先级为 P2-储备的岗位（或备注含“P2”、状态含“储备”）。不计入 KPI / 漏斗 / 事业部 / HRBP 等任何统计，仅在【P2储备岗】明细板块单独展示。' },
  { name: '负责岗位', category: '效能指标', definition: '某位 HRBP 当前负责的在招岗位总数（P0+P1，已剔除 P2 储备岗）。' },
  { name: 'P0在招人数', category: '效能指标', definition: '某位 HRBP 或事业部负责的 P0-紧急岗位的在招人数总和。用于识别紧急招聘压力分布。' },
  { name: '已完结平均招聘周期', alias: 'HRBP 完结周期', category: '效能指标', definition: '某位 HRBP 或事业部下已完结且已耗时 > 0 的岗位的平均已耗时天数。用于 HRBP 效能卡核心指标展示。' },
  { name: '推送转化率', category: '效能指标', definition: '公式 = Σ安排1面 ÷ Σ简历推送 × 100%。衡量 HRBP 推送简历到获得面试机会的转化效率。仅在全局 KPI 卡片“安排面试”的副文案中展示。' },
  { name: '已耗时天数', alias: '耗时 / 周期', category: '效能指标', definition: '从岗位开放招聘到当前的累计天数。已完结岗位显示为“X天”，在途岗位显示为“已耗X天”。来源于飞书表的公式字段，返回格式为 {bizType, value}。' },
  { name: '本周招聘动态', category: '效能指标', definition: '展示本周新增的关键指标变化：新增简历 / 新增1面 / 新增Offer / 新增入职。通过与上次存档对比得出增量。' },
];

export const FIELD_GLOSSARY_CATEGORIES: FieldGlossaryFilter[] = ['全部', '核心指标', '基础字段', '数据范围', '状态分类', '效能指标'];

export function filterFieldGlossary(category: FieldGlossaryFilter): FieldGlossaryItem[] {
  return category === '全部' ? FIELD_GLOSSARY : FIELD_GLOSSARY.filter((item) => item.category === category);
}
