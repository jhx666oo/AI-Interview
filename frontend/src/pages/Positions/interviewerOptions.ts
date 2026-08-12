export type InterviewerDirectoryEntry = {
  id?: string;
  full_name?: string | null;
  name?: string | null;
  email?: string | null;
};

export type InterviewerOption = {
  value: string;
  label: string;
  historical: boolean;
};

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function buildInterviewerOptions(
  entries: InterviewerDirectoryEntry[],
  currentValues: Array<string | null | undefined> = [],
  defaultValue?: string | null,
): InterviewerOption[] {
  const directory = new Map<string, InterviewerDirectoryEntry>();
  for (const entry of entries) {
    const name = clean(entry.full_name) || clean(entry.name);
    if (!name || directory.has(name)) continue;
    directory.set(name, entry);
  }

  const orderedValues = [
    clean(defaultValue),
    ...currentValues.map(clean),
    ...Array.from(directory.keys()),
  ].filter(Boolean);

  const seen = new Set<string>();
  const options: InterviewerOption[] = [];
  for (const value of orderedValues) {
    if (seen.has(value)) continue;
    seen.add(value);
    const directoryEntry = directory.get(value);
    const email = clean(directoryEntry?.email);
    options.push({
      value,
      label: directoryEntry ? `${value}${email ? ` (${email})` : ''}` : value,
      historical: !directoryEntry,
    });
  }

  return options;
}
