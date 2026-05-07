import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

import {
  pushChannelNotification,
  getSocketPath,
  getBridgeLogPath,
  getPanopticonHome,
} from '../panopticon-bridge.js';

const REPO_ROOT = process.cwd();
const BRIDGE_ENTRY = join(REPO_ROOT, 'src/lib/channels/panopticon-bridge.ts');

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
});

/**
 * End-to-end integration of the Bun.serve unix listener. Requires `bun` on
 * PATH; spawns the bridge as a subprocess and posts to the socket via the
 * node:net HTTP/1.1 client used by deliverAgentMessage. Skipped automatically
 * if `bun` is not available so this test file remains green on minimal CI.
 */
describe('panopticon-bridge subprocess (Bun.serve unix listener)', () => {
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

  it(
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

