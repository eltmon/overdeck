const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const API_KEY_PATTERN = /\b(?:sk-ant|sk-proj|sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+\b/g;
const TOKEN_PATTERN = /(?:gh[oprsu]|github_pat|glpat|xox[baprs]|npm)[_-][A-Za-z0-9_-]{20,}/g;
const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const ENV_ASSIGNMENT_PATTERN = /\b([A-Z][A-Z0-9_]{0,127})\s*=\s*([^\s,;]+)/g;
const SENSITIVE_ENV_NAME_PATTERN = /PASSWORD|PASSWD|API_KEY|SECRET|TOKEN/;
const MAX_REDACTION_INPUT_CHARS = 64 * 1024;

function boundRedactionInput(text: string): string {
  if (text.length <= MAX_REDACTION_INPUT_CHARS) return text;
  const half = MAX_REDACTION_INPUT_CHARS / 2;
  return `${text.slice(0, half)}\n[REDACTION_INPUT_TRUNCATED]\n${text.slice(-half)}`;
}

export function redactSensitiveText(text: string): string {
  return boundRedactionInput(text)
    .replace(PRIVATE_KEY_PATTERN, '[REDACTED_PRIVATE_KEY]')
    .replace(API_KEY_PATTERN, '[REDACTED_API_KEY]')
    .replace(TOKEN_PATTERN, '[REDACTED_TOKEN]')
    .replace(AWS_ACCESS_KEY_PATTERN, '[REDACTED_AWS_KEY]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(ENV_ASSIGNMENT_PATTERN, (match, key: string) => (
      key === 'DATABASE_URL' || SENSITIVE_ENV_NAME_PATTERN.test(key)
        ? `${key}=[REDACTED]`
        : match
    ))
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s,;@]+:[^\s,;@]+@[^\s,;]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(password|passwd|api[_-]?key|private[_-]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}
