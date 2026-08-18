export const DEFAULT_BUSINESS_SCREENING_TITLE = '业务筛选';
export const MAX_BUSINESS_SCREENING_TITLE_LENGTH = 60;

const ACTION_SUFFIXES = ['给我链接', '发链接', '看一下', '谢谢'];
const WRAPPING_QUOTES: ReadonlyArray<readonly [string, string]> = [
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['"', '"'],
  ["'", "'"],
];

function removeWrappingQuotes(value: string): string {
  for (const [opening, closing] of WRAPPING_QUOTES) {
    if (value.startsWith(opening) && value.endsWith(closing)) {
      return value.slice(opening.length, value.length - closing.length).trim();
    }
  }
  return value;
}

export function normalizeBusinessScreeningTitle(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  let title = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  if (!title) {
    return null;
  }

  title = removeWrappingQuotes(title).replace(/\s+/gu, ' ').trim();
  for (const suffix of ACTION_SUFFIXES) {
    if (title === suffix) {
      return null;
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of ACTION_SUFFIXES) {
      if (title.endsWith(suffix)) {
        title = title.slice(0, -suffix.length).trim();
        changed = true;
        break;
      }
    }
  }

  if (!title) {
    return null;
  }

  return Array.from(title).slice(0, MAX_BUSINESS_SCREENING_TITLE_LENGTH).join('') || null;
}
