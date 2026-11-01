import { describe, expect, it } from 'vitest';

import { countRedactions, redactBundleText, redactConfigYaml } from '../../../../src/lib/diagnostics/redact.js';

const RUNTIME_ANTHROPIC_SECRET = ['sk', 'ant', 'api03', 'Q'.repeat(40)].join('-');
const RUNTIME_GITHUB_TOKEN = `gh${'p_'}${'A'.repeat(36)}`;

describe('redactConfigYaml', () => {
  it('redacts a key-name match that redactSensitiveText misses (linear_api_key)', () => {
    const input = `linear_api_key: ${RUNTIME_ANTHROPIC_SECRET}`;
    expect(redactConfigYaml(input)).toBe('linear_api_key: [REDACTED]');
  });

  it('redacts a quoted secret-looking key', () => {
    const input = 'github_token: "abc"';
    expect(redactConfigYaml(input)).toBe('github_token: [REDACTED]');
  });

  it('leaves non-secret-looking values unchanged', () => {
    const input = ['max_tokens: 4096', 'enabled: true', 'api_key: $OPENAI_API_KEY'].join('\n');
    expect(redactConfigYaml(input)).toBe(input);
  });

  it('collapses a block scalar under a secret key to one REDACTED line and preserves the next sibling key', () => {
    const input = [
      'private_key: |',
      '  -----BEGIN PRIVATE KEY-----',
      '  abcdef1234567890',
      '  -----END PRIVATE KEY-----',
      'next_key: value',
    ].join('\n');

    const expected = ['private_key: [REDACTED]', 'next_key: value'].join('\n');
    expect(redactConfigYaml(input)).toBe(expected);
  });
});

describe('redactBundleText', () => {
  it('redacts a config entry secret by key name', () => {
    const input = `linear_api_key: ${RUNTIME_ANTHROPIC_SECRET}`;
    const out = redactBundleText(input, { kind: 'config' });
    expect(out).toContain('[REDACTED');
    expect(out).not.toContain(RUNTIME_ANTHROPIC_SECRET);
  });

  it('redacts a shape-matched token in plain log text', () => {
    const input = `auth failed for token ${RUNTIME_GITHUB_TOKEN}`;
    const out = redactBundleText(input, { kind: 'text' });
    expect(out).toContain('[REDACTED_TOKEN]');
    expect(out).not.toContain(RUNTIME_GITHUB_TOKEN);
  });

  it('replaces every occurrence of home with ~ when home is non-empty', () => {
    const home = '/home/exampleuser';
    const input = `log file at ${home}/.overdeck/logs/dashboard.log and ${home}/.overdeck.env`;
    const out = redactBundleText(input, { kind: 'text', home });
    expect(out).not.toContain(home);
    expect(out).toBe('log file at ~/.overdeck/logs/dashboard.log and ~/.overdeck.env');
  });

  it('does not touch home when it is empty', () => {
    const input = 'plain text with no secrets';
    expect(redactBundleText(input, { kind: 'text', home: '' })).toBe(input);
  });
});

describe('countRedactions', () => {
  it('counts every [REDACTED marker occurrence', () => {
    const text = 'a [REDACTED] b [REDACTED_TOKEN] c [REDACTED_API_KEY] d';
    expect(countRedactions(text)).toBe(3);
  });

  it('returns 0 when there are no markers', () => {
    expect(countRedactions('nothing redacted here')).toBe(0);
  });
});
