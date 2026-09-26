/**
 * PAN-3668 WI-14: Prime Agent conversations launch the Prime host through the
 * launch door, resume from the recorded session file, wait on the prime-agent host
 * transport, and reap the private daemon on stop.
 */
import { Effect } from 'effect';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentPaneRef, PaneTokens, StartAgentSpec, TerminalBackend } from '../../../../src/lib/terminal-backends/types.js';

const getPrimeAgentLauncherFields = vi.hoisted(() => vi.fn());
const reapPrimeAgentDaemon = vi.hoisted(() => vi.fn(async (_agentId: string) => 'terminated' as const));
const waitForHostReady = vi.hoisted(() => vi.fn(async () => {}));
const launcherConfigs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const writePtyToken = vi.hoisted(() => vi.fn(async () => {}));
const setOption = vi.hoisted(() => vi.fn(() => Effect.succeed(undefined)));
const closeConversationPane = vi.hoisted(() => vi.fn(async () => {}));
const claudeSystemPromptFiles = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []));

vi.mock('../../../../src/lib/harness-binary.js', () => ({
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/usr/bin/claude', pathExport: "export PATH='/usr/bin':\"$PATH\"" })),
}));
vi.mock('../../../../src/lib/launcher-generator.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/launcher-generator.js')>()),
  generateLauncherScript: vi.fn((config: Record<string, unknown>) => {
    launcherConfigs.push(config);
    return '#!/bin/bash\n';
  }),
}));
vi.mock('../../../../src/lib/pty-token.js', () => ({ writePtyToken }));
vi.mock('../../../../src/lib/channels/pty-supervisor-locate.js', () => ({
  resolvePtySupervisorScriptPath: vi.fn(() => '/opt/pty-supervisor.js'),
}));
vi.mock('../../../../src/lib/config-yaml.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/config-yaml.js')>()),
  isClaudeCodeChannelsEnabled: vi.fn(() => false),
}));
vi.mock('../../../../src/lib/agents.js', () => ({
  deliverAgentMessage: vi.fn(),
  writeChannelsBridgeMcpConfig: vi.fn(),
  dismissDevChannelsDialog: vi.fn(async () => {}),
  clearReadySignal: vi.fn(),
  waitForReadySignal: vi.fn(async () => true),
  getAgentRuntimeBaseCommand: vi.fn(async () => 'claude --model claude-sonnet-4-6'),
  getProviderExportsForModel: vi.fn(async () => ''),
  getProviderAuthMode: vi.fn(async () => 'anthropic'),
}));
vi.mock('../../../../src/lib/agents/runtime-command.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/agents/runtime-command.js')>()),
  claudeSystemPromptFiles,
  waitForHostReady,
}));
vi.mock('../../../../src/lib/briefing-freshness.js', () => ({
  ensureSessionContextBriefingFile: vi.fn(async () => undefined),
}));
vi.mock('../../../../src/lib/overdeck/companion-terminal/index.js', () => ({
  closeCompanionTerminalForOwner: vi.fn(async () => {}),
}));
vi.mock('../../../../src/dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));
vi.mock('../../../../src/lib/tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/tmux.js')>()),
  setOption,
  killSession: vi.fn(() => Effect.succeed(undefined)),
  sessionExists: vi.fn(() => Effect.succeed(true)),
}));
vi.mock('../../../../src/lib/overdeck/conversation-liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/overdeck/conversation-liveness.js')>()),
  closeConversationPane,
}));

vi.mock('../../../../src/lib/prime-agent/launcher-fields.js', () => ({ getPrimeAgentLauncherFields }));
vi.mock('../../../../src/lib/prime-agent/daemon.js', () => ({ reapPrimeAgentDaemon }));

const { spawnConversationSession, stopConversationRuntime, waitForConversationRuntimeReady } = await import('../../../../src/lib/overdeck/conversation-runtime.js');

let overdeckHome: string;

function fakeBackend(): { backend: TerminalBackend; starts: StartAgentSpec[] } {
  const starts: StartAgentSpec[] = [];
  const backend = {
    name: 'herdr',
    workspaceFor: (issueId: string) => Effect.succeed({ backend: 'herdr', workspaceId: `ws-${issueId}` }),
    startAgent: (_workspace: unknown, spec: StartAgentSpec) => Effect.sync((): AgentPaneRef => {
      starts.push(spec);
      return { backend: 'herdr', workspaceId: 'ws-1', paneId: 'p-1', terminalId: 't-1', agentName: spec.name! };
    }),
  } as unknown as TerminalBackend;
  return { backend, starts };
}

function primeFields(name: string, resumeSessionFile?: string) {
  return {
    fields: {
      harness: 'prime-agent',
      primeAgent: {
        agentId: name,
        binaryPath: '/usr/bin/prime-agent',
        provider: 'openai',
        workspace: overdeckHome,
        contextFile: join(overdeckHome, 'agents', name, 'prime-agent-context.md'),
        ...(resumeSessionFile ? { resumeSessionFile } : {}),
      },
      model: 'gpt-5.4',
      unsetProviderEnv: true,
      preserveProviderEnv: ['OPENAI_API_KEY'],
    },
    paneEnv: { OPENAI_API_KEY: 'sk-conv-test' },
  };
}

function spawnPrime(name: string, backend: TerminalBackend, resume: boolean) {
  return spawnConversationSession(name, overdeckHome, '11111111-1111-4111-8111-111111111111', 'gpt-5.4', 'high', undefined, resume, 'prime-agent', false, { backend });
}

beforeEach(() => {
  overdeckHome = join(tmpdir(), `pan-conv-prime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(overdeckHome, { recursive: true });
  process.env.OVERDECK_HOME = overdeckHome;
  launcherConfigs.length = 0;
  closeConversationPane.mockClear();
  getPrimeAgentLauncherFields.mockReset();
  reapPrimeAgentDaemon.mockClear();
  waitForHostReady.mockClear();
});

afterEach(() => {
  delete process.env.OVERDECK_HOME;
  rmSync(overdeckHome, { recursive: true, force: true });
});

describe('Prime Agent conversations (PAN-3668 WI-14)', () => {
  it('launches the Prime host with the credential in the pane env', async () => {
    getPrimeAgentLauncherFields.mockImplementation(async (name: string) => primeFields(name));
    const { backend, starts } = fakeBackend();

    await spawnPrime('conv-prime-new', backend, false);

    expect(getPrimeAgentLauncherFields).toHaveBeenCalledWith('conv-prime-new', 'gpt-5.4', overdeckHome, '/usr/bin/claude', {
      effort: 'high',
      resumeSessionFile: undefined,
      withContext: true,
    });
    expect(launcherConfigs[0]).toMatchObject({
      harness: 'prime-agent',
      baseCommand: 'prime-agent-host',
      appendSystemPromptFiles: [],
      preserveProviderEnv: ['OPENAI_API_KEY'],
      primeAgent: expect.objectContaining({ agentId: 'conv-prime-new', provider: 'openai' }),
      overdeckEnv: expect.objectContaining({ agentId: 'conv-prime-new' }),
    });
    expect(launcherConfigs[0]!.extraArgs).toBeUndefined();
    expect(starts[0]!.env).toMatchObject({ OPENAI_API_KEY: 'sk-conv-test' });
    expect(starts[0]!.tokens).toMatchObject({ harness: 'prime-agent', model: 'gpt-5.4' });
  });

  it('resumes from the recorded session file and keeps the pointer for the host to verify', async () => {
    const agentDir = join(overdeckHome, 'agents', 'conv-prime-resume');
    const sessionFile = join(agentDir, 'prime-sessions', '01a0.jsonl');
    mkdirSync(join(agentDir, 'prime-sessions'), { recursive: true });
    writeFileSync(sessionFile, '{"type":"session"}\n');
    writeFileSync(join(agentDir, 'prime-agent-session-file'), `${sessionFile}\n`);
    writeFileSync(join(agentDir, 'prime-agent-session-id'), 'id-stable\n');
    getPrimeAgentLauncherFields.mockImplementation(async (name: string, _model: string, _cwd: string, _binary: string, opts: { resumeSessionFile?: string }) => primeFields(name, opts.resumeSessionFile));
    const { backend } = fakeBackend();

    await spawnPrime('conv-prime-resume', backend, true);

    expect(getPrimeAgentLauncherFields).toHaveBeenCalledWith('conv-prime-resume', 'gpt-5.4', overdeckHome, '/usr/bin/claude', expect.objectContaining({ resumeSessionFile: sessionFile }));
    expect(readFileSync(join(agentDir, 'prime-agent-session-file'), 'utf8').trim()).toBe(sessionFile);
    expect(readFileSync(join(agentDir, 'prime-agent-session-id'), 'utf8').trim()).toBe('id-stable');
  });

  it('refuses a resume whose recorded session file is gone', async () => {
    const { backend, starts } = fakeBackend();
    await expect(spawnPrime('conv-prime-lost', backend, true)).rejects.toThrow('recorded session file is missing');
    expect(starts).toHaveLength(0);
  });

  it('waits for the Prime host on the prime-agent transport with a 60 s budget', async () => {
    await waitForConversationRuntimeReady('conv-prime-ready', 'prime-agent', 'spawn');
    expect(waitForHostReady).toHaveBeenCalledWith('conv-prime-ready', 'prime-agent', 60, expect.objectContaining({ sessionExists: expect.any(Function) }));
  });

  it('closes the pane, then reaps the private daemon, when a Prime conversation stops', async () => {
    await stopConversationRuntime({ name: 'conv-prime-stop', tmuxSession: 'conv-prime-stop', harness: 'prime-agent' } as never, 'conv-prime-stop');

    expect(closeConversationPane).toHaveBeenCalledWith('conv-prime-stop');
    expect(reapPrimeAgentDaemon).toHaveBeenCalledWith('conv-prime-stop');
    expect(closeConversationPane.mock.invocationCallOrder[0]!).toBeLessThan(reapPrimeAgentDaemon.mock.invocationCallOrder[0]!);
  });

  it('never reaps for a non-Prime conversation', async () => {
    await stopConversationRuntime({ name: 'conv-claude', tmuxSession: 'conv-claude', harness: 'claude-code' } as never, 'conv-claude');
    expect(reapPrimeAgentDaemon).not.toHaveBeenCalled();
  });
});
