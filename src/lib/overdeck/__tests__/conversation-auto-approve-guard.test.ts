/**
 * PAN-5151: spawnConversationSession must call ensureAutoApproveHookReady()
 * before it does anything else for a claude-code conversation, so a guard
 * rejection (the auto-approve hook missing under resolved mode auto) blocks
 * the launch instead of spawning an agent that prompts on every tool call.
 *
 * Mock set copied from conversation-resume-clear-chain.test.ts (same
 * spawnConversationSession collaborators), trimmed to what this file needs.
 */
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.setConfig({ testTimeout: 20_000 });
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let overdeckHome: string;
let createSessionCalls: Array<{ session: string; command: string }> = [];

let fakeHome = '';
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome };
});

const ensureAutoApproveHookReadyMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../agents/hook-readiness.js', () => ({
  ensureAutoApproveHookReady: ensureAutoApproveHookReadyMock,
}));

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
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/usr/bin/claude', pathExport: '' })),
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

describe('spawnConversationSession auto-approve guard (PAN-5151)', () => {
  beforeEach(() => {
    overdeckHome = join(tmpdir(), `pan-5151-conv-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.OVERDECK_HOME = overdeckHome;
    mkdirSync(overdeckHome, { recursive: true });
    fakeHome = overdeckHome;
    createSessionCalls = [];
    ensureAutoApproveHookReadyMock.mockClear();
    ensureAutoApproveHookReadyMock.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    rmSync(overdeckHome, { recursive: true, force: true });
    delete process.env.OVERDECK_HOME;
  });

  it('rejects with the guard message and creates no terminal session when the guard rejects (claude-code)', async () => {
    ensureAutoApproveHookReadyMock.mockRejectedValue(new Error('auto-approve hook not registered; run pan sync'));
    const { spawnConversationSession } = await import('../conversation-runtime.js');
    const cwd = join(overdeckHome, 'projects', 'fixture');
    mkdirSync(cwd, { recursive: true });

    await expect(
      spawnConversationSession('conv-guard-1', cwd, 'session-1', undefined, undefined, undefined, false, 'claude-code', false, { bareContext: true }),
    ).rejects.toThrow('auto-approve hook not registered; run pan sync');

    expect(createSessionCalls).toHaveLength(0);
  });

  it('does not call the guard for a non-claude-code harness (codex)', async () => {
    const { spawnConversationSession } = await import('../conversation-runtime.js');
    const cwd = join(overdeckHome, 'projects', 'fixture-codex');
    mkdirSync(cwd, { recursive: true });

    await spawnConversationSession('conv-guard-2', cwd, 'session-2', undefined, undefined, undefined, false, 'codex', false, { bareContext: true }).catch(() => undefined);

    expect(ensureAutoApproveHookReadyMock).not.toHaveBeenCalled();
  });
});
