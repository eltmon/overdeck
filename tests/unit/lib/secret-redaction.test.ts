import { describe, expect, it } from 'vitest';
import { findSecretMatches, redactSensitiveText } from '../../../src/lib/secret-redaction.js';

const GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
// Assembled at runtime: GitHub push protection rejects the literal even though it is fake.
const SLACK_TOKEN = ['xoxb', '1234567890', 'abcdefghijklmnopqrstuv'].join('-');

/**
 * One sample per pattern, pinned to the output redactSensitiveText produced
 * before findSecretMatches was added (PAN-2609 P-8). Any change here means the
 * redaction surface changed.
 */
const PINNED: Array<[name: string, input: string, output: string]> = [
  ['api-key (anthropic)', 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 used', 'key [REDACTED_API_KEY] used'],
  ['api-key (generic sk-)', 'export KEY=sk-abcdefgh1234567890XYZ', 'export KEY=[REDACTED_API_KEY]'],
  ['token (github)', `token ${GITHUB_TOKEN} ok`, 'token [REDACTED_TOKEN] ok'],
  ['token (slack)', `slack ${SLACK_TOKEN} end`, 'slack [REDACTED_TOKEN] end'],
  ['aws-access-key', `aws ${AWS_KEY} region`, 'aws [REDACTED_AWS_KEY] region'],
  ['jwt', 'bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF-ghi_JKL done', 'bearer [REDACTED_JWT] done'],
  ['env assignment (sensitive name)', 'DATABASE_PASSWORD=hunter2 and FOO=bar', 'DATABASE_PASSWORD=[REDACTED] and FOO=bar'],
  ['env assignment (DATABASE_URL)', 'DATABASE_URL=postgres://u:p@h/db', 'DATABASE_URL=[REDACTED]'],
  ['database-url', 'url postgres://user:pass@host:5432/db end', 'url [REDACTED_DATABASE_URL] end'],
  ['basic-auth-url', 'curl https://alice:s3cret@example.com/path', 'curl https://[REDACTED]@example.com/path'],
  ['labelled secret', 'password: hunter2, api_key=abc123 token: zzz', 'password=[REDACTED], api_key=[REDACTED] token=[REDACTED]'],
  [
    'private-key',
    'before -----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY----- after',
    'before [REDACTED_PRIVATE_KEY] after',
  ],
  ['private-key (unterminated)', 'x -----BEGIN PRIVATE KEY-----\nabc', 'x [REDACTED_PRIVATE_KEY]'],
  [
    'not a private key',
    '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
    '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
  ],
  ['plain shell output', 'export FOO=bar token: abc', 'export FOO=bar token=[REDACTED]'],
  ['mixed', `gh ${GITHUB_TOKEN} aws ${AWS_KEY}`, 'gh [REDACTED_TOKEN] aws [REDACTED_AWS_KEY]'],
];

describe('redactSensitiveText (pinned)', () => {
  it.each(PINNED)('ac1: %s', (_name, input, output) => {
    expect(redactSensitiveText(input)).toBe(output);
  });
});

describe('findSecretMatches', () => {
  it('ac2: names a GitHub token and an AWS key with their offsets', () => {
    const text = `gh ${GITHUB_TOKEN} aws ${AWS_KEY}`;
    const matches = findSecretMatches(text);
    expect(matches).toEqual([
      { pattern: 'token', start: 3, end: 3 + GITHUB_TOKEN.length },
      { pattern: 'aws-access-key', start: text.indexOf(AWS_KEY), end: text.indexOf(AWS_KEY) + AWS_KEY.length },
    ]);
    expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(GITHUB_TOKEN);
    expect(text.slice(matches[1]!.start, matches[1]!.end)).toBe(AWS_KEY);
  });

  it('ac3: env assignments and labelled secrets are not blocking patterns', () => {
    expect(findSecretMatches('export FOO=bar token: abc')).toEqual([]);
    expect(findSecretMatches('DATABASE_PASSWORD=hunter2 password: x API_KEY=y')).toEqual([]);
  });

  it('covers every blocking pattern name', () => {
    const names = (text: string) => findSecretMatches(text).map((match) => match.pattern);
    expect(names('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789')).toEqual(['api-key']);
    expect(names('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF-ghi_JKL')).toEqual(['jwt']);
    expect(names('postgres://user:pass@host:5432/db')).toEqual(['database-url']);
    expect(names('https://alice:s3cret@example.com/')).toEqual(['basic-auth-url']);
    expect(names('-----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----')).toEqual(['private-key']);
    expect(names('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----')).toEqual([]);
    expect(names('nothing secret here')).toEqual([]);
  });

  it('returns matches sorted by offset and does not change redaction output', () => {
    const text = `${AWS_KEY} then -----BEGIN PRIVATE KEY-----\nk\n-----END PRIVATE KEY----- then ${GITHUB_TOKEN}`;
    const matches = findSecretMatches(text);
    expect(matches.map((match) => match.pattern)).toEqual(['aws-access-key', 'private-key', 'token']);
    for (let i = 1; i < matches.length; i++) expect(matches[i]!.start).toBeGreaterThanOrEqual(matches[i - 1]!.end);
    expect(redactSensitiveText(text)).toBe('[REDACTED_AWS_KEY] then [REDACTED_PRIVATE_KEY] then [REDACTED_TOKEN]');
  });
});
