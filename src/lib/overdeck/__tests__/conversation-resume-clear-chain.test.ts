/**
 * PAN-4485: resume on a superseded /clear row resumes the chain head —
 * the superseded row is never respawned into the shared session.
 *
 * Mock set copied from
 * src/dashboard/server/routes/__tests__/conversations-supervisor.test.ts
 * (same spawnConversationSession collaborators), adjusted for this file's
 * location under src/lib/overdeck/__tests__/.
 */
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.setConfig({ testTimeout: 20_000 });
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

describe('handleConversationResume clear-chain redirect', () => {
  beforeEach(() => {
    ensurePtySupervisorBuildArtifact();
    overdeckHome = join(tmpdir(), `pan-conv-resume-clear-chain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it('resumes the chain head once, using its claudeSessionId, and marks only the head active', async () => {
    const { createConversation, getConversationByName, markConversationEnded, setClearedToConvId } = await import('../conversations.js');
    const { handleConversationResume } = await import('../conversation-runtime.js');

    const cwd = join(overdeckHome, 'projects', 'fixture');
    mkdirSync(cwd, { recursive: true });
    const sessionFile = join(overdeckHome, 'sibling-session.jsonl');
    writeFileSync(sessionFile, '');

    const parent = createConversation({ name: 'resume-parent', tmuxSession: 'conv-resume-p', cwd, harness: 'claude-code', claudeSessionId: 'parent-session' });
    const sibling = createConversation({ name: 'resume-parent-post-clear', tmuxSession: 'conv-resume-p', cwd, harness: 'claude-code', claudeSessionId: 'sibling-session' });
    setClearedToConvId(parent.name, sibling.id);
    // Realistic pre-state: the list/stop paths (WI-2/WI-4) already left the
    // superseded parent ended before an operator resumes it by name.
    markConversationEnded(parent.name);
    markConversationEnded(sibling.name);
    const parentEndedAtBefore = getConversationByName(parent.name)?.endedAt;

    const response = await handleConversationResume(parent.name, {}, { resolveSessionFile: async () => sessionFile });
    const payload = decodeJsonResponse(response as unknown as { body: unknown });

    expect(createSessionCalls).toHaveLength(1);
    expect(createSessionCalls[0]?.session).toBe('conv-resume-p');
    const launcher = launcherFor('conv-resume-p');
    expect(launcher).toContain("--resume 'sibling-session'");
    expect(launcher).not.toContain('parent-session');
    expect(payload['name']).toBe(sibling.name);
    expect(payload['status']).toBe('active');
    expect(payload['redirectedFrom']).toBe(parent.name);
    // handleConversationResume never writes the requested (superseded) row
    // when redirecting — the parent's own ended_at is untouched.
    expect(getConversationByName(parent.name)?.endedAt).toBe(parentEndedAtBefore);
  });

  it('returns 409 conversation-cleared for a broken chain and spawns nothing', async () => {
    const { createConversation, setClearedToConvId, archiveConversation } = await import('../conversations.js');
    const { handleConversationResume } = await import('../conversation-runtime.js');

    const cwd = join(overdeckHome, 'projects', 'fixture2');
    mkdirSync(cwd, { recursive: true });
    const parent = createConversation({ name: 'resume-parent-2', tmuxSession: 'conv-resume-p2', cwd, harness: 'claude-code', claudeSessionId: 'parent-session-2' });
    const sibling = createConversation({ name: 'resume-parent-2-post-clear', tmuxSession: 'conv-resume-p2', cwd, harness: 'claude-code', claudeSessionId: 'sibling-session-2' });
    setClearedToConvId(parent.name, sibling.id);
    archiveConversation(sibling.name);

    const response = await handleConversationResume(parent.name, {}, { resolveSessionFile: async () => null });
    const payload = decodeJsonResponse(response as unknown as { body: unknown });

    expect((response as unknown as { status?: number }).status).toBe(409);
    expect(payload['code']).toBe('conversation-cleared');
    expect(createSessionCalls).toHaveLength(0);
  });
});
