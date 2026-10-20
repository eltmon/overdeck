/**
 * PAN-4563 — protocol capture: fixture format and capture-time scrubbing.
 *
 * Secret-shaped inputs are built at runtime: literal fake tokens trip GitHub
 * push protection.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Effect from 'effect/Effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppServerTransport } from '../../codex/app-server-transport.js';
import { acpCaptureProtocolLogging } from '../acp-logging.js';
import {
  captureAppServerTransport,
  createProtocolCaptureSink,
  PROTOCOL_CAPTURE_DIR_ENV,
  protocolCaptureFromEnv,
} from '../capture.js';
import { frameKind, loadProtocolFixture, parseProtocolFixture, PROTOCOL_CAPTURE_FORMAT } from '../fixture.js';
import { defaultScrubContext, scrubValue } from '../scrub.js';

const context = defaultScrubContext({
  cwd: '/home/dev/projects/app',
  codexHome: '/home/dev/.overdeck/agents/a1/codex',
  overdeckHome: '/home/dev/.overdeck',
  home: '/home/dev',
  hostname: 'devbox-1',
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

  it('replaces the host name and redacts the codex installation id', () => {
    const message = { params: { serverName: 'devbox-1', installationId: '761dcfd9-0000', note: 'on devbox-1 now' } };
    expect(scrubValue(message, context)).toEqual({ params: { serverName: '<HOSTNAME>', installationId: '<REDACTED>', note: 'on <HOSTNAME> now' } });
    expect(defaultScrubContext({ home: '/h', hostname: 'pc' }).paths.map(entry => entry.placeholder)).toEqual(['<HOME>']);
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

describe('capture sink', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pan-capture-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeSink() {
    let clock = 1000;
    return createProtocolCaptureSink({
      path: join(dir, 'nested', 'capture.jsonl'),
      harness: 'codex-app-server',
      scrub: context,
      now: () => (clock += 5),
    });
  }

  it('writes the header first and frames in call order', async () => {
    const sink = makeSink();
    sink.setHeader({ cliVersion: '0.159.0', scenario: 'turn-idle' });
    sink.recordMessage('out', { id: 1, method: 'initialize' });
    sink.setHeader({ cliVersion: 'ignored' });
    sink.recordText('in', '{"id":1,"result":{}}');
    sink.recordMessage('out', { method: 'initialized' });
    await sink.close();

    const lines = (await readFile(sink.path, 'utf8')).trim().split('\n');
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'header', format: PROTOCOL_CAPTURE_FORMAT, cliVersion: '0.159.0', scenario: 'turn-idle' });
    const fixture = await loadProtocolFixture(sink.path);
    expect(fixture.frames.map(frame => [frame.seq, frame.dir, frame.message?.method ?? 'response'])).toEqual([
      [0, 'out', 'initialize'],
      [1, 'in', 'response'],
      [2, 'out', 'initialized'],
    ]);
  });

  it('replaces an existing file instead of appending to it', async () => {
    const first = makeSink();
    first.recordMessage('out', { id: 1, method: 'old' });
    await first.close();
    const second = makeSink();
    second.recordMessage('out', { id: 1, method: 'new' });
    await second.close();
    const { frames } = await loadProtocolFixture(second.path);
    expect(frames.map(frame => frame.message?.method)).toEqual(['new']);
  });

  it('joins a JSON object split across two chunks into one frame', async () => {
    const sink = makeSink();
    sink.recordChunk('in', '{"jsonrpc":"2.0","id":0,');
    sink.recordChunk('in', '"result":{"ok":true}}\n');
    await sink.close();
    const { frames } = await loadProtocolFixture(sink.path);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.message).toEqual({ jsonrpc: '2.0', id: 0, result: { ok: true } });
  });

  it('splits two lines in one chunk into two frames', async () => {
    const sink = makeSink();
    sink.recordChunk('out', '{"id":1,"method":"a"}\n{"id":2,"method":"b"}\n');
    await sink.close();
    const { frames } = await loadProtocolFixture(sink.path);
    expect(frames.map(frame => frame.message?.method)).toEqual(['a', 'b']);
  });

  it('stores an unparsable line as a text frame', async () => {
    const sink = makeSink();
    sink.recordChunk('in', 'warning: not json\n');
    sink.recordChunk('in', 'trailing partial');
    await sink.close();
    const { frames } = await loadProtocolFixture(sink.path);
    expect(frames.map(frame => frame.text)).toEqual(['warning: not json', 'trailing partial']);
  });

  it('writes a cwd path in a frame as <CWD>', async () => {
    const sink = makeSink();
    sink.recordMessage('out', { id: 1, method: 'thread/start', params: { cwd: '/home/dev/projects/app' } });
    await sink.close();
    const text = await readFile(sink.path, 'utf8');
    expect(text).toContain('"cwd":"<CWD>"');
    expect(text).not.toContain('/home/dev');
  });

  it('returns undefined from the env when the capture dir is unset, empty, or relative', () => {
    const input = { harness: 'codex-app-server' as const, scrub: context };
    expect(protocolCaptureFromEnv({}, input)).toBeUndefined();
    expect(protocolCaptureFromEnv({ [PROTOCOL_CAPTURE_DIR_ENV]: '' }, input)).toBeUndefined();
    expect(protocolCaptureFromEnv({ [PROTOCOL_CAPTURE_DIR_ENV]: 'relative/dir' }, input)).toBeUndefined();
  });

  it('names an env capture file after the harness, time, and pid inside the capture dir', async () => {
    const sink = protocolCaptureFromEnv({ [PROTOCOL_CAPTURE_DIR_ENV]: dir }, { harness: 'acp', scrub: context });
    expect(sink?.path).toMatch(new RegExp(`^${dir}/acp-\\d{4}-\\d{2}-\\d{2}T[\\d-]+Z-${process.pid}\\.jsonl$`));
    await sink?.close();
    expect(await readdir(dir)).toHaveLength(1);
  });

  it('records an out and an in frame around a wrapped transport', async () => {
    const sink = makeSink();
    const sent: unknown[] = [];
    let deliver: (text: string) => void = () => undefined;
    const inner: AppServerTransport = {
      send: message => sent.push(message),
      onMessage: handler => {
        deliver = handler;
      },
      onClose: () => undefined,
      close: () => undefined,
    };
    const received: string[] = [];
    const transport = captureAppServerTransport(inner, sink);
    transport.onMessage(text => received.push(text));
    transport.send({ id: 1, method: 'initialize' });
    deliver('{"id":1,"result":{}}');
    await sink.close();

    expect(sent).toEqual([{ id: 1, method: 'initialize' }]);
    expect(received).toEqual(['{"id":1,"result":{}}']);
    const { frames } = await loadProtocolFixture(sink.path);
    expect(frames.map(frame => [frame.dir, frameKind(frame)])).toEqual([
      ['out', 'request'],
      ['in', 'response'],
    ]);
  });
});

describe('acpCaptureProtocolLogging', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pan-acp-capture-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('turns raw events into frames and ignores decoded events', async () => {
    const sink = createProtocolCaptureSink({ path: join(dir, 'acp.jsonl'), harness: 'acp', scrub: context });
    const logging = acpCaptureProtocolLogging(sink);
    expect(logging).toMatchObject({ logIncoming: true, logOutgoing: true });
    const log = logging.logger!;
    Effect.runSync(log({ direction: 'outgoing', stage: 'raw', payload: '{"jsonrpc":"2.0","id":0,"method":"initialize"}\n' }));
    Effect.runSync(log({ direction: 'incoming', stage: 'raw', payload: '{"jsonrpc":"2.0","id":0,"res' }));
    Effect.runSync(log({ direction: 'incoming', stage: 'decoded', payload: { jsonrpc: '2.0', id: 0, result: {} } }));
    Effect.runSync(log({ direction: 'incoming', stage: 'raw', payload: 'ult":{"protocolVersion":1}}\n' }));
    await sink.close();

    const { frames } = await loadProtocolFixture(sink.path);
    expect(frames.map(frame => [frame.dir, frameKind(frame)])).toEqual([
      ['out', 'request'],
      ['in', 'response'],
    ]);
    expect(frames[1]!.message).toEqual({ jsonrpc: '2.0', id: 0, result: { protocolVersion: 1 } });
  });
});
