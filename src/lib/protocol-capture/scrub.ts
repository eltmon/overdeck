/**
 * Capture-time scrubber for protocol fixtures (PAN-4563).
 *
 * Every frame is scrubbed before it reaches disk, so raw secrets and personal
 * paths never land in a fixture. The rules, applied recursively:
 *
 * 1. Paths: each known path value (and the host name) becomes its placeholder,
 *    longest first.
 * 2. Secret keys: a value under an anchored secret key name becomes `<REDACTED>`
 *    (anchored so `tokenUsage` and `inputTokens` survive). `installationId`, a
 *    stable device id codex reports in `remoteControl/status/changed`, counts.
 * 3. Secret values: API keys, GitHub/Slack tokens, JWTs, and Bearer headers
 *    inside any string become `<REDACTED>`.
 * 4. Emails become `<EMAIL>`.
 * 5. A string longer than 8192 characters becomes `<TRUNCATED:<length>>`.
 */
import { homedir, hostname } from 'node:os';

export interface ScrubContext {
  paths: ReadonlyArray<{ value: string; placeholder: string }>;
}

export const SCRUB_MAX_STRING_LENGTH = 8192;
export const REDACTED = '<REDACTED>';
export const EMAIL_PLACEHOLDER = '<EMAIL>';

const SECRET_KEY = /^(access_?token|refresh_?token|id_?token|api_?key|authorization|cookie|password|secret|client_?secret|bearer|auth_?token|installation_?id)$/i;

/** Shorter host names are skipped: replacing them would rewrite ordinary text. */
const MIN_HOSTNAME_LENGTH = 4;

/** Secret-shaped substrings. Shared with the fixture hygiene test. */
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[abpr]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/g,
];

export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function defaultScrubContext(input: {
  cwd?: string;
  codexHome?: string;
  overdeckHome?: string;
  home?: string;
  hostname?: string;
}): ScrubContext {
  const host = input.hostname ?? hostname();
  const candidates: Array<{ value: string | undefined; placeholder: string }> = [
    { value: input.cwd, placeholder: '<CWD>' },
    { value: input.codexHome, placeholder: '<CODEX_HOME>' },
    { value: input.overdeckHome, placeholder: '<OVERDECK_HOME>' },
    { value: input.home ?? homedir(), placeholder: '<HOME>' },
    { value: host.length >= MIN_HOSTNAME_LENGTH ? host : undefined, placeholder: '<HOSTNAME>' },
  ];
  return {
    paths: candidates.filter((entry): entry is { value: string; placeholder: string } => Boolean(entry.value)),
  };
}

function scrubString(value: string, context: ScrubContext): string {
  if (value.length > SCRUB_MAX_STRING_LENGTH) return `<TRUNCATED:${value.length}>`;
  let result = value;
  const paths = context.paths
    .filter(entry => entry.value.length > 0)
    .sort((a, b) => b.value.length - a.value.length);
  for (const { value: path, placeholder } of paths) {
    result = result.split(path).join(placeholder);
  }
  for (const pattern of SECRET_VALUE_PATTERNS) result = result.replace(pattern, REDACTED);
  return result.replace(EMAIL_PATTERN, EMAIL_PLACEHOLDER);
}

/** Pure: returns a scrubbed copy of `value`. */
export function scrubValue(value: unknown, context: ScrubContext): unknown {
  if (typeof value === 'string') return scrubString(value, context);
  if (Array.isArray(value)) return value.map(item => scrubValue(item, context));
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const scrubbedKey = scrubString(key, context);
      result[scrubbedKey] = SECRET_KEY.test(key) && item !== null && item !== undefined
        ? REDACTED
        : scrubValue(item, context);
    }
    return result;
  }
  return value;
}
