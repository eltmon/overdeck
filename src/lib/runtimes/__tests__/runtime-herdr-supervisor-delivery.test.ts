/**
 * PAN-3936: a kimi-code or muse agent that Cloister rotates or respawns on a
 * Herdr host lands on Herdr pane-bound, and its messages reach it through the
 * PTY supervisor socket.
 *
 * Herdr holds no agent record for a pane-bound harness, so `agent.prompt`
 * answers `unsupported`, and tmux `send-keys` cannot reach a Herdr pane. The
 * runtime therefore keeps the supervisor on Herdr (the PAN-3921 rule for
 * conversations). This runs the runtime's real `spawnAgent` on a recording
 * fake Herdr backend and the real `deliverAgentMessage` cascade against a
 * stand-in supervisor listening on `sockets/pty-<id>.sock`, which checks the
 * token the runtime wrote.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The home must be set before delivery.ts and the agent-state readers load. It
// stays short: a Unix socket path is capped near 108 bytes.
const home = vi.hoisted(() => {
  const dir = `/tmp/pan3936-${process.pid}`;
  process.env.OVERDECK_HOME = dir;
  process.env.OVERDECK_TERMINAL_BACKEND = 'herdr';
  return dir;
});

const mocks = vi.hoisted(() => ({
  findHerdrAgent: vi.fn(),
  herdrPrompt: vi.fn(),
  sendKeys: vi.fn(),
}));

vi.mock('../../terminal-backends/herdr.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../terminal-backends/herdr.js')>();
  return {
    ...actual,
    findHerdrAgent: mocks.findHerdrAgent,
    herdrBackend: { prompt: (...args: unknown[]) => mocks.herdrPrompt(...args) },
  };
});

vi.mock('../../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tmux.js')>();
  return {
    ...actual,
    sessionExists: () => Effect.succeed(false),
    isPaneDead: () => Effect.succeed(false),
    sendKeys: (agentId: string, message: string) => {
      mocks.sendKeys(agentId, message);
      return Effect.succeed(undefined);
    },
  };
});

vi.mock('../tmux-cli.js', () => ({
  tmuxCreateSession: vi.fn(async () => undefined),
  tmuxSessionExists: vi.fn(async () => false),
  tmuxKillSession: vi.fn(async () => undefined),
}));

vi.mock('../../harness-binary.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../harness-binary.js')>();
  return { ...actual, prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/usr/bin/muse', pathExport: '' })) };
});

vi.mock('../../agents/runtime-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents/runtime-command.js')>();
  return {
    ...actual,
    waitForPromptReady: vi.fn(async () => true),
    claudeSystemPromptFiles: vi.fn(async () => []),
  };
});

vi.mock('../muse-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../muse-context.js')>();
  return { ...actual, materializeMuseContext: vi.fn(async () => '/tmp/fake-muse-context.md') };
});

const { KimiCodeRuntimeSync } = await import('../kimi-code.js');
const { MuseRuntimeSync } = await import('../muse.js');
const { museDataHome } = await import('../storage/muse.js');
const { kimiSessionsRoot } = await import('../storage/kimi-code.js');
const { resetDeliveryBackendSelection } = await import('../../agents/delivery.js');
const { resetPromptGuard } = await import('../../terminal-backends/prompt-guard.js');
const { PTY_TOKEN_HEADER } = await import('../../pty-token.js');
const { unsupported } = await import('../../terminal-backends/types.js');
const { fakeTerminalBackend } = await import('../../../../tests/helpers/fake-terminal-backend.js');

interface SupervisorPost {
  readonly token: string | undefined;
  readonly content: string;
}

const servers: Server[] = [];

/** A stand-in PTY supervisor: accepts a POST only with the agent's current pty-token. */
async function listenAsSupervisor(agentId: string, posts: SupervisorPost[]): Promise<void> {
  const socketDir = join(home, 'sockets');
  mkdirSync(socketDir, { recursive: true });
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const token = req.headers[PTY_TOKEN_HEADER] as string | undefined;
      const expected = readFileSync(join(home, 'agents', agentId, 'pty-token'), 'utf8').trim();
      if (token !== expected) {
        res.writeHead(401).end('bad token');
        return;
      }
      posts.push({ token, content: (JSON.parse(body) as { content: string }).content });
      res.writeHead(200).end('{}');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(join(socketDir, `pty-${agentId}.sock`), resolve));
}

function writeAgentState(agentId: string, state: Record<string, unknown>): void {
  const dir = join(home, 'agents', agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ id: agentId, startedAt: new Date().toISOString(), ...state }));
}

beforeEach(() => {
  mkdirSync(home, { recursive: true });
  resetPromptGuard();
  resetDeliveryBackendSelection();
  mocks.findHerdrAgent.mockReset();
  mocks.herdrPrompt.mockReset();
  mocks.sendKeys.mockReset();
  // The pane is pane-bound: found by its agentId token, no Herdr agent record.
  mocks.findHerdrAgent.mockResolvedValue({
    paneId: 'w1:p9', terminalId: 't9', workspaceId: 'w1', state: 'unknown', tokens: {}, paneBound: true,
  });
  mocks.herdrPrompt.mockReturnValue(Effect.succeed(unsupported('herdr has no detected agent in pane w1:p9')));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  rmSync(home, { recursive: true, force: true });
});

describe('runtime spawns on a Herdr host deliver through the PTY supervisor socket (PAN-3936)', () => {
  it('kimi-code: the initial context reaches the agent through the supervisor, not agent.prompt or send-keys', async () => {
    const agentId = 'agent-pan-3936-review';
    const workspace = join(home, 'workspace-kimi');
    const kimiHome = mkdtempSync(join(home, 'kimi-'));
    writeAgentState(agentId, { issueId: 'PAN-3936', role: 'review', harness: 'kimi-code', model: 'k3', workspace });
    const posts: SupervisorPost[] = [];
    const backend = fakeTerminalBackend('herdr');
    const start = backend.startAgent.bind(backend);
    Object.assign(backend, {
      // The harness starts: kimi writes its session, the supervisor binds its socket.
      startAgent: (...args: Parameters<typeof start>) => Effect.promise(async () => {
        mkdirSync(join(kimiSessionsRoot(kimiHome, workspace), 'session_herdr', 'agents', 'main'), { recursive: true });
        await listenAsSupervisor(agentId, posts);
      }).pipe(Effect.flatMap(() => start(...args))),
    });

    const runtime = new KimiCodeRuntimeSync({
      kimiHome,
      prepareLaunch: async () => ({ binaryPath: '/opt/kimi/bin/kimi', pathExport: '' }),
      resolveSupervisorScriptPath: () => '/dist/pty-supervisor.js',
      resolveBackend: async () => backend,
    });
    const agent = await runtime.spawnAgent({ agentId, workspace, model: 'k3', runtime: 'kimi-code', prompt: 'review PAN-3936' });

    expect(agent.sessionId).toBe('session_herdr');
    expect(backend.starts).toHaveLength(1);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.content).toContain('review PAN-3936');
    expect(mocks.sendKeys).not.toHaveBeenCalled();
  });

  it('muse: the prompt reaches the agent through the supervisor, not agent.prompt or send-keys', async () => {
    const agentId = 'agent-pan-3936-test';
    writeAgentState(agentId, { issueId: 'PAN-3936', role: 'test', harness: 'muse', model: 'muse-spark-1.3', workspace: '/tmp/muse-ws' });
    const sessionDir = join(museDataHome(agentId, join(home, 'agents')), 'muse', 'sessions', '2026', '09', '24', '01-herdr');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.jsonl'), '{}\n');
    const posts: SupervisorPost[] = [];
    const backend = fakeTerminalBackend('herdr');
    const start = backend.startAgent.bind(backend);
    Object.assign(backend, {
      startAgent: (...args: Parameters<typeof start>) =>
        Effect.promise(() => listenAsSupervisor(agentId, posts)).pipe(Effect.flatMap(() => start(...args))),
    });
    // The already-running guard asks Herdr first: nothing there yet.
    mocks.findHerdrAgent.mockResolvedValueOnce(null);

    const agent = await new MuseRuntimeSync({ resolveBackend: async () => backend }).spawnAgent({
      agentId, workspace: '/tmp/muse-ws', runtime: 'muse', model: 'muse-spark-1.3', prompt: 'run the tests',
    });

    expect(agent.sessionId).toBe('01-herdr');
    expect(posts).toEqual([expect.objectContaining({ content: 'run the tests' })]);
    expect(mocks.sendKeys).not.toHaveBeenCalled();
  });
});
