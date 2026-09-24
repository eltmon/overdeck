/**
 * PAN-3921 FR-2/FR-3/FR-4: conversations launch through the terminal-backend
 * launch door, stamped with the conversation's tokens, and the PTY supervisor
 * wraps the harness only on tmux.
 */
import { Effect } from 'effect';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentPaneRef, PaneTokens, StartAgentSpec, TerminalBackend } from '../../terminal-backends/types.js';

const launcherConfigs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const writePtyToken = vi.hoisted(() => vi.fn(async () => {}));
const setOption = vi.hoisted(() => vi.fn(() => Effect.succeed(undefined)));
const closeConversationPane = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../harness-binary.js', () => ({
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/usr/bin/claude', pathExport: "export PATH='/usr/bin':\"$PATH\"" })),
}));
vi.mock('../../launcher-generator.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../launcher-generator.js')>()),
  generateLauncherScript: vi.fn((config: Record<string, unknown>) => {
    launcherConfigs.push(config);
    return '#!/bin/bash\n';
  }),
}));
vi.mock('../../pty-token.js', () => ({ writePtyToken }));
vi.mock('../../channels/pty-supervisor-locate.js', () => ({
  resolvePtySupervisorScriptPath: vi.fn(() => '/opt/pty-supervisor.js'),
}));
vi.mock('../../config-yaml.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../config-yaml.js')>()),
  isClaudeCodeChannelsEnabled: vi.fn(() => false),
}));
vi.mock('../../agents.js', () => ({
  deliverAgentMessage: vi.fn(),
  writeChannelsBridgeMcpConfig: vi.fn(),
  dismissDevChannelsDialog: vi.fn(async () => {}),
  clearReadySignal: vi.fn(),
  waitForReadySignal: vi.fn(async () => true),
  getAgentRuntimeBaseCommand: vi.fn(async () => 'claude --model claude-sonnet-4-6'),
  getProviderExportsForModel: vi.fn(async () => ''),
  getProviderAuthMode: vi.fn(async () => 'anthropic'),
}));
vi.mock('../../agents/runtime-command.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents/runtime-command.js')>()),
  claudeSystemPromptFiles: vi.fn(async () => []),
}));
vi.mock('../../briefing-freshness.js', () => ({
  ensureSessionContextBriefingFile: vi.fn(async () => undefined),
}));
vi.mock('../companion-terminal/index.js', () => ({
  closeCompanionTerminalForOwner: vi.fn(async () => {}),
}));
vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));
vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  setOption,
  killSession: vi.fn(() => Effect.succeed(undefined)),
  sessionExists: vi.fn(() => Effect.succeed(true)),
}));
vi.mock('../conversation-liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-liveness.js')>()),
  closeConversationPane,
}));

const { conversationUsesSupervisor, spawnConversationSession } = await import('../conversation-runtime.js');
const { toPaneRole } = await import('../../terminal-backends/prompt-guard.js');

let overdeckHome: string;

interface FakeBackend {
  backend: TerminalBackend;
  starts: StartAgentSpec[];
}

function fakeBackend(name: 'herdr' | 'tmux'): FakeBackend {
  const starts: StartAgentSpec[] = [];
  const backend = {
    name,
    workspaceFor: (issueId: string) => Effect.succeed({ backend: name, workspaceId: `ws-${issueId}` }),
    startAgent: (_workspace: unknown, spec: StartAgentSpec) => Effect.sync((): AgentPaneRef => {
      starts.push(spec);
      if (name === 'tmux') {
        // The supervisor wait looks for the socket the supervisor would bind.
        const socketDir = join(overdeckHome, 'sockets');
        mkdirSync(socketDir, { recursive: true });
        writeFileSync(join(socketDir, `pty-${spec.name}.sock`), '', { mode: 0o600 });
      }
      return {
        backend: name,
        workspaceId: 'ws-1',
        paneId: name === 'tmux' ? spec.name! : 'p-1',
        terminalId: 't-1',
        agentName: spec.name!,
      };
    }),
  } as unknown as TerminalBackend;
  return { backend, starts };
}

function spawn(name: string, backend: TerminalBackend, opts: { issueId?: string; role?: PaneTokens['role'] } = {}) {
  return spawnConversationSession(
    name,
    overdeckHome,
    '11111111-1111-4111-8111-111111111111',
    undefined,
    'high',
    opts.issueId,
    false,
    'claude-code',
    false,
    { backend, ...(opts.role ? { role: opts.role } : {}) },
  );
}

beforeEach(() => {
  overdeckHome = join(tmpdir(), `pan-conv-launch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(overdeckHome, { recursive: true });
  process.env.OVERDECK_HOME = overdeckHome;
  launcherConfigs.length = 0;
  writePtyToken.mockClear();
  setOption.mockClear();
  closeConversationPane.mockClear();
});

afterEach(() => {
  delete process.env.OVERDECK_HOME;
  rmSync(overdeckHome, { recursive: true, force: true });
});

describe('spawnConversationSession through the launch door (PAN-3921)', () => {
  it('launches an operator conversation on Herdr as conv-<name> with role conversation and no issue token', async () => {
    const { backend, starts } = fakeBackend('herdr');
    await spawn('conv-x', backend);

    expect(starts).toHaveLength(1);
    expect(starts[0]!.name).toBe('conv-x');
    expect(starts[0]!.tokens).toEqual({ role: 'conversation', harness: 'claude-code', model: 'default' });
    expect(starts[0]!.argv).toEqual(['bash', join(overdeckHome, 'conversations', 'conv-x', 'launcher.sh')]);
  });

  it('stamps the issue token for an issue-scoped conversation', async () => {
    const { backend, starts } = fakeBackend('herdr');
    await spawn('conv-x', backend, { issueId: 'PAN-1' });

    expect(starts[0]!.tokens).toEqual({ issue: 'PAN-1', role: 'conversation', harness: 'claude-code', model: 'default' });
  });

  it('runs no PTY supervisor and sets no tmux options on Herdr, and exports the agent id for the hooks', async () => {
    const { backend } = fakeBackend('herdr');
    await spawn('conv-x', backend);

    expect(launcherConfigs[0]!['useSupervisor']).toBe(false);
    expect(launcherConfigs[0]!['keepAlive']).toBe(false);
    expect(launcherConfigs[0]!['execConversationHarness']).toBe(true);
    expect((launcherConfigs[0]!['overdeckEnv'] as { agentId?: string }).agentId).toBe('conv-x');
    expect(writePtyToken).not.toHaveBeenCalled();
    expect(setOption).not.toHaveBeenCalled();
  });

  it('keeps the PTY supervisor and both tmux session options for claude-code on tmux', async () => {
    const { backend, starts } = fakeBackend('tmux');
    await spawn('conv-x', backend);

    expect(starts).toHaveLength(1);
    expect(launcherConfigs[0]!['useSupervisor']).toBe(true);
    expect(launcherConfigs[0]!['keepAlive']).toBe(true);
    expect(launcherConfigs[0]!['execConversationHarness']).toBe(false);
    expect(writePtyToken).toHaveBeenCalledWith('conv-x');
    expect(setOption).toHaveBeenCalledWith('conv-x', 'destroy-unattached', 'off');
    expect(setOption).toHaveBeenCalledWith(expect.stringContaining('conv-x'), 'remain-on-exit', 'on');
  });

  it('closes the previous pane of the same name on either backend before launching', async () => {
    const { backend } = fakeBackend('herdr');
    await spawn('conv-x', backend);

    expect(closeConversationPane).toHaveBeenCalledWith('conv-x');
  });

  it('persists a launch role and stamps it on every later spawn of that conversation', async () => {
    const { backend, starts } = fakeBackend('herdr');
    await spawn('conv-r', backend, { issueId: 'PAN-1', role: 'review' });
    expect(readFileSync(join(overdeckHome, 'conversations', 'conv-r', 'pane-role'), 'utf-8').trim()).toBe('review');

    await spawn('conv-r', backend, { issueId: 'PAN-1' });
    expect(starts.map((start) => start.tokens.role)).toEqual(['review', 'review']);
  });

  it('passes the conversation role through the prompt guard unchanged', () => {
    expect(toPaneRole('conversation')).toBe('conversation');
  });
});

describe('conversationUsesSupervisor per harness (PAN-3921, review of #4104 F3)', () => {
  it.each([
    // harness, codex transport, tmux, herdr
    ['claude-code', undefined, true, false],
    ['kimi-code', undefined, true, true],
    ['muse', undefined, true, true],
    ['codex', 'tui', true, true],
    ['codex', 'app-server', false, false],
    ['ohmypi', undefined, false, false],
    ['acp', undefined, false, false],
  ] as const)('%s (%s): tmux %s, herdr %s', (harness, codexTransport, onTmux, onHerdr) => {
    const options = codexTransport ? { codexTransport } : {};
    expect(conversationUsesSupervisor(harness, 'tmux', options)).toBe(onTmux);
    expect(conversationUsesSupervisor(harness, 'herdr', options)).toBe(onHerdr);
  });
});
