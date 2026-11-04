/**
 * PAN-4903: a Codex conversation spawned on a Herdr host lost its first message.
 * startConversationRuntime already delivers through deliverAgentMessage, but the
 * Codex app-server socket was not bound yet, so the cascade fell through to a
 * tmux paste ("no current target" on Herdr). The fix waits for the app-server
 * in readiness; these cases run the real delivery door behind the spawn (only
 * spawn and readiness are faked) on a Herdr host.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

const home = vi.hoisted(() => {
  const dir = `/tmp/pan4903-first-${process.pid}`;
  process.env.OVERDECK_HOME = dir;
  process.env.OVERDECK_TERMINAL_BACKEND = 'herdr';
  return dir;
});

const mocks = vi.hoisted(() => ({
  findHerdrAgent: vi.fn(),
  prompt: vi.fn(),
  sendKeys: vi.fn(),
}));

vi.mock('../../terminal-backends/herdr.js', () => ({
  findHerdrAgent: mocks.findHerdrAgent,
  herdrBackend: { prompt: (...args: unknown[]) => mocks.prompt(...args) },
  readHerdrPaneText: vi.fn(async () => ''),
}));
vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  sendKeys: (...args: unknown[]) => mocks.sendKeys(...args),
}));
vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));

const { resetDeliveryBackendSelection } = await import('../../agents/delivery.js');
const { resetPromptGuard } = await import('../../terminal-backends/prompt-guard.js');
const { createConversation, getConversationByName } = await import('../conversations.js');
const { closeOverdeckDatabase } = await import('../infra.js');
const { startConversationRuntime } = await import('../conversation-runtime.js');
type RuntimeName = Parameters<typeof startConversationRuntime>[0]['harness'];

const servers: Server[] = [];

/** A stand-in Codex app-server host: the socket and token the real host writes. */
async function listenAppServer(tmuxSession: string): Promise<Array<Record<string, unknown>>> {
  const received: Array<Record<string, unknown>> = [];
  mkdirSync(join(home, 'sockets'), { recursive: true });
  mkdirSync(join(home, 'agents', tmuxSession), { recursive: true });
  writeFileSync(join(home, 'agents', tmuxSession, 'appserver-token'), 'tok-4903\n');
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push(JSON.parse(body) as Record<string, unknown>);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  servers.push(server);
  await new Promise<void>((resolveListen) => server.listen(join(home, 'sockets', `appserver-${tmuxSession}.sock`), resolveListen));
  return received;
}

function start(name: string, harness: RuntimeName, stop = vi.fn(async () => undefined)) {
  const tmuxSession = `conv-${name}`;
  const conv = createConversation({ name, tmuxSession, cwd: home, harness, workspaceId: null });
  return startConversationRuntime({
    conv,
    tmuxSession,
    cwd: home,
    claudeSessionId: `sess-${name}`,
    harness,
    launchContext: { bareContext: false, skipClaudeMd: false },
    message: 'hello from the first message',
  }, {
    spawn: vi.fn(async () => undefined),
    waitReady: vi.fn(async () => undefined),
    stop,
  });
}

beforeEach(() => {
  mkdirSync(home, { recursive: true });
  resetPromptGuard();
  resetDeliveryBackendSelection();
  mocks.findHerdrAgent.mockReset();
  mocks.prompt.mockReset();
  mocks.sendKeys.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
  closeOverdeckDatabase();
  rmSync(home, { recursive: true, force: true });
});

describe('first-message delivery on a Herdr host (PAN-4903)', () => {
  it('herdr + Codex app-server: the first message goes to the app-server socket, never Herdr or tmux', async () => {
    const received = await listenAppServer('conv-pan4903-codex');

    await start('pan4903-codex', 'codex');

    expect(received).toEqual([
      expect.objectContaining({ op: 'message', content: 'hello from the first message' }),
    ]);
    expect(mocks.findHerdrAgent).not.toHaveBeenCalled();
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.sendKeys).not.toHaveBeenCalled();
    expect(getConversationByName('pan4903-codex')?.spawnError).toBeNull();
  });

  it('a first message that fails at the terminal tier records a spawn error the dashboard shows', async () => {
    // What a Herdr host answers when delivery reaches the tmux paste.
    mocks.sendKeys.mockReturnValue(Effect.fail(new Error('no current target')));

    await start('pan4903-codex-nosock', 'codex');

    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(getConversationByName('pan4903-codex-nosock')?.spawnError).toContain('no current target');
  });

  it('herdr + claude-code: the first message goes through Herdr agent.prompt', async () => {
    mocks.findHerdrAgent.mockResolvedValue({
      paneId: 'wA:p1', terminalId: 'term_4903', workspaceId: 'wA', state: 'idle', tokens: {}, paneBound: false,
    });
    mocks.prompt.mockReturnValue(Effect.succeed({ delivered: true, messageId: 'm-4903' }));

    await start('pan4903-claude', 'claude-code');

    expect(mocks.findHerdrAgent).toHaveBeenCalledWith('conv-pan4903-claude');
    expect(mocks.prompt).toHaveBeenCalledTimes(1);
    expect(mocks.prompt.mock.calls[0]![0]).toEqual({ paneId: 'wA:p1' });
    expect(mocks.prompt.mock.calls[0]![1]).toBe('hello from the first message');
    expect(mocks.sendKeys).not.toHaveBeenCalled();
    expect(getConversationByName('pan4903-claude')?.spawnError).toBeNull();
  });
});
