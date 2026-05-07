import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, Server as NetServer } from 'node:net';

let tmpHome: string;
let stateDir: string;
let socketDir: string;

vi.mock('../tmux.js', () => ({
  createSession: vi.fn(),
  createSessionAsync: vi.fn(),
  killSession: vi.fn(),
  killSessionAsync: vi.fn(),
  sendKeysAsync: vi.fn(async () => {}),
  sessionExists: vi.fn(),
  sessionExistsAsync: vi.fn(),
  getAgentSessions: vi.fn(),
  getAgentSessionsAsync: vi.fn(),
  capturePane: vi.fn(),
  capturePaneAsync: vi.fn(),
  listPaneValues: vi.fn(),
  listPaneValuesAsync: vi.fn(),
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

import { deliverAgentMessage, deliverAgentPermissionDecision, type AgentState } from '../agents.js';
import { sendKeysAsync } from '../tmux.js';

function writeAgentState(agentId: string, partial: Partial<AgentState>): void {
  const dir = join(stateDir, agentId);
  mkdirSync(dir, { recursive: true });
  const state: AgentState = {
    id: agentId,
    issueId: 'PAN-TEST',
    workspace: '/tmp/x',
    runtime: 'claude-code',
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
  capture?: { lastBody?: string };
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
        if (opts.capture) opts.capture.lastBody = body;
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
    vi.mocked(sendKeysAsync).mockClear();
  });

  afterEach(() => {
    delete process.env.PANOPTICON_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('deliverAgentMessage flag-off: delegates to sendKeysAsync exactly once with no socket attempt', async () => {
    const agentId = 'agent-flag-off';
    writeAgentState(agentId, { channelsEnabled: false });
    await deliverAgentMessage(agentId, 'hello', 'test');
    expect(vi.mocked(sendKeysAsync)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendKeysAsync)).toHaveBeenCalledWith(agentId, 'hello');
  });

  it('state-file missing: delegates to sendKeysAsync (treat as flag-off)', async () => {
    await deliverAgentMessage('agent-no-state', 'hello', 'test');
    expect(vi.mocked(sendKeysAsync)).toHaveBeenCalledTimes(1);
  });

  it('flag-on, socket-success: posts to bridge and does NOT call sendKeysAsync', async () => {
    const agentId = 'agent-channels';
    writeAgentState(agentId, { channelsEnabled: true });
    const socketPath = join(socketDir, `agent-${agentId}.sock`);
    const capture: { lastBody?: string } = {};
    const server = await startFakeBridge(socketPath, { status: 200, body: 'ok', capture });
    try {
      await deliverAgentMessage(agentId, 'channel hi', 'caller-x');
      expect(vi.mocked(sendKeysAsync)).not.toHaveBeenCalled();
      expect(capture.lastBody).toBeDefined();
      const parsed = JSON.parse(capture.lastBody!);
      expect(parsed).toMatchObject({ content: 'channel hi', meta: { caller: 'caller-x' } });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('flag-on, socket-ENOENT: falls back to sendKeysAsync', async () => {
    const agentId = 'agent-no-sock';
    writeAgentState(agentId, { channelsEnabled: true });
    // Do NOT start a bridge — socket file does not exist.
    await deliverAgentMessage(agentId, 'fallback hi', 'caller-y');
    expect(vi.mocked(sendKeysAsync)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendKeysAsync)).toHaveBeenCalledWith(agentId, 'fallback hi');
  });

  it('flag-on, socket-timeout: falls back to sendKeysAsync', async () => {
    const agentId = 'agent-timeout';
    writeAgentState(agentId, { channelsEnabled: true });
    const socketPath = join(socketDir, `agent-${agentId}.sock`);
    // Bridge that delays its response longer than the deliver timeout.
    const server = await startFakeBridge(socketPath, { status: 200, body: 'ok', delayMs: 3500 });
    try {
      await deliverAgentMessage(agentId, 'timeout hi', 'caller-z');
      expect(vi.mocked(sendKeysAsync)).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 10_000);

  it('deliverAgentPermissionDecision posts permission_response payload to bridge', async () => {
    const agentId = 'agent-perm-ok';
    writeAgentState(agentId, { channelsEnabled: true });
    const socketPath = join(socketDir, `agent-${agentId}.sock`);
    const capture: { lastBody?: string } = {};
    const server = await startFakeBridge(socketPath, { status: 200, body: 'ok', capture });
    try {
      await deliverAgentPermissionDecision(agentId, 'perm-123', 'deny');
      expect(vi.mocked(sendKeysAsync)).not.toHaveBeenCalled();
      expect(capture.lastBody).toBeDefined();
      const parsed = JSON.parse(capture.lastBody!);
      expect(parsed).toEqual({
        type: 'permission_response',
        requestId: 'perm-123',
        behavior: 'deny',
      });
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
});
