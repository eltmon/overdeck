/**
 * PAN-4563 — protocol capture: fixture format and capture-time scrubbing.
 *
 * Secret-shaped inputs are built at runtime: literal fake tokens trip GitHub
 * push protection.
 */
import { describe, expect, it } from 'vitest';
import { frameKind, parseProtocolFixture, PROTOCOL_CAPTURE_FORMAT } from '../fixture.js';
import { defaultScrubContext, scrubValue } from '../scrub.js';

const context = defaultScrubContext({
  cwd: '/home/dev/projects/app',
  codexHome: '/home/dev/.overdeck/agents/a1/codex',
  overdeckHome: '/home/dev/.overdeck',
  home: '/home/dev',
});

const header = JSON.stringify({
  type: 'header',
  format: PROTOCOL_CAPTURE_FORMAT,
  harness: 'codex-app-server',
  provider: null,
  cliVersion: '0.159.0',
  scenario: null,
  recordedAt: '2026-10-20T03:00:00.000Z',
  hostOptions: null,
  scrubbed: true,
});

function frameLine(seq: number, dir: 'out' | 'in', message: Record<string, unknown>): string {
  return JSON.stringify({ type: 'frame', seq, dir, t: seq, message });
}

describe('scrubValue', () => {
  it('replaces cwd, codex home, overdeck home, and home dir, longest path first', () => {
    const input = [
      '/home/dev/projects/app/src/x.ts',
      '/home/dev/.overdeck/agents/a1/codex/sessions/r.jsonl',
      '/home/dev/.overdeck/logs',
      '/home/dev/notes.md',
    ].join(' ');
    expect(scrubValue(input, context)).toBe(
      '<CWD>/src/x.ts <CODEX_HOME>/sessions/r.jsonl <OVERDECK_HOME>/logs <HOME>/notes.md',
    );
  });

  it('scrubs a nested thread path under the codex home', () => {
    const message = { params: { thread: { id: 't1', path: '/home/dev/.overdeck/agents/a1/codex/rollout.jsonl' } } };
    expect(scrubValue(message, context)).toEqual({ params: { thread: { id: 't1', path: '<CODEX_HOME>/rollout.jsonl' } } });
  });

  it('redacts values under secret keys and keeps token usage counters', () => {
    const message = {
      access_token: 'abc',
      apiKey: 'def',
      nested: { Authorization: 'whatever', refreshToken: 'r' },
      tokenUsage: { total: { inputTokens: 1234, outputTokens: 56 } },
    };
    expect(scrubValue(message, context)).toEqual({
      access_token: '<REDACTED>',
      apiKey: '<REDACTED>',
      nested: { Authorization: '<REDACTED>', refreshToken: '<REDACTED>' },
      tokenUsage: { total: { inputTokens: 1234, outputTokens: 56 } },
    });
  });

  it('redacts secret-shaped values and emails inside strings', () => {
    const apiKey = 'sk-' + 'a'.repeat(24);
    const githubToken = 'gh' + 'p_' + 'b'.repeat(30);
    const slackToken = 'xo' + 'xb-' + '1'.repeat(12);
    const jwt = ['eyJ' + 'h'.repeat(10), 'p'.repeat(10), 's'.repeat(10)].join('.');
    const bearer = 'Bearer ' + 'tok.en-' + 'z'.repeat(12);
    const email = 'dev' + '@' + 'example.com';
    const input = `key ${apiKey} gh ${githubToken} slack ${slackToken} jwt ${jwt} header ${bearer} mail ${email}`;
    expect(scrubValue({ text: input }, context)).toEqual({
      text: 'key <REDACTED> gh <REDACTED> slack <REDACTED> jwt <REDACTED> header <REDACTED> mail <EMAIL>',
    });
  });

  it('truncates strings longer than 8192 characters', () => {
    expect(scrubValue('x'.repeat(8193), context)).toBe('<TRUNCATED:8193>');
    expect(scrubValue('x'.repeat(8192), context)).toBe('x'.repeat(8192));
  });

  it('leaves non-string scalars and the input object unchanged', () => {
    const input = { n: 1, b: true, z: null, list: ['/home/dev/a'] };
    expect(scrubValue(input, context)).toEqual({ n: 1, b: true, z: null, list: ['<HOME>/a'] });
    expect(input.list[0]).toBe('/home/dev/a');
  });
});

describe('parseProtocolFixture', () => {
  it('parses a header and consecutive frames, and derives frame kinds', () => {
    const text = [
      header,
      frameLine(0, 'out', { id: 1, method: 'initialize', params: {} }),
      frameLine(1, 'in', { id: 1, result: {} }),
      frameLine(2, 'in', { method: 'turn/started', params: {} }),
      JSON.stringify({ type: 'frame', seq: 3, dir: 'in', t: 3, text: 'not json' }),
      '',
    ].join('\n');
    const fixture = parseProtocolFixture(text);
    expect(fixture.header.cliVersion).toBe('0.159.0');
    expect(fixture.frames.map(frameKind)).toEqual(['request', 'response', 'notification', 'raw']);
  });

  it('rejects a file whose first line is not a header with the format id', () => {
    expect(() => parseProtocolFixture(frameLine(0, 'out', { id: 1, method: 'initialize' }))).toThrow(/line 1 must be a header/);
    const foreign = JSON.stringify({ ...JSON.parse(header), format: 'other/1' });
    expect(() => parseProtocolFixture(`${foreign}\n`)).toThrow(/line 1 must be a header/);
  });

  it('rejects frame seq values that are not consecutive from 0', () => {
    const gap = [header, frameLine(0, 'out', { id: 1, method: 'a' }), frameLine(2, 'in', { id: 1, result: {} })].join('\n');
    expect(() => parseProtocolFixture(gap)).toThrow(/expected seq 1/);
    const late = [header, frameLine(1, 'out', { id: 1, method: 'a' })].join('\n');
    expect(() => parseProtocolFixture(late)).toThrow(/expected seq 0/);
  });
});
