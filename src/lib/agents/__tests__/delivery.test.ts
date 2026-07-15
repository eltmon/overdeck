import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server as NetServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

import { deliverAgentMessage } from '../delivery.js';
import { sendKeys } from '../../tmux.js';
import type { AgentState } from '../agent-state.js';

interface FakeBridgeOptions {
  status?: number;
  body?: string;
  delayMs?: number;
  capture?: { lastBody?: string };
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
