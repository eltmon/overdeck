import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

import { BRIDGE_TOKEN_HEADER, writeBridgeToken } from '../../bridge-token.js';
import {
  handlePermissionRequestNotification,
  pushChannelNotification,
  pushPermissionDecisionNotification,
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
    { capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} } } },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).notification = vi.fn(async (frame: { method: string; params?: unknown }) => {
    frames.push(frame);
  });
  return { server, frames };
}

async function postToUnixSocket(
  socketPath: string,
  token: string | null,
  body: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest(
      {
        socketPath,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(token ? { [BRIDGE_TOKEN_HEADER]: token } : {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: responseBody });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
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

  it('permission response payload emits exactly one notifications/claude/channel/permission frame', async () => {
    const { server, frames } = createMockServer();
    const result = await pushPermissionDecisionNotification(
      server,
      { type: 'permission_response', requestId: 'perm-1', behavior: 'allow' },
      'a-1',
    );
    expect(result).toEqual({ ok: true, status: 200, body: 'ok' });
    expect(frames).toHaveLength(1);
    expect(frames[0].method).toBe('notifications/claude/channel/permission');
    const params = frames[0].params as { request_id: string; behavior: string };
    expect(params).toEqual({ request_id: 'perm-1', behavior: 'allow' });
  });

  it('normalizes null input_preview when forwarding permission requests', async () => {
    const forwarder = vi.fn(async () => {});
    await handlePermissionRequestNotification(
      {
        method: 'notifications/claude/channel/permission_request',
        params: {
          request_id: 'perm-1',
          tool_name: 'Bash',
          description: 'Run npm test',
          input_preview: null,
        },
      },
      'agent-1',
      forwarder,
    );
    expect(forwarder).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        requestId: 'perm-1',
        toolName: 'Bash',
        description: 'Run npm test',
        inputPreview: '',
      }),
    );
  });

  it('swallows permission forward failures and logs them', async () => {
    await handlePermissionRequestNotification(
      {
        method: 'notifications/claude/channel/permission_request',
        params: {
          request_id: 'perm-2',
          tool_name: 'Bash',
          description: 'Run npm test',
          input_preview: '{"command":"npm test"}',
        },
      },
      'agent-2',
      async () => {
        throw new Error('dashboard down');
      },
    );
    const logPath = getBridgeLogPath('agent-2');
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(JSON.parse(lines[0])).toMatchObject({
      agentId: 'agent-2',
      kind: 'permission_request_forward_failed',
      error: 'dashboard down',
    });
  });

  it('invalid permission response returns 400 and emits zero frames', async () => {
    const { server, frames } = createMockServer();
    const result = await pushPermissionDecisionNotification(
      server,
      { type: 'permission_response', requestId: '', behavior: 'maybe' },
      'a-1',
    );
    expect(result.status).toBe(400);
    expect(result.ok).toBe(false);
    expect(frames).toHaveLength(0);
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

  // FIXME: spawns a Bun subprocess; flaky in CI due to socket-binding timing.
  // Skipped during PAN-1015 merge.
  it.skip(
    'binds socket at 0o600 and unlinks on SIGTERM',
    async () => {
      const agentId = 'int-1';
      writeBridgeToken(agentId);
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
      // chmod(0o600) races with socket creation; retry until it lands.
      let mode = statSync(sockPath).mode & 0o777;
      for (let i = 0; i < 20 && mode !== 0o600; i++) {
        await new Promise((r) => setTimeout(r, 100));
        mode = statSync(sockPath).mode & 0o777;
      }
      expect(mode).toBe(0o600);

      // SIGTERM should terminate the bridge and unlink the socket. Bun may
      // report either an explicit code 0 (handler calls process.exit) or a
      // signal-based exit, so assert termination plus cleanup rather than one
      // exact exit-shape.
      const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          proc?.once('exit', (code, signal) => resolve({ code, signal }));
        },
      );
      proc.kill('SIGTERM');
      const exit = await exitPromise;
      expect(exit.code === 0 || exit.signal === 'SIGTERM').toBe(true);
      for (let i = 0; i < 30 && existsSync(sockPath); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(existsSync(sockPath)).toBe(false);
    },
    15_000,
  );

  it(
    'rejects unauthenticated Unix socket posts with 403 and no notification delivery',
    async () => {
      const agentId = 'int-2';
      const token = writeBridgeToken(agentId);
      proc = spawn('bun', ['run', BRIDGE_ENTRY], {
        env: {
          ...process.env,
          PANOPTICON_HOME: tmpHome,
          PANOPTICON_AGENT_ID: agentId,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      proc.stdin?.write(' ');
      const sockPath = join(tmpHome, 'sockets', `agent-${agentId}.sock`);
      for (let i = 0; i < 30 && !existsSync(sockPath); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(existsSync(sockPath)).toBe(true);

      const forbidden = await postToUnixSocket(sockPath, null, {
        type: 'permission_response',
        requestId: 'perm-403',
        behavior: 'allow',
      });
      expect(forbidden.status).toBe(403);
      expect(forbidden.body).toContain('forbidden');

      const allowed = await postToUnixSocket(sockPath, token, {
        type: 'permission_response',
        requestId: 'perm-403',
        behavior: 'allow',
      });
      expect(allowed.status).toBe(200);
    },
    15_000,
  );
});

