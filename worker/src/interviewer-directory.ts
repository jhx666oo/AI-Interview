export type InterviewerDirectoryUser = {
  id?: unknown;
  full_name?: unknown;
  name?: unknown;
  email?: unknown;
};

export type InterviewerMapping = {
  id?: unknown;
  name?: unknown;
};

export type InterviewerDirectoryEntry = {
  id: string;
  full_name: string;
  name: string;
  email: string;
};

const clean = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

/**
 * Build the selectable interviewer directory from system users and Feishu
 * mappings. Mappings are needed because many interviewers are not system
 * accounts, while users remain the preferred source for email metadata.
 */
export function mergeInterviewerDirectoryEntries(
  users: InterviewerDirectoryUser[] = [],
  mappings: InterviewerMapping[] = [],
): InterviewerDirectoryEntry[] {
  const result: InterviewerDirectoryEntry[] = [];
  const seen = new Set<string>();

  for (const entry of users) {
    const name = clean(entry?.full_name) || clean(entry?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({
      id: clean(entry?.id) || name,
      full_name: name,
      name,
      email: clean(entry?.email),
    });
  }

  for (const entry of mappings) {
    const name = clean(entry?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({
      id: clean(entry?.id) || name,
      full_name: name,
      name,
      email: '',
    });
  }

  return result;
}
