/**
 * PAN-2652 W10: native /compact records the compacted fork and restarts the
 * runtime on it (--resume <fork>), so the live process and the Conversation
 * view stay on the same session.
 *
 * Mock set copied from src/lib/overdeck/__tests__/conversation-resume-clear-chain.test.ts.
 */
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.setConfig({ testTimeout: 20_000 });
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FORK_ID = 'ffffffff-0000-4000-8000-000000002652';
const ORIGINAL_ID = 'aaaaaaaa-0000-4000-8000-000000002652';

let overdeckHome: string;
let resolvedHarnessBinary: string | null = '/usr/bin/claude';
let createSessionCalls: Array<{ session: string; command: string }> = [];

// handleConversationResume validates conv.cwd is under the real homedir()
// (validateCwdContainment). Point homedir() at this run's temp root so a cwd
// nested under it passes containment without touching the real home.
let fakeHome = '';
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome };
});

vi.mock('../../agents.js', () => ({
  deliverAgentMessage: vi.fn(async () => ({ ok: true, path: 'supervisor' })),
  writeChannelsBridgeMcpConfig: vi.fn().mockResolvedValue(undefined),
  dismissDevChannelsDialog: vi.fn().mockResolvedValue(undefined),
  clearReadySignal: vi.fn(),
  waitForReadySignal: vi.fn().mockResolvedValue(true),
  getAgentRuntimeBaseCommand: vi.fn().mockResolvedValue('claude --model claude-sonnet-4-6'),
  getProviderExportsForModel: vi.fn().mockResolvedValue(''),
  getProviderEnvForModel: vi.fn().mockResolvedValue({}),
  getProviderAuthMode: vi.fn().mockResolvedValue('anthropic'),
}));

vi.mock('../../harness-binary.js', () => ({
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: resolvedHarnessBinary, pathExport: '' })),
}));

vi.mock('../../config-yaml.js', () => ({
  isClaudeCodeChannelsEnabled: vi.fn(() => false),
  loadConfigSync: vi.fn(() => ({ config: { conversations: {}, codex: { permissionMode: 'workspace' } } })),
}));

vi.mock('../../providers.js', () => ({
  UnknownModelError: class UnknownModelError extends Error {},
  getProviderForModel: vi.fn(() => ({ name: 'anthropic' })),
  piProviderForModel: vi.fn(() => 'anthropic'),
  qualifyPiModel: vi.fn((m: string) => m),
  resolveKimiCodeModelAlias: vi.fn((m: string) => m),
}));

vi.mock('../../prime-agent/provider-map.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../prime-agent/provider-map.js')>()),
  resolvePrimeAgentCredential: vi.fn(async () => ({ provider: 'openai', envExports: {} })),
}));

vi.mock('../../harness-resolve.js', () => ({ resolveHarness: vi.fn(async () => 'claude-code') }));

vi.mock('../../workspace-manager.js', () => ({}));

vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));

vi.mock('../../tmux.js', () => ({
  listSessionsSync: () => [],
  listSessions: () => Effect.succeed([]),
  listPaneValuesSync: () => [],
  listPaneValues: async () => [],
  sendRawKeystroke: vi.fn(),
  MessageDeliveryFailed: class MessageDeliveryFailed extends Error {},
  capturePane: vi.fn(async () => ''),
  sessionExists: vi.fn(() => Effect.succeed(true)),
  killSession: vi.fn(() => Effect.succeed(undefined)),
  createSession: vi.fn((session: string, _cwd: string, command: string) => Effect.sync(() => {
    createSessionCalls.push({ session, command });
    // claude-code on the tmux backend launches through the PTY supervisor;
    // spawnConversationSession waits (real timers, up to 30s) for this
    // socket to appear before returning, so the mock must write it.
    const socketDir = join(overdeckHome, 'sockets');
    mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    const socketPath = join(socketDir, `pty-${session}.sock`);
    writeFileSync(socketPath, '');
    chmodSync(socketPath, 0o600);
  })),
  setOption: vi.fn(() => Effect.succeed(undefined)),
  exactPaneTarget: vi.fn((name: string) => `=${name}:`),
  waitForClaudePrompt: vi.fn(() => Effect.succeed(Promise.resolve(true))),
  listSessionNames: vi.fn(() => Effect.succeed([])),
  findManagedServerPid: vi.fn(() => undefined),
  isHarnessProcessAlive: vi.fn(async () => false),
}));

vi.mock('../companion-terminal/index.js', () => ({ closeCompanionTerminalForOwner: vi.fn().mockResolvedValue(undefined) }));

// The real liveness oracle treats an unreachable Herdr socket as
// "indeterminate" and reads that as alive (rollback safety) — which would
// short-circuit resume into the reattach branch in this sandboxed test env.
// Force the one check this suite needs deterministic: the harness is not
// alive, so resume must take the respawn path.
vi.mock('../conversation-liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-liveness.js')>()),
  conversationHarnessAlive: vi.fn(async () => false),
  closeConversationPane: vi.fn(async () => undefined),
}));

vi.mock('../../../dashboard/server/services/conversation-compaction.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dashboard/server/services/conversation-compaction.js')>()),
  compactConversationNative: vi.fn(async () => ({ forkedSessionId: FORK_ID, model: 'claude-sonnet-4-6' })),
}));

vi.mock('../../runtimes/kimi-code.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../runtimes/kimi-code.js')>();
  return { ...actual, waitForNewKimiSessionAsync: vi.fn().mockImplementation(actual.waitForNewKimiSessionAsync) };
});

vi.mock('../../agents/runtime-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents/runtime-command.js')>();
  return { ...actual, waitForPromptReady: vi.fn(async (...args: Parameters<typeof actual.waitForPromptReady>) =>
    args[1] === 'muse' ? false : actual.waitForPromptReady(...args)) };
});

function conversationDir(session: string): string {
  return join(overdeckHome, 'conversations', session);
}

function ensurePtySupervisorBuildArtifact(): void {
  const supervisorDistPath = join(process.cwd(), 'dist', 'pty-supervisor.js');
  if (existsSync(supervisorDistPath)) return;
  mkdirSync(join(process.cwd(), 'dist'), { recursive: true });
  writeFileSync(supervisorDistPath, '#!/usr/bin/env node\n');
}

function launcherFor(session: string): string {
  return readFileSync(join(conversationDir(session), 'launcher.sh'), 'utf8');
}

function decodeJsonResponse(response: { body: unknown }): Record<string, unknown> {
  const payload = response.body as { body?: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

async function resetConversationDb(): Promise<void> {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
}

describe('native /compact restarts the runtime on the compacted fork (PAN-2652 W10)', () => {
  beforeEach(() => {
    ensurePtySupervisorBuildArtifact();
    overdeckHome = join(tmpdir(), `pan-conv-native-compact-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.OVERDECK_HOME = overdeckHome;
    mkdirSync(overdeckHome, { recursive: true });
    fakeHome = overdeckHome;
    resolvedHarnessBinary = '/usr/bin/claude';
    createSessionCalls = [];
  });

  afterEach(async () => {
    await resetConversationDb();
    rmSync(overdeckHome, { recursive: true, force: true });
    delete process.env.OVERDECK_HOME;
  });

  it('ac1/ac2: stops the runtime, respawns with --resume <fork>, and reports restarted', async () => {
    const { createConversation, getConversationByName } = await import('../conversations.js');
    const { handleConversationMessage } = await import('../conversation-message.js');
    const { closeConversationPane } = await import('../conversation-liveness.js');

    const cwd = join(overdeckHome, 'projects', 'compact');
    mkdirSync(cwd, { recursive: true });
    const sessionFile = join(overdeckHome, 'compact-session.jsonl');
    writeFileSync(sessionFile, '');
    createConversation({ name: 'native-compact', tmuxSession: 'conv-native-compact', cwd, harness: 'claude-code', claudeSessionId: ORIGINAL_ID });

    const response = await handleConversationMessage('native-compact', { message: '/compact' }, {
      resolveSessionFile: async () => sessionFile,
      generateAiTitle: async () => {},
      shouldInterceptManualCompact: () => true,
    });
    const payload = decodeJsonResponse(response as unknown as { body: unknown });

    expect(getConversationByName('native-compact')?.claudeSessionId).toBe(FORK_ID);
    expect(vi.mocked(closeConversationPane)).toHaveBeenCalledWith('conv-native-compact');
    expect(createSessionCalls).toHaveLength(1);
    const launcher = launcherFor('conv-native-compact');
    expect(launcher).toContain(`--resume '${FORK_ID}'`);
    expect(launcher).not.toContain(ORIGINAL_ID);
    expect(payload).toMatchObject({ ok: true, compacted: true, mode: 'overdeck-native', restarted: true });
  });

  // CodeRabbit on #5060: a failed restart after compaction is an error, not a success.
  it('reports a failed restart as an error while noting compaction completed', async () => {
    const { createConversation, getConversationByName } = await import('../conversations.js');
    const { handleConversationMessage } = await import('../conversation-message.js');

    // A cwd outside the (mocked) home fails resume's containment check before any spawn.
    const cwd = join(tmpdir(), `pan-2652-outside-home-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const sessionFile = join(overdeckHome, 'compact-fail-session.jsonl');
    writeFileSync(sessionFile, '');
    createConversation({ name: 'native-compact-fail', tmuxSession: 'conv-native-compact-fail', cwd, harness: 'claude-code', claudeSessionId: ORIGINAL_ID });

    try {
      const response = await handleConversationMessage('native-compact-fail', { message: '/compact' }, {
        resolveSessionFile: async () => sessionFile,
        generateAiTitle: async () => {},
        shouldInterceptManualCompact: () => true,
      });
      const payload = decodeJsonResponse(response as unknown as { body: unknown });

      expect((response as unknown as { status?: number }).status).toBe(502);
      expect(payload).toMatchObject({ ok: false, compacted: true, restarted: false, mode: 'overdeck-native' });
      expect(getConversationByName('native-compact-fail')?.claudeSessionId).toBe(FORK_ID);
      expect(createSessionCalls).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
