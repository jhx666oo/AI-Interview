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

export function resolveScheduleInterviewerDefaults(
  record: Pick<ScheduleRecord, 'standard_position' | 'position_applied'>,
  positions: PositionOption[],
) {
  const preferredTitles = [clean(record.standard_position), clean(record.position_applied)].filter(Boolean);
  const matched = positions.find((position) => preferredTitles.includes(clean(position.title)));
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
