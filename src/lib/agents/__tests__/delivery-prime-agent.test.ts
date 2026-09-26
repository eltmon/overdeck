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

import { resolveConversationDeliveryMethod } from '../../overdeck/conversation-delivery.js';
import { deliverAgentMessage } from '../delivery.js';
import { resolveAgentDeliveryMethod } from '../messaging.js';
import { sendKeys } from '../../tmux.js';
import type { AgentState } from '../agent-state.js';

interface CapturedRequest {
  body?: string;
  token?: string;
}

function writeAgentState(agentId: string, partial: Partial<AgentState> = {}): void {
  const dir = join(stateDir, agentId);
  mkdirSync(dir, { recursive: true });
  const state: AgentState = {
    id: agentId,
    issueId: 'PAN-TEST',
    workspace: '/tmp/workspace',
    harness: 'prime-agent',
    role: 'work',
    model: 'k3',
    status: 'running',
    startedAt: new Date().toISOString(),
    ...partial,
  };
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
}

function writeToken(agentId: string, file: string, token = 'prime-token-1'): void {
  const dir = join(stateDir, agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), `${token}\n`);
}

/** A unix-socket HTTP server that records the body and bridge token of each request. */
function startFakeHost(socketPath: string, captured: CapturedRequest): Promise<NetServer> {
  return new Promise((resolveServer) => {
    const server = createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const text = buf.toString('utf-8');
        const headerEnd = text.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const headerBlock = text.slice(0, headerEnd);
        const len = Number(/Content-Length:\s*(\d+)/i.exec(headerBlock)?.[1] ?? 0);
        if (Buffer.byteLength(text.slice(headerEnd + 4)) < len) return;
        captured.body = text.slice(headerEnd + 4, headerEnd + 4 + len);
        captured.token = /x-overdeck-bridge-token:\s*(\S+)/i.exec(headerBlock)?.[1];
        const responseBody = '{"accepted":true,"promptId":"p-1","command":"prompt"}';
        sock.end(`HTTP/1.1 202 Accepted\r\nContent-Length: ${Buffer.byteLength(responseBody)}\r\nConnection: close\r\n\r\n${responseBody}`);
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

describe('prime-agent host delivery tier (PAN-3668 WI-6)', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'pan-prime-delivery-'));
    stateDir = join(tmpHome, 'agents');
    socketDir = join(tmpHome, 'sockets');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(socketDir, { recursive: true });
    process.env.OVERDECK_HOME = tmpHome;
    vi.mocked(sendKeys).mockClear();
  });

  afterEach(() => {
    delete process.env.OVERDECK_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('posts the message to prime-agent-<id>.sock with the prime-agent-token', async () => {
    const agentId = 'agent-prime-success';
    writeAgentState(agentId);
    writeToken(agentId, 'prime-agent-token');
    const captured: CapturedRequest = {};
    const server = await startFakeHost(join(socketDir, `prime-agent-${agentId}.sock`), captured);

    try {
      await expect(deliverAgentMessage(agentId, 'hello Prime', 'test-caller')).resolves.toEqual({ ok: true, path: 'prime-agent' });
      expect(JSON.parse(captured.body ?? '{}')).toEqual({ op: 'message', content: 'hello Prime', meta: { caller: 'test-caller' } });
      expect(captured.token).toBe('prime-token-1');
      expect(readDeliveryLog(agentId).at(-1)).toMatchObject({ path: 'prime-agent', caller: 'test-caller' });
      expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('routes a conversation id with no agent state to the prime-agent socket that exists', async () => {
    const conversationId = 'conv-prime-1';
    writeToken(conversationId, 'prime-agent-token', 'conv-token');
    const captured: CapturedRequest = {};
    const server = await startFakeHost(join(socketDir, `prime-agent-${conversationId}.sock`), captured);

    try {
      await expect(deliverAgentMessage(conversationId, 'hi', 'test-caller')).resolves.toEqual({ ok: true, path: 'prime-agent' });
      expect(captured.token).toBe('conv-token');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('fails loudly, naming Prime Agent, when the host socket is absent', async () => {
    const agentId = 'agent-prime-absent';
    writeAgentState(agentId);
    writeToken(agentId, 'prime-agent-token');

    await expect(deliverAgentMessage(agentId, 'lost', 'test-caller')).rejects.toThrow(
      /MessageDeliveryFailed: Prime Agent delivery failed for agent-prime-absent \(test-caller\): socket-missing/,
    );
    expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
  });

  it('reports a missing prime-agent-token by its file name', async () => {
    const agentId = 'agent-prime-no-token';
    writeAgentState(agentId);
    writeFileSync(join(socketDir, `prime-agent-${agentId}.sock`), '');

    await expect(deliverAgentMessage(agentId, 'lost', 'test-caller')).rejects.toThrow(/Prime Agent delivery failed.*prime-agent-token-missing/);
  });

  it('rejects explicit terminal delivery and keyed delivery for Prime Agent targets', async () => {
    const agentId = 'agent-prime-explicit-tmux';
    writeAgentState(agentId);

    await expect(deliverAgentMessage(agentId, 'bypass', 'test-caller', 'tmux')).rejects.toThrow(
      /Prime Agent requires authenticated host RPC delivery/,
    );
    await expect(deliverAgentMessage(agentId, 'keyed', 'test-caller', undefined, { dedupKey: 'k-1' })).rejects.toThrow(
      /the Prime Agent tier cannot enforce a dedup key/,
    );
    expect(vi.mocked(sendKeys)).not.toHaveBeenCalled();
  });

  it('forces Prime Agent agent and conversation delivery through auto mode', () => {
    expect(resolveAgentDeliveryMethod({ harness: 'prime-agent', deliveryMethod: 'tmux' })).toBe('auto');
    expect(resolveConversationDeliveryMethod({ harness: 'prime-agent', deliveryMethod: 'tmux' } as never)).toBe('auto');
  });
});
