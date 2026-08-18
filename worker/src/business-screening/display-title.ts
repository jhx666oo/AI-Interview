export const DEFAULT_BUSINESS_SCREENING_TITLE = '业务筛选';
export const MAX_BUSINESS_SCREENING_TITLE_LENGTH = 60;

const ACTION_SUFFIXES = ['给我链接', '发链接', '看一下', '谢谢'];
const ACTION_REQUEST_PREFIXES = ['请', '麻烦'];
const ACTION_ONLY_TERMS = ['查询', '查看', '获取', '给我', '看', '拿到', '发我'];
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

function isActionOnly(value: string): boolean {
  if (ACTION_ONLY_TERMS.includes(value)) return true;
  return ACTION_REQUEST_PREFIXES.some((prefix) => (
    value.startsWith(prefix) && ACTION_ONLY_TERMS.includes(value.slice(prefix.length).trim())
  ));
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

  title = removeWrappingQuotes(title);
  if (!title || isActionOnly(title) || ACTION_REQUEST_PREFIXES.includes(title)) {
    return null;
  }

  return Array.from(title).slice(0, MAX_BUSINESS_SCREENING_TITLE_LENGTH).join('') || null;
}
