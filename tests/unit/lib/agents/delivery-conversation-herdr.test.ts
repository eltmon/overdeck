/**
 * PAN-3921 (review of #4104, F3 and F4): message delivery to a conversation on
 * a Herdr host. A conversation has no agent state, so what the cascade knows
 * about it comes from the conversation row and the sockets its launcher bound.
 *
 * - A pane-bound conversation harness (kimi-code, muse, codex TUI) has no Herdr
 *   agent record: `agent.prompt` answers `unsupported`, and the message must
 *   reach the harness through its PTY supervisor socket, not a tmux paste into
 *   a session that does not exist.
 * - A host-backed conversation (codex app-server, ACP/opencode) is never
 *   prompted through Herdr, even when Herdr detected the process under the
 *   host: `agent.prompt` would type into the host's stdin (PAN-3705).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

const home = vi.hoisted(() => {
  const dir = `/tmp/pan3921-deliv-${process.pid}`;
  process.env.OVERDECK_HOME = dir;
  process.env.OVERDECK_TERMINAL_BACKEND = 'herdr';
  return dir;
});

const mocks = vi.hoisted(() => ({
  findHerdrAgent: vi.fn(),
  prompt: vi.fn(),
  sendKeys: vi.fn(),
  conversationHarness: { value: 'claude-code' as string },
}));

vi.mock('../../../../src/lib/terminal-backends/herdr.js', () => ({
  findHerdrAgent: mocks.findHerdrAgent,
  herdrBackend: { prompt: (...args: unknown[]) => mocks.prompt(...args) },
}));

vi.mock('../../../../src/lib/overdeck/conversations.js', () => ({
  getConversationByTmuxSession: (tmuxSession: string) => ({ tmuxSession, harness: mocks.conversationHarness.value }),
}));

vi.mock('../../../../src/lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/tmux.js')>();
  return {
    ...actual,
    sessionExists: () => Effect.succeed(true),
    isPaneDead: () => Effect.succeed(false),
    sendKeys: (agentId: string, message: string) => {
      mocks.sendKeys(agentId, message);
      return Effect.succeed(undefined);
    },
  };
});

vi.mock('../../../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: () => ({ config: { codex: { transport: 'app-server' } } }),
  };
});

const { deliverAgentMessage, resetDeliveryBackendSelection } =
  await import('../../../../src/lib/agents/delivery.js');
const { resetPromptGuard } = await import('../../../../src/lib/terminal-backends/prompt-guard.js');
const { unsupported } = await import('../../../../src/lib/terminal-backends/types.js');

const supervisorBodies: string[] = [];
let supervisor: Server | null = null;

async function startSupervisor(agentId: string): Promise<void> {
  mkdirSync(join(home, 'sockets'), { recursive: true });
  mkdirSync(join(home, 'agents', agentId), { recursive: true });
  writeFileSync(join(home, 'agents', agentId, 'pty-token'), 'test-token\n', { mode: 0o600 });
  supervisor = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += String(chunk); });
    req.on('end', () => {
      supervisorBodies.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => supervisor!.listen(join(home, 'sockets', `pty-${agentId}.sock`), resolve));
}

beforeAll(() => {
  mkdirSync(home, { recursive: true });
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  resetPromptGuard();
  resetDeliveryBackendSelection();
  mocks.findHerdrAgent.mockReset();
  mocks.prompt.mockReset();
  mocks.sendKeys.mockReset();
  supervisorBodies.length = 0;
});

afterEach(async () => {
  if (supervisor) await new Promise<void>((resolve) => supervisor!.close(() => resolve()));
  supervisor = null;
  rmSync(join(home, 'sockets'), { recursive: true, force: true });
});

describe('pane-bound conversation harnesses on Herdr deliver through the PTY supervisor (F3)', () => {
  it.each(['kimi-code', 'muse', 'codex'] as const)('%s conversation', async (harness) => {
    mocks.conversationHarness.value = harness;
    const agentId = `conv-${harness}-x`;
    await startSupervisor(agentId);
    // Pane-bound: Herdr finds the pane by its agentId token but holds no agent record to prompt.
    mocks.findHerdrAgent.mockResolvedValue({
      paneId: 'wC:p1', terminalId: 't', workspaceId: 'wC', state: 'unknown', tokens: {}, paneBound: true,
    });
    mocks.prompt.mockReturnValue(Effect.succeed(unsupported('herdr has no detected agent in pane wC:p1')));

    const result = await deliverAgentMessage(agentId, 'hello there', 'test', 'auto', { messageId: `m-${harness}` });

    expect(result).toMatchObject({ ok: true, path: 'supervisor' });
    expect(supervisorBodies).toHaveLength(1);
    expect(JSON.parse(supervisorBodies[0]!).content).toBe('hello there');
    expect(mocks.sendKeys).not.toHaveBeenCalled();
  });
});

describe('host-backed conversations are never prompted through Herdr (F4)', () => {
  it.each(['codex', 'acp', 'opencode'] as const)('%s conversation', async (harness) => {
    mocks.conversationHarness.value = harness;
    // Herdr detected the harness process under the host and would accept a prompt.
    mocks.findHerdrAgent.mockResolvedValue({
      paneId: 'wC:p2', terminalId: 't', workspaceId: 'wC', state: 'idle', tokens: {}, paneBound: false,
    });
    mocks.prompt.mockReturnValue(Effect.succeed({ kind: 'delivered', messageId: 'm' }));

    await deliverAgentMessage(`conv-${harness}-y`, 'line one\nline two', 'test', 'auto', { messageId: `h-${harness}` })
      .catch(() => undefined);

    expect(mocks.findHerdrAgent).not.toHaveBeenCalled();
    expect(mocks.prompt).not.toHaveBeenCalled();
  });

  it('a claude-code conversation is still prompted through Herdr', async () => {
    mocks.conversationHarness.value = 'claude-code';
    mocks.findHerdrAgent.mockResolvedValue({
      paneId: 'wC:p3', terminalId: 't', workspaceId: 'wC', state: 'idle', tokens: {}, paneBound: false,
    });
    mocks.prompt.mockReturnValue(Effect.succeed({ kind: 'delivered', messageId: 'm' }));

    const result = await deliverAgentMessage('conv-claude-z', 'hi', 'test', 'auto', { messageId: 'c-1' });

    expect(result).toMatchObject({ ok: true, path: 'herdr' });
  });
});
