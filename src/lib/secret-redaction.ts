const API_KEY_PATTERN = /\b(?:sk-ant|sk-proj|sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+\b/g;
const TOKEN_PATTERN = /(?:gh[oprsu]|github_pat|glpat|xox[baprs]|npm)[_-][A-Za-z0-9_-]{20,}/g;
const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const ENV_ASSIGNMENT_PATTERN = /\b([A-Z][A-Z0-9_]{0,127})\s*=\s*([^\s,;]+)/g;
const DATABASE_URL_PATTERN = /\b(?:postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s,;@]+:[^\s,;@]+@[^\s,;]+/gi;
const BASIC_AUTH_URL_PATTERN = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const LABELLED_SECRET_PATTERN = /\b(password|passwd|api[_-]?key|private[_-]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi;
const SENSITIVE_ENV_NAME_PATTERN = /PASSWORD|PASSWD|API_KEY|SECRET|TOKEN/;
const MAX_REDACTION_INPUT_CHARS = 64 * 1024;
const MAX_REDACTION_SCAN_CHARS = 8 * 1024 * 1024;
const MAX_REDACTION_RANGES = 4_096;

interface RedactionRange {
  start: number;
  end: number;
  replacement: string;
}

function collectRegexRanges(
  text: string,
  pattern: RegExp,
  ranges: RedactionRange[],
  replacement: string | ((match: RegExpExecArray) => string | null),
): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = typeof replacement === 'string' ? replacement : replacement(match);
    if (value !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length, replacement: value });
      if (ranges.length > MAX_REDACTION_RANGES) throw new Error('too many sensitive ranges');
    }
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
}

function collectPrivateKeyRanges(text: string, ranges: RedactionRange[]): void {
  const beginPrefix = '-----BEGIN ';
  let offset = 0;
  while (offset < text.length) {
    const start = text.indexOf(beginPrefix, offset);
    if (start < 0) return;
    const headerEnd = text.indexOf('-----', start + beginPrefix.length);
    if (headerEnd < 0) {
      ranges.push({ start, end: text.length, replacement: '[REDACTED_PRIVATE_KEY]' });
      return;
    }
    const label = text.slice(start + beginPrefix.length, headerEnd);
    if (!label.endsWith('PRIVATE KEY')) {
      offset = headerEnd + 5;
      continue;
    }
    const endMarker = `-----END ${label}-----`;
    const markerStart = text.indexOf(endMarker, headerEnd + 5);
    const end = markerStart < 0 ? text.length : markerStart + endMarker.length;
    ranges.push({ start, end, replacement: '[REDACTED_PRIVATE_KEY]' });
    if (ranges.length > MAX_REDACTION_RANGES) throw new Error('too many sensitive ranges');
    offset = end;
  }
}

function collectRedactionRanges(text: string): RedactionRange[] {
  const ranges: RedactionRange[] = [];
  collectPrivateKeyRanges(text, ranges);
  collectRegexRanges(text, API_KEY_PATTERN, ranges, '[REDACTED_API_KEY]');
  collectRegexRanges(text, TOKEN_PATTERN, ranges, '[REDACTED_TOKEN]');
  collectRegexRanges(text, AWS_ACCESS_KEY_PATTERN, ranges, '[REDACTED_AWS_KEY]');
  collectRegexRanges(text, JWT_PATTERN, ranges, '[REDACTED_JWT]');
  collectRegexRanges(text, ENV_ASSIGNMENT_PATTERN, ranges, match => (
    match[1] === 'DATABASE_URL' || SENSITIVE_ENV_NAME_PATTERN.test(match[1] ?? '')
      ? `${match[1]}=[REDACTED]`
      : null
  ));
  collectRegexRanges(text, DATABASE_URL_PATTERN, ranges, '[REDACTED_DATABASE_URL]');
  collectRegexRanges(text, BASIC_AUTH_URL_PATTERN, ranges, match => `${match[1]}[REDACTED]@`);
  collectRegexRanges(text, LABELLED_SECRET_PATTERN, ranges, match => `${match[1]}=[REDACTED]`);
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

function redactRange(text: string, start: number, end: number, ranges: readonly RedactionRange[]): string {
  const parts: string[] = [];
  let offset = start;
  for (const range of ranges) {
    if (range.end <= start) continue;
    if (range.start >= end) break;
    const visibleStart = Math.max(start, range.start);
    if (visibleStart > offset) parts.push(text.slice(offset, visibleStart));
    if (range.end > offset) parts.push(range.replacement);
    offset = Math.max(offset, range.end);
    if (offset >= end) break;
  }
  if (offset < end) parts.push(text.slice(offset, end));
  return parts.join('');
}

export function redactSensitiveText(text: string): string {
  if (text.length > MAX_REDACTION_SCAN_CHARS) return '[REDACTION_INPUT_TOO_LARGE]';

  let ranges: RedactionRange[];
  try {
    ranges = collectRedactionRanges(text);
  } catch {
    return '[REDACTION_INPUT_REDACTED]';
  }

  if (text.length <= MAX_REDACTION_INPUT_CHARS) {
    return redactRange(text, 0, text.length, ranges).slice(0, MAX_REDACTION_INPUT_CHARS);
  }
  const half = MAX_REDACTION_INPUT_CHARS / 2;
  const head = redactRange(text, 0, half, ranges).slice(0, half);
  const tail = redactRange(text, text.length - half, text.length, ranges).slice(-half);
  return `${head}\n[REDACTION_INPUT_TRUNCATED]\n${tail}`;
}
