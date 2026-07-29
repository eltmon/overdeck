import { Effect, Stream } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server as NetServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome: string;
let stateDir: string;
let socketDir: string;

vi.mock('../../tmux.js', () => ({
  sendKeys: vi.fn(() => Effect.void),
  sessionExists: vi.fn(() => Effect.succeed(false)),
  isPaneDead: vi.fn(() => Effect.succeed(false)),
}));

vi.mock('../../paths.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    get AGENTS_DIR() {
      return stateDir;
    },
  };
});

import { AcpHost, type AcpHostRuntime } from '../../acp/host.js';
import { resolveConversationDeliveryMethod } from '../../overdeck/conversation-delivery.js';
import { deliverAgentMessage } from '../delivery.js';
import { resolveAgentDeliveryMethod } from '../messaging.js';
import { sendKeys } from '../../tmux.js';
import type { AgentState } from '../agent-state.js';

interface FakeBridgeOptions {
  status?: number;
  body?: string;
  delayMs?: number;
  capture?: { lastBody?: string };
  onRequest?: () => void;
}

function writeAgentState(agentId: string, partial: Partial<AgentState> = {}): void {
  const dir = join(stateDir, agentId);
  mkdirSync(dir, { recursive: true });
  const state: AgentState = {
    id: agentId,
    issueId: 'PAN-TEST',
    workspace: '/tmp/workspace',
    harness: 'codex',
    role: 'work',
    model: 'gpt-5.6-sol',
    status: 'running',
    startedAt: new Date().toISOString(),
    ...partial,
  };
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
}

function writeAppServerToken(agentId: string): void {
  const dir = join(stateDir, agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'appserver-token'), 'token-123\n');
}

function writeAcpToken(agentId: string, token = 'token-123'): void {
  const dir = join(stateDir, agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'acp-token'), `${token}\n`);
}

function makeAcpHostRuntime(): AcpHostRuntime {
  return {
    handleSessionUpdate: () => Effect.void,
    handleRequestPermission: () => Effect.void,
    start: () => Effect.succeed({
      sessionId: 'acp-session-1',
      modes: [],
      models: [],
      mcpServers: [],
    }),
    getEvents: () => Stream.empty,
    drainEvents: Effect.void,
    prompt: () => Effect.succeed({ stopReason: 'end_turn' as const }),
    cancel: Effect.void,
    setModel: () => Effect.void,
  };
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
        if (Buffer.byteLength(text.slice(headerEnd + 4)) < len) return;
        const body = text.slice(headerEnd + 4, headerEnd + 4 + len);
        if (opts.capture) opts.capture.lastBody = body;
        opts.onRequest?.();
        const respond = () => {
          const status = opts.status ?? 200;
          const responseBody = opts.body ?? '{}';
          sock.end(
            `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'ERR'}\r\n` +
            `Content-Length: ${Buffer.byteLength(responseBody)}\r\n` +
            `Connection: close\r\n\r\n${responseBody}`,
          );
        };
        if (opts.delayMs) setTimeout(respond, opts.delayMs);
        else respond();
      });
    });
    server.listen(socketPath, () => resolveServer(server));
  });
}

function readDeliveryLog(agentId: string): Array<Record<string, unknown>> {
  return readFileSync(join(tmpHome, 'logs', `bridge-${agentId}.log`), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('acp delivery tier', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-acp-delivery-'));
    stateDir = join(tmpHome, 'agents');
    socketDir = join(tmpHome, 'sockets');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(socketDir, { recursive: true });
    process.env.OVERDECK_HOME = tmpHome;
    vi.mocked(sendKeys).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.OVERDECK_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns acp and leaves transcript echo ownership with the host', async () => {
    const agentId = 'agent-acp-success';
    writeAgentState(agentId, { harness: 'acp' });
    const host = new AcpHost({
      agentId,
      provider: 'kimi',
      workspace: '/tmp/workspace',
      overdeckHome: tmpHome,
      runtime: makeAcpHostRuntime(),
    });
    await host.start();

    try {
      const result = await deliverAgentMessage(agentId, 'hello ACP', 'test-caller');
      expect(result).toEqual({ ok: true, path: 'acp' });
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
      const transcript = readFileSync(join(stateDir, agentId, 'acp-session.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(transcript).toContainEqual(expect.objectContaining({
        role: 'user',
        content: 'hello ACP',
        sessionId: 'acp-session-1',
        source: 'orchestrator',
      }));
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({ path: 'acp' });
    } finally {
      await host.stop();
    }
  });

  it('fails loudly when the ACP host rejects an invalid token', async () => {
    const agentId = 'agent-acp-unauthorized';
    writeAgentState(agentId, { harness: 'acp' });
    const host = new AcpHost({
      agentId,
      provider: 'kimi',
      workspace: '/tmp/workspace',
      overdeckHome: tmpHome,
      runtime: makeAcpHostRuntime(),
    });
    await host.start();
    writeAcpToken(agentId, 'wrong-token');

    try {
      await expect(
        deliverAgentMessage(agentId, 'rejected', 'test-caller'),
      ).rejects.toThrow(/ACP delivery failed.*status 401/);
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
      expect(existsSync(join(stateDir, agentId, 'acp-session.jsonl'))).toBe(false);
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({
        path: 'acp',
        reason: expect.stringContaining('status 401'),
      });
    } finally {
      await host.stop();
    }
  });

  it('fails loudly when the ACP socket is absent', async () => {
    const agentId = 'agent-acp-absent';
    writeAgentState(agentId, { harness: 'acp' });
    writeAcpToken(agentId);

    await expect(
      deliverAgentMessage(agentId, 'missing', 'test-caller'),
    ).rejects.toThrow(/ACP delivery failed.*socket-missing/);
    expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
  });

  it('fails loudly when a stale ACP socket path cannot accept connections', async () => {
    const agentId = 'agent-acp-stale';
    writeAgentState(agentId, { harness: 'acp' });
    writeAcpToken(agentId);
    writeFileSync(join(socketDir, `acp-${agentId}.sock`), 'stale');

    await expect(
      deliverAgentMessage(agentId, 'stale', 'test-caller'),
    ).rejects.toThrow(/ACP delivery failed.*socket-post-failed/);
    expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
    expect(readDeliveryLog(agentId).at(-1)).toMatchObject({
      path: 'acp',
      reason: expect.stringContaining('socket-post-failed'),
    });
  });

  it('fails loudly when the ACP host does not acknowledge queue acceptance', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const agentId = 'agent-acp-timeout';
    writeAgentState(agentId, { harness: 'acp' });
    writeAcpToken(agentId);
    let markRequestReceived!: () => void;
    const requestReceived = new Promise<void>((resolve) => {
      markRequestReceived = resolve;
    });
    const server = await startFakeBridge(join(socketDir, `acp-${agentId}.sock`), {
      delayMs: 20_000,
      onRequest: markRequestReceived,
    });

    try {
      const delivered = deliverAgentMessage(agentId, 'timeout', 'test-caller');
      const rejection = expect(delivered).rejects.toThrow(
        /ACP delivery failed.*socket POST timeout/,
      );
      await requestReceived;
      await vi.advanceTimersByTimeAsync(8_100);

      await rejection;
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects explicit terminal delivery for ACP targets', async () => {
    const agentId = 'agent-acp-explicit-tmux';
    writeAgentState(agentId, { harness: 'acp' });

    await expect(
      deliverAgentMessage(agentId, 'bypass', 'test-caller', 'tmux'),
    ).rejects.toThrow(/ACP requires authenticated host RPC delivery/);
    expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
  });

  it('forces ACP agent and conversation delivery through auto mode', () => {
    expect(resolveAgentDeliveryMethod({ harness: 'acp', deliveryMethod: 'tmux' })).toBe('auto');
    expect(resolveConversationDeliveryMethod({ harness: 'acp', deliveryMethod: 'tmux' } as never)).toBe('auto');
  });
});

describe('app-server delivery tier', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-appserver-delivery-'));
    stateDir = join(tmpHome, 'agents');
    socketDir = join(tmpHome, 'sockets');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(socketDir, { recursive: true });
    process.env.OVERDECK_HOME = tmpHome;
    vi.mocked(sendKeys).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.OVERDECK_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns app-server when the host socket accepts the message op', async () => {
    const agentId = 'agent-appserver-success';
    writeAgentState(agentId);
    writeAppServerToken(agentId);
    const capture: { lastBody?: string } = {};
    const server = await startFakeBridge(join(socketDir, `appserver-${agentId}.sock`), { capture });
    try {
      const result = await deliverAgentMessage(agentId, 'hello', 'test-caller');
      expect(result).toEqual({ ok: true, path: 'app-server' });
      expect(JSON.parse(capture.lastBody!)).toEqual({
        op: 'message',
        content: 'hello',
        model: 'gpt-5.6-sol',
        meta: { caller: 'test-caller' },
      });
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({ path: 'app-server' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('sends a 1MB payload in one request without rewriting it', async () => {
    const agentId = 'agent-appserver-large';
    const payload = 'x'.repeat(1024 * 1024);
    writeAgentState(agentId);
    writeAppServerToken(agentId);
    const capture: { lastBody?: string } = {};
    const server = await startFakeBridge(join(socketDir, `appserver-${agentId}.sock`), { capture });
    try {
      const result = await deliverAgentMessage(agentId, payload, 'large-caller');
      expect(result).toEqual({ ok: true, path: 'app-server' });
      expect(JSON.parse(capture.lastBody!).content).toBe(payload);
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('falls back to tmux when the app-server POST fails', async () => {
    const agentId = 'agent-appserver-fallback';
    writeAgentState(agentId);
    writeAppServerToken(agentId);
    const server = await startFakeBridge(join(socketDir, `appserver-${agentId}.sock`), { status: 500, body: 'nope' });
    try {
      const result = await deliverAgentMessage(agentId, 'fallback', 'fallback-caller');
      expect(result).toMatchObject({ ok: true, path: 'tmux' });
      expect(vi.mocked(sendKeys)).toHaveBeenCalledWith(agentId, 'fallback');
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({ path: 'tmux' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('falls back after the app-server 8s timeout using fake timers', async () => {
    vi.useFakeTimers();
    const agentId = 'agent-appserver-timeout';
    writeAgentState(agentId);
    writeAppServerToken(agentId);
    const server = await startFakeBridge(join(socketDir, `appserver-${agentId}.sock`), { delayMs: 20_000 });
    try {
      const delivered = deliverAgentMessage(agentId, 'timeout', 'timeout-caller');
      await vi.advanceTimersByTimeAsync(8_100);
      const result = await delivered;
      expect(result).toMatchObject({ ok: true, path: 'tmux' });
      expect(vi.mocked(sendKeys)).toHaveBeenCalledWith(agentId, 'timeout');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('keyedSupervisorFailureKind (PAN-1837)', () => {
  it('classifies connect-phase failures as definitive, never ambiguous', async () => {
    const { keyedSupervisorFailureKind } = await import('../delivery.js');
    // A stale socket file left by a crashed supervisor refuses every connection.
    expect(keyedSupervisorFailureKind(
      Object.assign(new Error('connect ECONNREFUSED /home/x/.overdeck/sockets/pty-agent-a.sock'), { code: 'ECONNREFUSED' }),
    )).toBe('connect-failed');
    expect(keyedSupervisorFailureKind(
      Object.assign(new Error('connect ENOENT /gone.sock'), { code: 'ENOENT' }),
    )).toBe('connect-failed');
    expect(keyedSupervisorFailureKind(
      Object.assign(new Error('connect EACCES /root.sock'), { code: 'EACCES' }),
    )).toBe('connect-failed');
  });

  it('classifies an answered non-2xx as status and everything else as ambiguous', async () => {
    const { keyedSupervisorFailureKind, SocketPostStatusError } = await import('../delivery.js');
    expect(keyedSupervisorFailureKind(new SocketPostStatusError(502, 'socket POST: status 502'))).toBe('status');
    expect(keyedSupervisorFailureKind(new Error('socket POST timeout'))).toBe('ambiguous');
    expect(keyedSupervisorFailureKind(
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    )).toBe('ambiguous');
    expect(keyedSupervisorFailureKind(undefined)).toBe('ambiguous');
  });
});
