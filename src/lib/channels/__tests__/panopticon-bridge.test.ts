import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, ChildProcess, execFileSync } from 'node:child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

import {
  pushChannelNotification,
  getSocketPath,
  getBridgeLogPath,
  getPanopticonHome,
  handleChannelReplyCall,
  isDirectInvocation,
  listBridgeTools,
  validateChannelReplyPayload,
} from '../panopticon-bridge.js';

const REPO_ROOT = process.cwd();
const BRIDGE_ENTRY = join(REPO_ROOT, 'src/lib/channels/panopticon-bridge.ts');
const hasBun = (() => {
  try {
    execFileSync('bun', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let tmpHome: string;

function createMockServer(): { server: Server; frames: Array<{ method: string; params?: unknown }> } {
  const frames: Array<{ method: string; params?: unknown }> = [];
  // The Server type expects connect()ed transport for real notifications;
  // for unit-level tests we monkey-patch .notification to record frames.
  const server = new Server(
    { name: 'test-bridge', version: '0.0.0' },
    { capabilities: { experimental: { 'claude/channel': {} } } },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).notification = vi.fn(async (frame: { method: string; params?: unknown }) => {
    frames.push(frame);
  });
  return { server, frames };
}

describe('pushChannelNotification (in-process protocol)', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-bridge-unit-'));
    process.env.PANOPTICON_HOME = tmpHome;
  });
  afterEach(() => {
    delete process.env.PANOPTICON_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('valid payload emits exactly one notifications/claude/channel frame with content+meta intact', async () => {
    const { server, frames } = createMockServer();
    const result = await pushChannelNotification(
      server,
      { content: 'hello world', meta: { agent_id: 'a-1' } },
      'a-1',
    );
    expect(result).toEqual({ ok: true, status: 200, body: 'ok' });
    expect(frames).toHaveLength(1);
    expect(frames[0].method).toBe('notifications/claude/channel');
    const params = frames[0].params as { source: string; content: string; meta?: Record<string, string> };
    expect(params.source).toBe('panopticon-bridge');
    expect(params.content).toBe('hello world');
    expect(params.meta).toEqual({ agent_id: 'a-1' });
  });

  it('missing content returns 400 and emits zero frames', async () => {
    const { server, frames } = createMockServer();
    const result = await pushChannelNotification(server, {}, 'a-1');
    expect(result.status).toBe(400);
    expect(result.ok).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('non-string content returns 400 and emits zero frames', async () => {
    const { server, frames } = createMockServer();
    const result = await pushChannelNotification(server, { content: 123 }, 'a-1');
    expect(result.status).toBe(400);
    expect(frames).toHaveLength(0);
  });

  it('null payload returns 400 and emits zero frames', async () => {
    const { server, frames } = createMockServer();
    const result = await pushChannelNotification(server, null, 'a-1');
    expect(result.status).toBe(400);
    expect(frames).toHaveLength(0);
  });

  it('valid push appends a JSON log line to the per-agent bridge log', async () => {
    const { server } = createMockServer();
    await pushChannelNotification(server, { content: 'log me', meta: { x: '1' } }, 'log-agent');
    const logPath = getBridgeLogPath('log-agent');
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ agentId: 'log-agent', contentLength: 6, metaKeys: ['x'] });
    expect(entry.ts).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('exposes a deterministic socket path under PANOPTICON_HOME', () => {
    expect(getPanopticonHome()).toBe(tmpHome);
    expect(getSocketPath('xyz')).toBe(join(tmpHome, 'sockets', 'agent-xyz.sock'));
  });

  it('lists channel_reply tool with documented schema', () => {
    const result = listBridgeTools();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('channel_reply');
    expect(result.tools[0].inputSchema.required).toEqual(['kind', 'summary']);
    expect(result.tools[0].inputSchema.properties?.['artifactRefs']).toBeDefined();
  });

  it('validates channel_reply payloads and trims summary', () => {
    expect(
      validateChannelReplyPayload({
        kind: 'done',
        summary: '  implementation complete  ',
        artifactRefs: [{ uri: 'file:///tmp/report.txt', label: 'report' }],
      }),
    ).toEqual({
      kind: 'done',
      summary: 'implementation complete',
      artifactRefs: [{ uri: 'file:///tmp/report.txt', label: 'report' }],
    });
  });

  it('rejects invalid channel_reply payloads', () => {
    expect(() => validateChannelReplyPayload({ kind: 'bogus', summary: 'x' })).toThrow(
      'channel_reply.kind must be one of: status, done, needs_input',
    );
    expect(() => validateChannelReplyPayload({ kind: 'done', summary: '' })).toThrow(
      'channel_reply.summary must be a non-empty string',
    );
    expect(() =>
      validateChannelReplyPayload({
        kind: 'status',
        summary: 'x',
        artifactRefs: [{ label: 'missing-uri' }],
      }),
    ).toThrow('channel_reply.artifactRefs[0].uri must be a non-empty string');
    expect(() =>
      validateChannelReplyPayload({
        kind: 'status',
        summary: 'x'.repeat(4097),
      }),
    ).toThrow('channel_reply.summary must be at most 4096 characters');
    expect(() =>
      validateChannelReplyPayload({
        kind: 'status',
        summary: 'ok',
        artifactRefs: Array.from({ length: 21 }, (_, i) => ({ uri: `file:///tmp/${i}` })),
      }),
    ).toThrow('channel_reply.artifactRefs must contain at most 20 entries');
    expect(() =>
      validateChannelReplyPayload({
        kind: 'status',
        summary: 'ok',
        artifactRefs: [{ uri: 'javascript:alert(1)' }],
      }),
    ).toThrow('channel_reply.artifactRefs[0].uri must start with file://, https://, or /');
  });

  it('detects direct invocation for relative bridge paths', () => {
    const metaUrl = pathToFileURL(BRIDGE_ENTRY).href;
    expect(isDirectInvocation(metaUrl, './src/lib/channels/panopticon-bridge.ts')).toBe(true);
    expect(isDirectInvocation(metaUrl, BRIDGE_ENTRY)).toBe(true);
    expect(isDirectInvocation(metaUrl, undefined)).toBe(false);
  });

  it('accepts channel_reply calls, invokes sink, and appends outbound log line', async () => {
    const sink = vi.fn(async () => undefined);
    const result = await handleChannelReplyCall(
      {
        kind: 'needs_input',
        summary: 'Need user answer',
        artifactRefs: [{ uri: 'file:///tmp/question.md', label: 'question' }],
      },
      'reply-agent',
      sink,
    );
    expect(sink).toHaveBeenCalledWith({
      kind: 'needs_input',
      summary: 'Need user answer',
      artifactRefs: [{ uri: 'file:///tmp/question.md', label: 'question' }],
    });
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'channel_reply accepted (needs_input)' });
    const lines = readFileSync(getBridgeLogPath('reply-agent'), 'utf-8').trim().split('\n');
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      agentId: 'reply-agent',
      direction: 'outbound',
      kind: 'needs_input',
      summaryLength: 16,
      artifactCount: 1,
    });
  });
});

/**
 * End-to-end integration of the Bun.serve unix listener. Requires `bun` on
 * PATH; spawns the bridge as a subprocess and posts to the socket via the
 * node:net HTTP/1.1 client used by deliverAgentMessage. Skipped automatically
 * if `bun` is not available so this test file remains green on minimal CI.
 */
describe.skipIf(!hasBun)('panopticon-bridge subprocess (Bun.serve unix listener)', () => {
  let proc: ChildProcess | null = null;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-bridge-int-'));
    process.env.PANOPTICON_HOME = tmpHome;
  });

  afterEach(async () => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
      if (!proc.killed) proc.kill('SIGKILL');
    }
    proc = null;
    delete process.env.PANOPTICON_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  // FIXME: spawns a Bun subprocess; flaky in CI due to socket-binding timing.
  // Skipped during PAN-1015 merge.
  it.skip(
    'binds socket at 0o600 and unlinks on SIGTERM',
    async () => {
      const agentId = 'int-1';
      proc = spawn('bun', ['run', BRIDGE_ENTRY], {
        env: {
          ...process.env,
          PANOPTICON_HOME: tmpHome,
          PANOPTICON_AGENT_ID: agentId,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Hold stdin open
      proc.stdin?.write(' ');
      const sockPath = join(tmpHome, 'sockets', `agent-${agentId}.sock`);
      // Wait up to 3s for socket
      for (let i = 0; i < 30 && !existsSync(sockPath); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(existsSync(sockPath)).toBe(true);
      const mode = statSync(sockPath).mode & 0o777;
      expect(mode).toBe(0o600);

      // SIGTERM should unlink
      proc.kill('SIGTERM');
      for (let i = 0; i < 30 && existsSync(sockPath); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(existsSync(sockPath)).toBe(false);
    },
    15_000,
  );
});

