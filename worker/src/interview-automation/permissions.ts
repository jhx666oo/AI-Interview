export function canEvaluateInterview(user: any, interview: any): boolean {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin' || role === 'hr') return true;
  const identities = [user?.full_name, user?.name, user?.email].map((value) => String(value || '').trim()).filter(Boolean);
  const assigned = [interview?.interviewer, interview?.primary_interviewer, interview?.secondary_interviewer]
    .map((value) => String(value || '').trim()).filter(Boolean);
  return identities.some((identity) => assigned.includes(identity));
}

export function canManageInterview(user: any): boolean {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'hr';
}
