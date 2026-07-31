const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const API_KEY_PATTERN = /\b(?:sk-ant|sk-proj|sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+\b/g;
const TOKEN_PATTERN = /\b(?:gh[oprsu]|github_pat|glpat|xox[baprs]|npm)[_-][A-Za-z0-9_\-]{20,}\b/g;
const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export function redactSensitiveText(text: string): string {
  return text
    .replace(PRIVATE_KEY_PATTERN, '[REDACTED_PRIVATE_KEY]')
    .replace(API_KEY_PATTERN, '[REDACTED_API_KEY]')
    .replace(TOKEN_PATTERN, '[REDACTED_TOKEN]')
    .replace(AWS_ACCESS_KEY_PATTERN, '[REDACTED_AWS_KEY]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(/\b(?:DATABASE_URL|[A-Z0-9_]*(?:PASSWORD|PASSWD|API_KEY|SECRET|TOKEN)[A-Z0-9_]*)\s*=\s*[^\s,;]+/g, match => {
      const [key] = match.split('=', 1);
      return `${key}=[REDACTED]`;
    })
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s,;@]+:[^\s,;@]+@[^\s,;]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(password|passwd|api[_-]?key|private[_-]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}
