import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, Server as NetServer } from 'node:net';

let tmpHome: string;
let stateDir: string;
let socketDir: string;

vi.mock('../tmux.js', () => ({
  createSession: vi.fn(),
  createSession: vi.fn(() => Effect.void),
  killSession: vi.fn(),
  killSessionSync: vi.fn(),
  killSession: vi.fn(() => Effect.void),
  sendKeys: vi.fn(() => Effect.void),
  sendKeysProgram: vi.fn(() => Effect.void),
  sendRawKeystroke: vi.fn(() => Effect.void),
  sessionExists: vi.fn(),
  sessionExistsSync: vi.fn(),
  sessionExists: vi.fn(() => Effect.succeed(false)),
  getAgentSessions: vi.fn(),
  getAgentSessionsSync: vi.fn(),
  getAgentSessions: vi.fn(() => Effect.succeed([])),
  getAgentSessionsSync: vi.fn(() => Effect.succeed([])),
  capturePane: vi.fn(),
  capturePane: vi.fn(() => Effect.succeed('')),
  listPaneValues: vi.fn(),
  listPaneValues: vi.fn(() => Effect.succeed([])),
  setOption: vi.fn(() => Effect.void),
  waitForClaudePrompt: vi.fn(async () => true),
}));

vi.mock('../paths.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    get AGENTS_DIR() {
      return stateDir;
    },
  };
});

import { BRIDGE_TOKEN_HEADER, writeBridgeTokenSync } from '../bridge-token.js';
import { PTY_TOKEN_HEADER, writePtyToken } from '../pty-token.js';
import { deliverAgentMessage, deliverAgentPermissionDecision, type AgentState } from '../agents.js';
import { sendKeys } from '../tmux.js';

function writeAgentState(agentId: string, partial: Partial<AgentState>): void {
  const dir = join(stateDir, agentId);
  mkdirSync(dir, { recursive: true });
  const state: AgentState = {
    id: agentId,
    issueId: 'PAN-TEST',
    workspace: '/tmp/x',
    harness: 'claude-code',
    role: 'work',
    model: 'claude-opus-4-7',
    status: 'running',
    startedAt: new Date().toISOString(),
    ...partial,
  };
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
}

interface FakeBridgeOptions {
  status: number;
  body: string;
  delayMs?: number;
  capture?: { lastBody?: string; lastHeaders?: Record<string, string> };
}

function readDeliveryLog(agentId: string): Array<Record<string, unknown>> {
  return readFileSync(join(tmpHome, 'logs', `bridge-${agentId}.log`), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function startFakeBridge(socketPath: string, opts: FakeBridgeOptions): Promise<NetServer> {
  return new Promise((resolveServer) => {
    const server = createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const text = buf.toString('utf-8');
        const headerEnd = text.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const headerBlock = text.slice(0, headerEnd);
        const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerBlock);
        const len = lengthMatch ? parseInt(lengthMatch[1], 10) : 0;
        if (text.length - (headerEnd + 4) < len) return;
        const body = text.slice(headerEnd + 4, headerEnd + 4 + len);
        if (opts.capture) {
          opts.capture.lastBody = body;
          const rawHeaders = headerBlock.split('\r\n').slice(1);
          opts.capture.lastHeaders = Object.fromEntries(
            rawHeaders.map((line) => {
              const idx = line.indexOf(':');
              const name = idx >= 0 ? line.slice(0, idx).trim().toLowerCase() : line.trim().toLowerCase();
              const value = idx >= 0 ? line.slice(idx + 1).trim() : '';
              return [name, value];
            }),
          );
        }
        const respond = () => {
          const resp =
            `HTTP/1.1 ${opts.status} ${opts.status === 200 ? 'OK' : 'ERR'}\r\n` +
            `Content-Length: ${Buffer.byteLength(opts.body)}\r\n` +
            `Connection: close\r\n` +
            `\r\n` +
            opts.body;
          sock.end(resp);
        };
        if (opts.delayMs) {
          setTimeout(respond, opts.delayMs);
        } else {
          respond();
        }
      });
    });
    server.listen(socketPath, () => resolveServer(server));
  });
}

describe('channel bridge delivery', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-deliver-'));
    stateDir = join(tmpHome, 'agents');
    socketDir = join(tmpHome, 'sockets');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(socketDir, { recursive: true });
    process.env.PANOPTICON_HOME = tmpHome;
    vi.mocked(sendKeys).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PANOPTICON_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('supervisor-only success: posts to PTY socket and does not call sendKeysProgram', async () => {
    const agentId = 'agent-supervisor';
    writeAgentState(agentId, { channelsEnabled: false });
    const token = await writePtyToken(agentId);
    const socketPath = join(socketDir, `pty-${agentId}.sock`);
    const capture: { lastBody?: string; lastHeaders?: Record<string, string> } = {};
    const server = await startFakeBridge(socketPath, { status: 200, body: 'ok', capture });
    try {
      const result = await deliverAgentMessage(agentId, 'supervisor hi', 'caller-supervisor');
      expect(result).toEqual({ ok: true, path: 'supervisor' });
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
      expect(capture.lastBody).toBeDefined();
      expect(JSON.parse(capture.lastBody!)).toMatchObject({
        content: 'supervisor hi',
        meta: { caller: 'caller-supervisor' },
      });
      expect(capture.lastHeaders?.[PTY_TOKEN_HEADER]).toBe(token);
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({ path: 'supervisor' });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('supervisor POST can take longer than the old timeout without spurious fallback', async () => {
    const agentId = 'agent-supervisor-budget';
    writeAgentState(agentId, { channelsEnabled: true });
    await writePtyToken(agentId);
    writeBridgeTokenSync(agentId);
    const supervisor = await startFakeBridge(join(socketDir, `pty-${agentId}.sock`), {
      status: 200,
      body: 'ok',
      delayMs: 2_500,
    });
    const channel = await startFakeBridge(join(socketDir, `agent-${agentId}.sock`), {
      status: 200,
      body: 'channel should not be used',
    });
    try {
      await expect(deliverAgentMessage(agentId, 'confirmed within budget', 'caller-budget')).resolves.toEqual({ ok: true, path: 'supervisor' });
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({ path: 'supervisor' });
    } finally {
      await Promise.all([
        new Promise<void>((r) => supervisor.close(() => r())),
        new Promise<void>((r) => channel.close(() => r())),
      ]);
    }
  }, 8_000);

  it('plain fork conversation delivery routes to supervisor without Channels state', async () => {
    const agentId = 'conv-plain-fork';
    const token = await writePtyToken(agentId);
    const socketPath = join(socketDir, `pty-${agentId}.sock`);
    const capture: { lastBody?: string; lastHeaders?: Record<string, string> } = {};
    const server = await startFakeBridge(socketPath, { status: 200, body: 'ok', capture });
    try {
      const result = await deliverAgentMessage(agentId, 'plain fork hi', 'plain-fork-test');
      expect(result).toEqual({ ok: true, path: 'supervisor' });
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
      expect(JSON.parse(capture.lastBody!)).toMatchObject({
        content: 'plain fork hi',
        meta: { caller: 'plain-fork-test' },
      });
      expect(capture.lastHeaders?.[PTY_TOKEN_HEADER]).toBe(token);
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({ path: 'supervisor' });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('supervisor missing: falls through to channels when channels are enabled', async () => {
    const agentId = 'agent-supervisor-missing';
    writeAgentState(agentId, { channelsEnabled: true });
    writeBridgeTokenSync(agentId);
    const socketPath = join(socketDir, `agent-${agentId}.sock`);
    const server = await startFakeBridge(socketPath, { status: 200, body: 'ok' });
    try {
      const result = await deliverAgentMessage(agentId, 'channel hi', 'caller-channel');
      expect(result).toEqual({ ok: true, path: 'channels' });
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({
        path: 'channel',
        'pty-supervisor': 'socket-missing',
      });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('both sockets missing: falls through to tmux and logs tier failures', async () => {
    const agentId = 'agent-no-sockets';
    writeAgentState(agentId, { channelsEnabled: true });

    const result = await deliverAgentMessage(agentId, 'tmux hi', 'caller-tmux');

    expect(result).toEqual({ ok: true, path: 'tmux', failure: 'socket-missing' });
    expect(vi.mocked(sendKeys)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendKeys)).toHaveBeenCalledWith(agentId, 'tmux hi');
    expect(readDeliveryLog(agentId).at(-1)).toMatchObject({
      path: 'tmux',
      channels: 'socket-missing',
      'pty-supervisor': 'socket-missing',
    });
  });

  it('supervisor POST 500: falls through to channels and logs supervisor failure', async () => {
    const agentId = 'agent-supervisor-500';
    writeAgentState(agentId, { channelsEnabled: true });
    await writePtyToken(agentId);
    writeBridgeTokenSync(agentId);
    const supervisor = await startFakeBridge(join(socketDir, `pty-${agentId}.sock`), {
      status: 500,
      body: 'broken',
    });
    const channel = await startFakeBridge(join(socketDir, `agent-${agentId}.sock`), {
      status: 200,
      body: 'ok',
    });
    try {
      const result = await deliverAgentMessage(agentId, 'fallback channel', 'caller-500');
      expect(result).toEqual({ ok: true, path: 'channels' });
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({ path: 'channel' });
      expect(readDeliveryLog(agentId).at(-1)?.['pty-supervisor']).toMatch(/^socket-post-failed:/);
    } finally {
      await Promise.all([
        new Promise<void>((r) => supervisor.close(() => r())),
        new Promise<void>((r) => channel.close(() => r())),
      ]);
    }
  });

  it('supervisor POST non-2xx: falls through to tmux when channels are disabled', async () => {
    const agentId = 'agent-supervisor-non-2xx-tmux';
    writeAgentState(agentId, { channelsEnabled: false });
    await writePtyToken(agentId);
    const supervisor = await startFakeBridge(join(socketDir, `pty-${agentId}.sock`), {
      status: 502,
      body: '{"error":"input echo confirmation failed"}',
    });
    try {
      const result = await deliverAgentMessage(agentId, 'fallback tmux', 'caller-non-2xx');
      expect(result).toEqual({ ok: true, path: 'tmux', failure: 'channels-disabled' });
      expect(vi.mocked(sendKeys)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(sendKeys)).toHaveBeenCalledWith(agentId, 'fallback tmux');
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({ path: 'tmux' });
      expect(readDeliveryLog(agentId).at(-1)?.['pty-supervisor']).toMatch(/^socket-post-failed:/);
    } finally {
      await new Promise<void>((r) => supervisor.close(() => r()));
    }
  });

  it('deliveryMethod supervisor is strict when the PTY socket returns non-2xx', async () => {
    const agentId = 'agent-supervisor-strict-non-2xx';
    writeAgentState(agentId, { channelsEnabled: true });
    await writePtyToken(agentId);
    const supervisor = await startFakeBridge(join(socketDir, `pty-${agentId}.sock`), {
      status: 502,
      body: '{"error":"input echo confirmation failed"}',
    });
    try {
      await expect(deliverAgentMessage(agentId, 'strict hi', 'caller-strict-non-2xx', 'supervisor')).rejects.toThrow(
        /MessageDeliveryFailed: PTY supervisor delivery failed/,
      );
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((r) => supervisor.close(() => r()));
    }
  });

  it('supervisor POST timeout: falls through to channels', async () => {
    const agentId = 'agent-supervisor-timeout';
    writeAgentState(agentId, { channelsEnabled: true });
    await writePtyToken(agentId);
    writeBridgeTokenSync(agentId);
    const supervisor = await startFakeBridge(join(socketDir, `pty-${agentId}.sock`), {
      status: 200,
      body: 'late',
      delayMs: 4_500,
    });
    const channel = await startFakeBridge(join(socketDir, `agent-${agentId}.sock`), {
      status: 200,
      body: 'ok',
    });
    try {
      await expect(deliverAgentMessage(agentId, 'timeout fallback', 'caller-timeout')).resolves.toEqual({ ok: true, path: 'channels' });
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({ path: 'channel' });
      expect(readDeliveryLog(agentId).at(-1)?.['pty-supervisor']).toMatch(/^socket-post-failed:/);
    } finally {
      await Promise.all([
        new Promise<void>((r) => supervisor.close(() => r())),
        new Promise<void>((r) => channel.close(() => r())),
      ]);
    }
  }, 10_000);

  it('deliveryMethod supervisor is strict when the PTY socket is missing', async () => {
    const agentId = 'agent-supervisor-strict';
    writeAgentState(agentId, { channelsEnabled: true });

    await expect(deliverAgentMessage(agentId, 'strict hi', 'caller-strict', 'supervisor')).rejects.toThrow(
      /MessageDeliveryFailed: PTY supervisor delivery failed/,
    );
    expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
  });

  it('deliverAgentMessage flag-off: delegates to sendKeysProgram exactly once with no socket attempt', async () => {
    const agentId = 'agent-flag-off';
    writeAgentState(agentId, { channelsEnabled: false });
    const result = await deliverAgentMessage(agentId, 'hello', 'test');
    expect(result).toEqual({ ok: true, path: 'tmux', failure: 'channels-disabled' });
    expect(vi.mocked(sendKeys)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendKeys)).toHaveBeenCalledWith(agentId, 'hello');
  });

  it('state-file missing: delegates to sendKeysProgram (treat as flag-off)', async () => {
    const result = await deliverAgentMessage('agent-no-state', 'hello', 'test');
    expect(result).toEqual({ ok: true, path: 'tmux', failure: 'channels-disabled' });
    expect(vi.mocked(sendKeys)).toHaveBeenCalledTimes(1);
  });

  it('flag-on, socket-success: posts to bridge and does NOT call sendKeysProgram', async () => {
    const agentId = 'agent-channels';
    writeAgentState(agentId, { channelsEnabled: true });
    const token = writeBridgeTokenSync(agentId);
    const socketPath = join(socketDir, `agent-${agentId}.sock`);
    const capture: { lastBody?: string } = {};
    const server = await startFakeBridge(socketPath, { status: 200, body: 'ok', capture });
    try {
      const result = await deliverAgentMessage(agentId, 'channel hi', 'caller-x');
      expect(result).toEqual({ ok: true, path: 'channels' });
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
      expect(capture.lastBody).toBeDefined();
      const parsed = JSON.parse(capture.lastBody!);
      expect(parsed).toMatchObject({ content: 'channel hi', meta: { caller: 'caller-x' } });
      expect(capture.lastHeaders?.[BRIDGE_TOKEN_HEADER]).toBe(token);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('flag-on, socket-ENOENT: falls back to sendKeysProgram', async () => {
    const agentId = 'agent-no-sock';
    writeAgentState(agentId, { channelsEnabled: true });
    // Do NOT start a bridge — socket file does not exist.
    const result = await deliverAgentMessage(agentId, 'fallback hi', 'caller-y');
    expect(result).toEqual({ ok: true, path: 'tmux', failure: 'socket-missing' });
    expect(vi.mocked(sendKeys)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendKeys)).toHaveBeenCalledWith(agentId, 'fallback hi');
  });

  it('flag-on, socket-timeout: falls back to sendKeysProgram', async () => {
    vi.useFakeTimers();
    const agentId = 'agent-timeout';
    writeAgentState(agentId, { channelsEnabled: true });
    writeBridgeTokenSync(agentId);
    const socketPath = join(socketDir, `agent-${agentId}.sock`);
    // Bridge that delays its response longer than the deliver timeout.
    const server = await startFakeBridge(socketPath, { status: 200, body: 'ok', delayMs: 3500 });
    try {
      const delivered = deliverAgentMessage(agentId, 'timeout hi', 'caller-z');
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(delivered).resolves.toMatchObject({ ok: true, path: 'tmux' });
      expect(vi.mocked(sendKeys)).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('flag-on, missing bridge token: falls back to sendKeysProgram', async () => {
    const agentId = 'agent-no-token';
    writeAgentState(agentId, { channelsEnabled: true });
    const socketPath = join(socketDir, `agent-${agentId}.sock`);
    const server = await startFakeBridge(socketPath, { status: 200, body: 'ok' });
    try {
      const result = await deliverAgentMessage(agentId, 'fallback no token', 'caller-no-token');
      expect(result).toEqual({ ok: true, path: 'tmux', failure: 'bridge-token-missing' });
      expect(vi.mocked(sendKeys)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(sendKeys)).toHaveBeenCalledWith(agentId, 'fallback no token');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('deliverAgentPermissionDecision posts permission_response payload to bridge', async () => {
    const agentId = 'agent-perm-ok';
    writeAgentState(agentId, { channelsEnabled: true });
    const token = writeBridgeTokenSync(agentId);
    const socketPath = join(socketDir, `agent-${agentId}.sock`);
    const capture: { lastBody?: string } = {};
    const server = await startFakeBridge(socketPath, { status: 200, body: 'ok', capture });
    try {
      await deliverAgentPermissionDecision(agentId, 'perm-123', 'deny');
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
      expect(capture.lastBody).toBeDefined();
      const parsed = JSON.parse(capture.lastBody!);
      expect(parsed).toEqual({
        type: 'permission_response',
        requestId: 'perm-123',
        behavior: 'deny',
      });
      expect(capture.lastHeaders?.[BRIDGE_TOKEN_HEADER]).toBe(token);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('deliverAgentPermissionDecision throws when channels are disabled', async () => {
    const agentId = 'agent-perm-disabled';
    writeAgentState(agentId, { channelsEnabled: false });
    await expect(deliverAgentPermissionDecision(agentId, 'perm-123', 'allow')).rejects.toThrow(
      /not using Claude channels/,
    );
  });

  it('deliverAgentPermissionDecision throws when bridge socket is missing', async () => {
    const agentId = 'agent-perm-no-sock';
    writeAgentState(agentId, { channelsEnabled: true });
    await expect(deliverAgentPermissionDecision(agentId, 'perm-123', 'allow')).rejects.toThrow(
      /bridge socket missing/,
    );
  });

  it('deliverAgentPermissionDecision throws when bridge token is missing', async () => {
    const agentId = 'agent-perm-no-token';
    writeAgentState(agentId, { channelsEnabled: true });
    const socketPath = join(socketDir, `agent-${agentId}.sock`);
    const server = await startFakeBridge(socketPath, { status: 200, body: 'ok' });
    try {
      await expect(deliverAgentPermissionDecision(agentId, 'perm-123', 'allow')).rejects.toThrow(
        /bridge token missing/,
      );
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
