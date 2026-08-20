type PositionOption = {
  title?: string | null;
  primary_interviewer?: string | null;
  secondary_interviewer?: string | null;
};

type ScheduleRecord = {
  candidate_name: string;
  position_applied?: string | null;
  standard_position?: string | null;
  city?: string | null;
  feishu_record_id?: string | null;
  resume_id?: string | null;
};

type ScheduleValues = {
  interview_location?: string | null;
  interviewer_name?: string | null;
  secondary_interviewer?: string | null;
};

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const normalizePosition = (value: unknown) => clean(value).toLocaleLowerCase('zh-CN').replace(/[\s\u3000]+/g, '');

function positionMatches(left: unknown, right: unknown): boolean {
  const leftKey = normalizePosition(left);
  const rightKey = normalizePosition(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const legacyIot = (value: string) => value === 'iot' || value.startsWith('iot产品经理');
  return (legacyIot(leftKey) && rightKey.includes('软件产品经理'))
    || (legacyIot(rightKey) && leftKey.includes('软件产品经理'));
}

export function resolveScheduleInterviewerDefaults(
  record: Pick<ScheduleRecord, 'standard_position' | 'position_applied'>,
  positions: PositionOption[],
) {
  const preferredTitles = [clean(record.standard_position), clean(record.position_applied)].filter(Boolean);
  const matched = positions.find((position) => preferredTitles.some((title) => positionMatches(title, position.title)));
  return {
    interviewerName: clean(matched?.primary_interviewer),
    secondaryInterviewer: clean(matched?.secondary_interviewer),
    matchedPositionTitle: clean(matched?.title),
  };
}

export function buildCreateFromTalentPayload(input: {
  record: ScheduleRecord;
  values: ScheduleValues;
  defaults?: {
    interviewerName?: string;
    secondaryInterviewer?: string;
    matchedPositionTitle?: string;
  } | null;
  interviewTime: string;
}) {
  const interviewerName = clean(input.values.interviewer_name) || clean(input.defaults?.interviewerName);
  const secondaryInterviewer = clean(input.values.secondary_interviewer) || clean(input.defaults?.secondaryInterviewer);

  return {
    candidate_name: input.record.candidate_name,
    position_applied: clean(input.record.position_applied),
    standard_position: clean(input.record.standard_position) || clean(input.defaults?.matchedPositionTitle),
    city: clean(input.record.city),
    feishu_record_id: clean(input.record.feishu_record_id) || clean(input.record.resume_id),
    interview_time: input.interviewTime,
    interview_location: clean(input.values.interview_location),
    interviewer_name: interviewerName,
    secondary_interviewer: secondaryInterviewer,
  };
}

type InterviewerPrefillRecord = {
  primary_interviewer?: string | null;
  secondary_interviewer?: string | null;
  interviewer?: string | null;
};

/**
 * 计算「安排面试」弹窗的面试官初始值。
 * 优先级：记录已安排的面试官（primary/secondary）> 岗位配置的默认面试官。
 * 修复：此前弹窗直接用岗位匹配结果覆盖了记录已有面试官，导致弹窗与列表展示不一致
 * （如周佳记录一面=金皓翔/二面=黄维，弹窗却显示岗位配置的魏秋柠/练童）。
 */
export function resolveScheduleInterviewerPrefill(
  record: InterviewerPrefillRecord,
  defaults?: { interviewerName?: string; secondaryInterviewer?: string } | null,
): { interviewer_name?: string; secondary_interviewer?: string } {
  return {
    interviewer_name: clean(record.primary_interviewer) || clean(record.interviewer) || clean(defaults?.interviewerName) || undefined,
    secondary_interviewer: clean(record.secondary_interviewer) || clean(defaults?.secondaryInterviewer) || undefined,
  };
}
