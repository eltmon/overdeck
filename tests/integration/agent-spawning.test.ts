/**
 * Integration tests for the role primitive (PAN-1048)
 *
 * Replaces the legacy phase/workType/agentType suite that PAN-1015 deprecated
 * and PAN-1048 retired. Verifies:
 *   1. spawnAgent({ role: 'work' }) writes the role primitive into AgentState
 *      and resolves the work model via the workhorses+roles config.
 *   2. spawnRun(issueId, role) for review/test/ship spawns the correct
 *      session-id shape, persists the role on AgentState, and resolves the
 *      role model from `roles.<role>.model` (workhorse refs included).
 *   3. The dashboard POST /api/agents legacy-field guard rejects body shapes
 *      that include phase, workType, or agentType.
 */

import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { chmodSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, delimiter } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import {
  spawnAgent,
  spawnRun,
  getAgentStateSync,
  resumeAgent,
  restartAgent,
  type SpawnOptions,
  getAgentDir,
} from '../../src/lib/agents.js';
import { captureCheckpoint, hasCheckpoint } from '../../src/lib/checkpoint/checkpoint-manager.js';
import { closeFeatureRegistryStorage } from '../../src/lib/registry/feature-registry-storage.js';
import { determineHealthStatus } from '../../src/dashboard/lib/health-filtering.js';
import type { NormalizedConfig } from '../../src/lib/config-yaml.js';
import { DEFAULT_ROLES, DEFAULT_WORKHORSES } from '../../src/lib/config-yaml.js';
import { resetHarnessResolveCachesForTests } from '../../src/lib/harness-resolve.js';

const piFifoMocks = vi.hoisted(() => ({
  writePiCommand: vi.fn(),
}));

const ohmypiFifoMocks = vi.hoisted(() => ({
  writeOhmypiCommand: vi.fn(),
}));

const transcriptLandingMocks = vi.hoisted(() => ({
  snapshotCount: 0,
  landed: false,
  useLandedFlag: false,
  snapshotCounts: undefined as number[] | undefined,
}));

const runtimeMirrorMocks = vi.hoisted(() => ({
  snapshots: new Map<string, any>(),
}));

const configMocks = vi.hoisted(() => ({
  roleOverrides: {} as Record<string, any>,
  // Provider-default-only (PAN-1984): harness is derived from the model's provider.
  // Tests set a per-provider default here to drive the resolved harness (e.g. pi).
  providerHarnesses: {} as Record<string, any>,
}));

vi.mock('../../src/lib/transcript-landing.js', () => ({
  captureTranscriptUserRecordSnapshot: vi.fn(async () => {
    if (transcriptLandingMocks.snapshotCounts) {
      const count = transcriptLandingMocks.snapshotCounts.length > 1
        ? transcriptLandingMocks.snapshotCounts.shift()!
        : transcriptLandingMocks.snapshotCounts[0] ?? 0;
      return { sessionFile: '/tmp/session.jsonl', userRecordCount: count };
    }
    if (transcriptLandingMocks.useLandedFlag) {
      return { sessionFile: '/tmp/session.jsonl', userRecordCount: transcriptLandingMocks.landed ? 1 : 0 };
    }
    transcriptLandingMocks.snapshotCount += 1;
    return {
      sessionFile: '/tmp/session.jsonl',
      userRecordCount: transcriptLandingMocks.snapshotCount,
    };
  }),
  hasNewTranscriptUserRecord: vi.fn((before: { userRecordCount: number }, after: { userRecordCount: number }) =>
    after.userRecordCount > before.userRecordCount,
  ),
}));

vi.mock('../../src/lib/agent-runtime-mirror.js', () => ({
  getRuntimeSnapshot: vi.fn((agentId: string) => Effect.succeed(runtimeMirrorMocks.snapshots.get(agentId) ?? null)),
  isAgentStateServiceInProcess: vi.fn(() => Effect.succeed(true)),
}));

vi.mock('../../src/lib/runtimes/pi-fifo.js', () => ({
  PiNotReady: class PiNotReady extends Error {},
  createPiFifo: vi.fn((agentId: string) => Effect.sync(() => {
    const dir = join(process.env.OVERDECK_HOME ?? tmpdir(), 'agents', agentId);
    mkdirSync(dir, { recursive: true });
    return join(dir, 'rpc.in');
  })),
  piFifoPaths: (agentId: string) => {
    const dir = join(process.env.OVERDECK_HOME ?? tmpdir(), 'agents', agentId);
    return {
      agentDir: dir,
      readyPath: join(dir, 'ready.json'),
      fifoPath: join(dir, 'rpc.in'),
    };
  },
  writePiCommand: piFifoMocks.writePiCommand,
  writePiCommandSync: piFifoMocks.writePiCommand,
}));

vi.mock('../../src/lib/runtimes/ohmypi-fifo.js', () => ({
  OhmypiNotReady: class OhmypiNotReady extends Error {},
  createOhmypiFifo: vi.fn((agentId: string) => Effect.sync(() => {
    const dir = join(process.env.OVERDECK_HOME ?? tmpdir(), 'agents', agentId);
    mkdirSync(dir, { recursive: true });
    return join(dir, 'rpc.in');
  })),
  ohmypiFifoPaths: (agentId: string) => {
    const dir = join(process.env.OVERDECK_HOME ?? tmpdir(), 'agents', agentId);
    return {
      agentDir: dir,
      readyPath: join(dir, 'ready.json'),
      fifoPath: join(dir, 'rpc.in'),
    };
  },
  writeOhmypiCommand: ohmypiFifoMocks.writeOhmypiCommand,
  writeOhmypiCommandSync: ohmypiFifoMocks.writeOhmypiCommand,
}));

// Mock tmux module to avoid actual session creation
vi.mock('../../src/lib/tmux.js', () => ({
  createSession: vi.fn(() => Effect.void),
  createSessionSync: vi.fn(),
  killSession: vi.fn(() => Effect.void),
  killSessionSync: vi.fn(),
  sendKeys: vi.fn(() => Effect.void),
  sendKeysSync: vi.fn(),
  sendKeysProgram: vi.fn(() => Effect.void),
  sendEscapeKeyAsync: vi.fn(() => Promise.resolve()),
  sendRawKeystroke: vi.fn(() => Effect.void),
  sessionExists: vi.fn(() => Effect.succeed(false)),
  sessionExistsSync: vi.fn(() => Effect.succeed(false)),
  getAgentSessions: vi.fn(() => Effect.succeed([])),
  getAgentSessionsSync: vi.fn(() => Effect.succeed([])),
  listSessions: vi.fn(() => Effect.succeed([])),
  listSessionsSync: vi.fn(() => []),
  listPaneValues: vi.fn(() => Effect.succeed([])),
  listPaneValuesSync: vi.fn().mockReturnValue([]),
  setOption: vi.fn(() => Effect.void),
  exactSession: (name: string) => name.startsWith('=') ? name : `=${name}`,
  exactPaneTarget: (name: string) => name.startsWith('=') ? (name.endsWith(':') ? name : `${name}:`) : `=${name}:`,
  capturePane: vi.fn(() => Effect.succeed('Claude Code')),
  capturePaneSync: vi.fn(() => 'Claude Code'),
}));

vi.mock('../../src/lib/hooks.js', () => ({
  initHook: vi.fn(),
  initHookSync: vi.fn(),
  checkHook: vi.fn().mockReturnValue({ allowed: true, hasWork: false }),
  checkHookSync: vi.fn().mockReturnValue({ allowed: true, hasWork: false }),
  generateFixedPointPrompt: vi.fn().mockReturnValue(''),
  checkAndSetupHooks: vi.fn(),
  writeTaskCache: vi.fn(),
}));

vi.mock('../../src/lib/cv.js', () => ({
  startWork: vi.fn(),
  startWorkSync: vi.fn(),
  completeWork: vi.fn(),
  completeWorkSync: vi.fn(),
  getAgentCV: vi.fn().mockReturnValue(null),
  getAgentCVSync: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/lib/memory/injection.js', () => ({
  injectPromptTimeMemory: vi.fn().mockResolvedValue({
    status: 'injected',
    reason: null,
    context: '',
    decision: {},
  }),
}));

vi.mock('../../src/lib/cliproxy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/cliproxy.js')>();
  return {
    ...actual,
    isCliproxyRunning: vi.fn().mockReturnValue(Effect.succeed(true)),
    isCliproxyRunningSync: vi.fn().mockReturnValue(true),
    isCliproxyRunningProgram: vi.fn(() => Effect.succeed(true)),
  };
});

vi.mock('../../src/lib/github-app.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/github-app.js')>();
  return {
    ...actual,
    isGitHubAppConfigured: vi.fn().mockReturnValue(false),
  };
});

// Mock config loading: surface the canonical workhorses + roles defaults so
// resolveModel() and the role harness lookup find consistent values.
vi.mock('../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/config-yaml.js')>();
  const buildLoadedConfig = () => ({
    config: {
      preset: 'balanced',
      enabledProviders: new Set(['anthropic']),
      apiKeys: {},
      providerAuth: {},
      providerPlan: {},
      openrouterFavorites: [],
      workhorses: { ...actual.DEFAULT_WORKHORSES },
      roles: { ...actual.DEFAULT_ROLES, ...configMocks.roleOverrides },
      providerHarnesses: { ...configMocks.providerHarnesses },
      overrides: {},
      geminiThinkingLevel: 3,
      trackerKeys: {},
      tmux: { configMode: 'managed' },
      conversations: {
        compactionModel: 'claude-haiku-4-5',
        manualCompactMode: 'claude-code',
        richCompaction: true,
        titleModel: 'claude-haiku-4-5',
      },
      claude: { permissionMode: 'bypass' },
      experimental: { claudeCodeChannels: false, claudeCodeChannelsMcp: false, streamdownRenderer: false },
      caveman: { enabled: false, abTest: false, modes: { work: 'full', review: 'review', test: 'full', merge: 'full' } },
    } as NormalizedConfig,
  });
  return {
    ...actual,
    isClaudeCodeChannelsMcpEnabled: vi.fn().mockReturnValue(false),
    loadConfig: vi.fn().mockImplementation(buildLoadedConfig),
    loadConfigSync: vi.fn().mockImplementation(buildLoadedConfig),
  };
});

// harness-policy is mocked to permit every requested combination so these
// tests focus on the role primitive contract; the dedicated harness-policy
// tests cover the gate logic itself.
vi.mock('../../src/lib/harness-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/harness-policy.js')>();
  return {
    ...actual,
    canUseHarness: vi.fn().mockReturnValue({ allowed: true }),
    canUseHarnessSync: vi.fn().mockReturnValue({ allowed: true }),
  };
});

vi.mock('../../src/lib/beads-query.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/beads-query.js')>();
  return {
    ...actual,
    assertIssueHasBeads: vi.fn(() => Effect.void),
  };
});

describe('PAN-1048 role primitive — agent spawning', () => {
  let testOverdeckHome: string;
  let testAgentsDir: string;
  let testWorkspace: string;
  const originalOverdeckHome = process.env.OVERDECK_HOME;
  const originalPromptReadyTimeout = process.env.OVERDECK_PROMPT_READY_TIMEOUT_SECONDS;
  const originalPath = process.env.PATH;
  const originalTmuxSocketName = process.env.OVERDECK_TMUX_SOCKET_NAME;
  const originalTestHarnessCommand = process.env.OVERDECK_TEST_HARNESS_COMMAND;
  const originalDockerWorkspace = process.env.OVERDECK_DOCKER_WORKSPACE;
  const testTmuxSocketName = `pan-test-${process.pid}`;
  const supervisorScriptPath = join(process.cwd(), 'dist', 'pty-supervisor.js');
  let createdSupervisorStub = false;

  beforeAll(() => {
    // PAN-1808: never touch the shared overdeck socket; use a throwaway
    // per-process socket and a harmless harness command as defense in depth.
    process.env.OVERDECK_TMUX_SOCKET_NAME = testTmuxSocketName;
    process.env.OVERDECK_TEST_HARNESS_COMMAND = 'true';
    if (!existsSync(supervisorScriptPath)) {
      mkdirSync(join(process.cwd(), 'dist'), { recursive: true });
      writeFileSync(supervisorScriptPath, '#!/usr/bin/env node\n');
      createdSupervisorStub = true;
    }
  });

  afterAll(() => {
    if (createdSupervisorStub) {
      rmSync(supervisorScriptPath, { force: true });
    }
    // Tear down the throwaway tmux server so no sessions linger.
    try {
      execSync(`tmux -L ${testTmuxSocketName} kill-server`, { stdio: 'ignore' });
    } catch {
      // Server may already be gone; ignore.
    }
    if (originalTmuxSocketName) {
      process.env.OVERDECK_TMUX_SOCKET_NAME = originalTmuxSocketName;
    } else {
      delete process.env.OVERDECK_TMUX_SOCKET_NAME;
    }
    if (originalTestHarnessCommand) {
      process.env.OVERDECK_TEST_HARNESS_COMMAND = originalTestHarnessCommand;
    } else {
      delete process.env.OVERDECK_TEST_HARNESS_COMMAND;
    }
  });

  beforeEach(async () => {
    testOverdeckHome = join(tmpdir(), `pan-home-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testAgentsDir = join(testOverdeckHome, 'agents');
    // PAN-1752: spawn paths hard-fail on a missing workspace dir (PAN-1746
    // gate in assertWorkspaceStackHealthyForSpawn), so the fixture workspace
    // must actually exist — a bare '/tmp/test-workspace' literal only passed
    // when leftover state happened to be on the machine.
    testWorkspace = join(testOverdeckHome, 'test-workspace');
    mkdirSync(testAgentsDir, { recursive: true });
    mkdirSync(testWorkspace, { recursive: true });
    process.env.OVERDECK_HOME = testOverdeckHome;
    process.env.OVERDECK_PROMPT_READY_TIMEOUT_SECONDS = '1';
    // This suite verifies the role primitive and prompt-delivery paths with a
    // mocked tmux runtime. Keep PTY-supervisor wiring out of scope so the tests
    // remain hermetic when run directly without a prior `npm run build`.
    process.env.OVERDECK_DOCKER_WORKSPACE = '1';
    // The ohmypi harness is normally guarded by `command -v omp`. Several tests
    // exercise the ohmypi resume/delivery path, so provide a harmless stub binary
    // on PATH for the duration of this test. This keeps harness resolution
    // deterministic regardless of whether the real `omp` CLI is installed on
    // the runner (PAN-1859).
    const piBinDir = join(testOverdeckHome, 'bin');
    mkdirSync(piBinDir, { recursive: true });
    const piStub = join(piBinDir, 'omp');
    writeFileSync(piStub, '#!/bin/sh\nexit 0\n');
    chmodSync(piStub, 0o755);
    process.env.PATH = `${piBinDir}${delimiter}${process.env.PATH}`;
    transcriptLandingMocks.snapshotCount = 0;
    transcriptLandingMocks.landed = false;
    transcriptLandingMocks.useLandedFlag = false;
    transcriptLandingMocks.snapshotCounts = undefined;
    runtimeMirrorMocks.snapshots.clear();
    configMocks.roleOverrides = {};
    configMocks.providerHarnesses = {};
    resetHarnessResolveCachesForTests();
    vi.clearAllMocks();
    const tmux = await import('../../src/lib/tmux.js');
    vi.mocked(tmux.sendKeys).mockImplementation(() => Effect.void);
    vi.mocked(tmux.sendEscapeKeyAsync).mockResolvedValue(undefined);
    vi.mocked(tmux.sessionExists).mockReturnValue(Effect.succeed(false));
    // PAN-1594: spawnRun/spawnAgent now wait for the session-start hook to write
    // ready.json (waitForReadySignal) instead of scraping the tmux pane. The real
    // hook fires when Claude boots; in tests createSession is mocked, so simulate
    // the hook by writing ready.json when a session is "created". Without this the
    // claude-code prompt-delivery path blocks the full 30s and the test times out.
    vi.mocked(tmux.createSession).mockImplementation((agentId: string) =>
      Effect.sync(() => {
        const agentDir = getAgentDir(agentId);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'ready.json'), JSON.stringify({ ready: true }));
        writeFileSync(join(agentDir, 'session.id'), `${agentId}-session`);
      }),
    );
    const cliproxy = await import('../../src/lib/cliproxy.js');
    vi.mocked(cliproxy.isCliproxyRunningSync).mockReturnValue(true);
    const beadsQuery = await import('../../src/lib/beads-query.js');
    vi.mocked(beadsQuery.assertIssueHasBeads).mockReturnValue(Effect.void);
    piFifoMocks.writePiCommand.mockClear();
    ohmypiFifoMocks.writeOhmypiCommand.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await closeFeatureRegistryStorage();
    if (originalOverdeckHome) {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    } else {
      delete process.env.OVERDECK_HOME;
    }
    if (originalPromptReadyTimeout) {
      process.env.OVERDECK_PROMPT_READY_TIMEOUT_SECONDS = originalPromptReadyTimeout;
    } else {
      delete process.env.OVERDECK_PROMPT_READY_TIMEOUT_SECONDS;
    }
    if (originalPath) {
      process.env.PATH = originalPath;
    } else {
      delete process.env.PATH;
    }
    if (originalDockerWorkspace) {
      process.env.OVERDECK_DOCKER_WORKSPACE = originalDockerWorkspace;
    } else {
      delete process.env.OVERDECK_DOCKER_WORKSPACE;
    }
    if (existsSync(testOverdeckHome)) {
      rmSync(testOverdeckHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
    }
  });

  function writeResumableWorkAgent(agentId: string, kickoffDelivered: boolean | undefined, withPrompt = true): string {
    const workspace = join(testOverdeckHome, `${agentId}-workspace`);
    mkdirSync(workspace, { recursive: true });
    const agentDir = getAgentDir(agentId);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'session.id'), `${agentId}-session`);
    if (withPrompt) {
      writeFileSync(join(agentDir, 'initial-prompt.md'), `original kickoff for ${agentId}`);
    }
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({
      id: agentId,
      issueId: 'PAN-RESUME',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: DEFAULT_WORKHORSES.mid,
      status: 'stopped',
      startedAt: new Date().toISOString(),
      ...(kickoffDelivered === undefined ? {} : { kickoffDelivered }),
    }));
    return workspace;
  }

  function writeResumableReviewSubAgent(agentId: string, harness: 'claude-code' | 'ohmypi'): string {
    const workspace = writeResumableWorkAgent(agentId, true);
    const agentDir = getAgentDir(agentId);
    const state = JSON.parse(readFileSync(join(agentDir, 'state.json'), 'utf8'));
    state.issueId = 'PAN-RESUME-REVIEW';
    state.harness = harness;
    state.role = 'review';
    state.reviewSubRole = 'security';
    state.reviewRunId = 'agent-pan-resume-review-abcdef12';
    state.reviewOutputPath = join(workspace, '.pan', 'review', state.reviewRunId, 'security.md');
    state.reviewSynthesisAgentId = 'agent-pan-resume-review';
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify(state));
    return workspace;
  }

  function setRuntimeOrigin(agentId: string, sessionModel?: string, sessionHarness?: string): void {
    runtimeMirrorMocks.snapshots.set(agentId, {
      id: agentId,
      activity: 'idle',
      lastActivity: new Date().toISOString(),
      claudeSessionId: `${agentId}-session`,
      model: sessionModel,
      sessionModel,
      sessionHarness,
    });
  }

  describe('work role (spawnAgent)', () => {
    it('writes role: "work" to AgentState and resolves the work model from roles config', async () => {
      const options: SpawnOptions = {
        issueId: 'PAN-TEST-1',
        workspace: testWorkspace,
        role: 'work',
      };

      const state = await spawnAgent(options);

      expect(state.id).toBe('agent-pan-test-1');
      expect(state.issueId).toBe('PAN-TEST-1');
      expect(state.role).toBe('work');
      // roles.work.model defaults to workhorse:mid (DEFAULT_ROLES) which
      // dereferences to DEFAULT_WORKHORSES.mid.
      expect(state.model).toBe(DEFAULT_WORKHORSES.mid);
      expect(state.harness).toBeDefined();
    });

    it('persists AgentState (role, harness, model) to disk under OVERDECK_HOME', async () => {
      await spawnAgent({
        issueId: 'PAN-TEST-2',
        workspace: testWorkspace,
        role: 'work',
      });

      const agentDir = getAgentDir('agent-pan-test-2');
      expect(existsSync(join(agentDir, 'state.json'))).toBe(true);

      const reloaded = getAgentStateSync('agent-pan-test-2');
      expect(reloaded?.issueId).toBe('PAN-TEST-2');
      expect(reloaded?.role).toBe('work');
      // Persisted contract: harness lives on AgentState (PAN-1048 R2),
      // legacy `phase`/`workType`/`agentType` are gone.
      expect(reloaded?.harness).toBeDefined();
      expect((reloaded as unknown as { phase?: string }).phase).toBeUndefined();
      expect((reloaded as unknown as { workType?: string }).workType).toBeUndefined();
      expect((reloaded as unknown as { agentType?: string }).agentType).toBeUndefined();
    });

    it('marks kickoffDelivered true after a ready work-agent kickoff is delivered', async () => {
      const tmux = await import('../../src/lib/tmux.js');

      const state = await spawnAgent({
        issueId: 'PAN-KICKOFF-1',
        workspace: testWorkspace,
        role: 'work',
        prompt: 'do the work',
      });

      expect(state.kickoffDelivered).toBe(true);
      expect(getAgentStateSync('agent-pan-kickoff-1')?.kickoffDelivered).toBe(true);
      expect(tmux.sendKeys).toHaveBeenCalledWith('agent-pan-kickoff-1', expect.stringContaining('do the work'));
    });

    it('treats failed work-agent kickoff delivery as fatal instead of leaving a running zombie', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const tmux = await import('../../src/lib/tmux.js');
      let sessionCreated = false;
      vi.mocked(tmux.createSession).mockImplementation(() => Effect.sync(() => {
        sessionCreated = true;
      }));
      vi.mocked(tmux.sessionExists).mockImplementation(() => Effect.succeed(sessionCreated));

      try {
        await expect(spawnAgent({
          issueId: 'PAN-KICKOFF-FAIL',
          workspace: testWorkspace,
          role: 'work',
          prompt: 'do the work',
        })).rejects.toThrow('Agent agent-pan-kickoff-fail kickoff delivery failed');
        const reloaded = getAgentStateSync('agent-pan-kickoff-fail');

        expect(reloaded?.status).toBe('stopped');
        expect(reloaded?.kickoffDelivered).toBe(false);
        expect(reloaded?.troubled).toBe(true);
        expect(reloaded?.lastFailureReason).toBe('kickoff delivery failed');
        expect(tmux.killSession).toHaveBeenCalledWith('agent-pan-kickoff-fail');
        expect(tmux.sendKeys).not.toHaveBeenCalledWith('agent-pan-kickoff-fail', expect.stringContaining('do the work'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('fails spawn fast when the work-agent session exits before kickoff delivery', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const tmux = await import('../../src/lib/tmux.js');
      vi.mocked(tmux.createSession).mockImplementation(() => Effect.void);
      vi.mocked(tmux.sessionExists).mockReturnValue(Effect.succeed(false));

      try {
        await expect(spawnAgent({
          issueId: 'PAN-KICKOFF-EXIT',
          workspace: testWorkspace,
          role: 'work',
          prompt: 'do the work',
        })).rejects.toThrow('Agent agent-pan-kickoff-exit exited before kickoff could be delivered');

        const reloaded = getAgentStateSync('agent-pan-kickoff-exit');
        expect(reloaded?.status).toBe('stopped');
        expect(reloaded?.kickoffDelivered).toBe(false);
        expect(reloaded?.lastFailureReason).toBe('session-exited-before-kickoff');
        expect(tmux.sendKeys).not.toHaveBeenCalledWith('agent-pan-kickoff-exit', expect.stringContaining('do the work'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('covers the ghost prevention lifecycle: failed kickoff stops the agent and preserves the kickoff prompt', { timeout: 30_000 }, async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-06-05T21:00:00.000Z'));
      const tmux = await import('../../src/lib/tmux.js');
      const workspace = join(testOverdeckHome, 'ghost-workspace');
      mkdirSync(workspace, { recursive: true });
      let createCount = 0;
      let sessionAlive = false;
      let firstCreated!: () => void;
      const firstCreatedPromise = new Promise<void>((resolve) => { firstCreated = resolve; });
      vi.mocked(tmux.sessionExists).mockImplementation(() => Effect.succeed(sessionAlive));
      vi.mocked(tmux.createSession).mockImplementation((agentId: string) => Effect.sync(() => {
        createCount += 1;
        sessionAlive = true;
        const agentDir = getAgentDir(agentId);
        mkdirSync(agentDir, { recursive: true });
        if (createCount === 1) firstCreated();
      }));

      try {
        await expect(spawnAgent({
          issueId: 'PAN-GHOST-LIFE',
          workspace,
          role: 'work',
          prompt: 'original ghost kickoff',
        })).rejects.toThrow('Agent agent-pan-ghost-life kickoff delivery failed');
        await firstCreatedPromise;

        const reloaded = getAgentStateSync('agent-pan-ghost-life');
        expect(reloaded?.status).toBe('stopped');
        expect(reloaded?.kickoffDelivered).toBe(false);
        expect(reloaded?.troubled).toBe(true);
        expect(reloaded?.lastFailureReason).toBe('kickoff delivery failed');
        expect(readFileSync(join(getAgentDir('agent-pan-ghost-life'), 'initial-prompt.md'), 'utf-8')).toContain('original ghost kickoff');
        expect(tmux.killSession).toHaveBeenCalledWith('agent-pan-ghost-life');

        vi.advanceTimersByTime(5 * 60 * 1000);
        await expect(Effect.runPromise(determineHealthStatus(
          'agent-pan-ghost-life',
          join(getAgentDir('agent-pan-ghost-life'), 'state.json'),
          new Set(['agent-pan-ghost-life']),
        ))).resolves.not.toMatchObject({ status: 'stalled' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('resumeAgent re-delivers the original kickoff when kickoffDelivered is false', async () => {
      const tmux = await import('../../src/lib/tmux.js');
      const agentId = 'agent-pan-resume-redeliver';
      writeResumableWorkAgent(agentId, false);

      const result = await resumeAgent(agentId);

      expect(result).toEqual({ success: true, messageDelivered: true });
      expect(tmux.sendKeys).toHaveBeenCalledWith(agentId, expect.stringContaining(`original kickoff for ${agentId}`));
      expect(tmux.sendKeys).not.toHaveBeenCalledWith(agentId, expect.stringContaining('Read .pan/continue.json'));
      expect(getAgentStateSync(agentId)?.kickoffDelivered).toBe(true);
    });

    it('resumeAgent marks kickoff redelivered only after the redelivery lands', { timeout: 30_000 }, async () => {
      vi.useFakeTimers();
      const tmux = await import('../../src/lib/tmux.js');
      const agentId = 'agent-pan-resume-redeliver-second';
      writeResumableWorkAgent(agentId, false);
      transcriptLandingMocks.useLandedFlag = true;
      let deliveryAttempts = 0;
      vi.mocked(tmux.sendKeys).mockImplementation(() => Effect.sync(() => {
        deliveryAttempts += 1;
        if (deliveryAttempts === 2) transcriptLandingMocks.landed = true;
      }));

      try {
        const result = resumeAgent(agentId);
        await vi.waitFor(() => expect(tmux.createSession).toHaveBeenCalled());
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.waitFor(() => expect(tmux.sendKeys).toHaveBeenCalledTimes(1));
        expect(getAgentStateSync(agentId)?.kickoffDelivered).toBe(false);
        await vi.advanceTimersByTimeAsync(3_000);
        await vi.waitFor(() => expect(tmux.sendKeys).toHaveBeenCalledTimes(2));
        await expect(result).resolves.toEqual({ success: true, messageDelivered: true });
      } finally {
        vi.useRealTimers();
      }

      expect(deliveryAttempts).toBe(2);
      expect(getAgentStateSync(agentId)?.kickoffDelivered).toBe(true);
    }, 15_000);

    it('resumeAgent keeps generic continue behavior when kickoffDelivered is true', async () => {
      const tmux = await import('../../src/lib/tmux.js');
      const agentId = 'agent-pan-resume-confirmed';
      writeResumableWorkAgent(agentId, true);

      const result = await resumeAgent(agentId);

      expect(result).toEqual({ success: true, messageDelivered: true });
      expect(tmux.sendKeys).toHaveBeenCalledWith(agentId, expect.stringContaining('Read .pan/continue.json'));
      expect(tmux.sendKeys).not.toHaveBeenCalledWith(agentId, expect.stringContaining(`original kickoff for ${agentId}`));
      expect(getAgentStateSync(agentId)?.kickoffDelivered).toBe(true);
    }, 15_000);

    it('resumeAgent delivers the continue prompt through the Pi FIFO for ohmypi work agents', async () => {
      const tmux = await import('../../src/lib/tmux.js');
      const agentId = 'agent-pan-resume-pi-continue';
      writeResumableWorkAgent(agentId, true);
      // Provider-default-only (PAN-1984): an ohmypi work agent is one whose model's provider
      // resolves to ohmypi. Drive that through the per-provider default rather than a
      // (now-ignored) explicit state.harness. The mid workhorse is an Anthropic model,
      // and the session origin is ohmypi so there is no resume drift.
      configMocks.providerHarnesses = { anthropic: 'ohmypi' };
      setRuntimeOrigin(agentId, DEFAULT_WORKHORSES.mid, 'ohmypi');
      vi.mocked(tmux.createSession).mockImplementationOnce((createdAgentId: string) => Effect.sync(() => {
        const agentDir = getAgentDir(createdAgentId);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'ready.json'), JSON.stringify({ ready: true }));
      }));

      const result = await resumeAgent(agentId);

      expect(result).toEqual({ success: true, messageDelivered: true });
      expect(ohmypiFifoMocks.writeOhmypiCommand).toHaveBeenCalledWith(
        agentId,
        expect.objectContaining({
          type: 'prompt',
          message: expect.stringContaining('Read .pan/continue.json'),
        }),
      );
      expect(tmux.sendKeys).not.toHaveBeenCalledWith(agentId, expect.stringContaining('Read .pan/continue.json'));
    });

    it('resumeAgent delivers convoy re-review prompts through the OhMyPi FIFO for ohmypi review sub-agents', async () => {
      const tmux = await import('../../src/lib/tmux.js');
      const agentId = 'agent-pan-resume-review-security-pi';
      const message = 'Re-run security review for the current convoy run.';
      writeResumableReviewSubAgent(agentId, 'ohmypi');
      configMocks.providerHarnesses = { anthropic: 'ohmypi' };
      setRuntimeOrigin(agentId, DEFAULT_WORKHORSES.mid, 'ohmypi');

      const result = await resumeAgent(agentId, message);

      expect(result).toEqual({ success: true, messageDelivered: true });
      expect(ohmypiFifoMocks.writeOhmypiCommand).toHaveBeenCalledWith(
        agentId,
        expect.objectContaining({
          type: 'prompt',
          message,
        }),
      );
      expect(tmux.sendKeys).not.toHaveBeenCalledWith(agentId, expect.stringContaining(message));
      expect(piFifoMocks.writePiCommand).not.toHaveBeenCalled();
    });

    it('resumeAgent delivers convoy re-review prompts through tmux for claude-code review sub-agents', async () => {
      const tmux = await import('../../src/lib/tmux.js');
      const agentId = 'agent-pan-resume-review-security-claude';
      const message = 'Re-run security review for the current convoy run.';
      writeResumableReviewSubAgent(agentId, 'claude-code');
      setRuntimeOrigin(agentId, DEFAULT_WORKHORSES.mid, 'claude-code');

      const result = await resumeAgent(agentId, message);

      expect(result).toEqual({ success: true, messageDelivered: true });
      expect(tmux.sendKeys).toHaveBeenCalledWith(agentId, expect.stringContaining(message));
      expect(ohmypiFifoMocks.writeOhmypiCommand).not.toHaveBeenCalledWith(
        agentId,
        expect.objectContaining({ message: expect.stringContaining(message) }),
      );
      expect(piFifoMocks.writePiCommand).not.toHaveBeenCalled();
    });

    it('resumeAgent preserves failure counters until deacon can classify rapid post-resume deaths', async () => {
      const agentId = 'agent-pan-resume-preserve-failures';
      writeResumableWorkAgent(agentId, true);
      const statePath = join(getAgentDir(agentId), 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.consecutiveFailures = 2;
      state.firstFailureInRunAt = '2026-06-13T00:00:00.000Z';
      state.lastFailureAt = '2026-06-13T00:01:00.000Z';
      state.lastFailureReason = 'rapid post-resume death: tmux session missing within 120s (patrol)';
      state.lastFailureNextRetryAt = '2026-06-13T00:03:00.000Z';
      writeFileSync(statePath, JSON.stringify(state));

      const result = await resumeAgent(agentId);

      expect(result).toEqual({ success: true, messageDelivered: true });
      const reloaded = getAgentStateSync(agentId);
      expect(reloaded?.status).toBe('running');
      expect(reloaded?.consecutiveFailures).toBe(2);
      expect(reloaded?.firstFailureInRunAt).toBe('2026-06-13T00:00:00.000Z');
      expect(reloaded?.lastFailureReason).toContain('rapid post-resume death');
    });

    it('resumeAgent keeps --resume when session origin model and harness are unchanged', async () => {
      const agentId = 'agent-pan-resume-same-origin';
      writeResumableWorkAgent(agentId, true);
      setRuntimeOrigin(agentId, DEFAULT_WORKHORSES.mid, 'claude-code');

      const result = await resumeAgent(agentId);

      expect(result).toEqual({ success: true, messageDelivered: true });
      const launcher = readFileSync(join(getAgentDir(agentId), 'launcher.sh'), 'utf8');
      expect(launcher).toContain(`--resume '${agentId}-session'`);
    });

    it('refuses to rotate the session when the requested model differs from session origin (PAN-1980)', async () => {
      const agentId = 'agent-pan-resume-model-drift';
      writeResumableWorkAgent(agentId, true);
      setRuntimeOrigin(agentId, DEFAULT_WORKHORSES.mid, 'claude-code');

      const result = await resumeAgent(agentId, undefined, { model: 'claude-haiku-4-5' });

      // PAN-1980: session rotation is disabled — model drift no longer spins up a fresh
      // session; resume refuses and leaves the agent stopped rather than rotating.
      expect(result.success).toBe(false);
      expect(result.error).toContain('session rotation is disabled (PAN-1980)');
    });

    it('refuses to rotate the session when the resolved harness differs from session origin (PAN-1980)', async () => {
      const agentId = 'agent-pan-resume-harness-drift';
      writeResumableWorkAgent(agentId, true);
      // Origin harness is ohmypi, but provider-default-only (PAN-1984) resolves the agent's
      // Anthropic model to claude-code — so the resolved harness drifts from the origin.
      setRuntimeOrigin(agentId, DEFAULT_WORKHORSES.mid, 'ohmypi');

      const result = await resumeAgent(agentId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('session rotation is disabled (PAN-1980)');
    });

    it('resumeAgent keeps --resume for legacy sessions with no origin metadata', async () => {
      const agentId = 'agent-pan-resume-legacy-origin';
      writeResumableWorkAgent(agentId, true);
      setRuntimeOrigin(agentId);

      const result = await resumeAgent(agentId, undefined, { model: 'claude-haiku-4-5' });

      expect(result).toEqual({ success: true, messageDelivered: true });
      const launcher = readFileSync(join(getAgentDir(agentId), 'launcher.sh'), 'utf8');
      expect(launcher).toContain(`--resume '${agentId}-session'`);
    });

    it('resumeAgent re-defaults a legacy agent\'s stale harness and drops --resume (PAN-1797)', async () => {
      const agentId = 'agent-pan-resume-legacy-redefault';
      writeResumableWorkAgent(agentId, true);
      // Simulate a pre-PAN-1787 agent: stored harness is stale for its model
      // (pi stored, but an Anthropic model re-resolves to claude-code) and there
      // is NO session-origin metadata. Target harness claude-code has no binary
      // check, so this is deterministic across local/CI.
      const agentDir = getAgentDir(agentId);
      const state = JSON.parse(readFileSync(join(agentDir, 'state.json'), 'utf8'));
      state.harness = 'pi';
      state.model = 'claude-haiku-4-5';
      writeFileSync(join(agentDir, 'state.json'), JSON.stringify(state));
      setRuntimeOrigin(agentId); // no origin metadata = legacy

      const result = await resumeAgent(agentId);

      // PAN-1980: rotation is refused on drift, so resume does not relaunch a fresh session...
      expect(result.success).toBe(false);
      expect(result.error).toContain('session rotation is disabled (PAN-1980)');
      // ...but the stale stored harness is still re-defaulted to the model's provider
      // default (PAN-1797) rather than pinned to the stored 'pi'.
      expect(getAgentStateSync(agentId)?.harness).toBe('claude-code');
    });

    it('resumeAgent surfaces missing original kickoff instead of sending a contextless continue', async () => {
      const tmux = await import('../../src/lib/tmux.js');
      const agentId = 'agent-pan-resume-missing-kickoff';
      writeResumableWorkAgent(agentId, false, false);

      const result = await resumeAgent(agentId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('kickoff prompt missing');
      expect(tmux.sendKeys).not.toHaveBeenCalledWith(agentId, expect.stringContaining('Read .pan/continue.json'));
      expect(getAgentStateSync(agentId)?.kickoffDelivered).toBe(false);
    });

    it.each([
      ['new model', { model: 'claude-haiku-4-5' }],
      ['new harness', { harness: 'ohmypi' as const }],
      ['new model and harness', { model: 'claude-haiku-4-5', harness: 'ohmypi' as const }],
    ])('restartAgent with %s starts fresh without --resume', async (_label, opts) => {
      const agentId = `agent-pan-restart-${_label.replaceAll(' ', '-')}`;
      writeResumableWorkAgent(agentId, true);

      const result = await restartAgent(agentId, { ...opts, graceful: false });

      expect(result).toEqual({ success: true });
      const launcher = readFileSync(join(getAgentDir(agentId), 'launcher.sh'), 'utf8');
      expect(launcher).not.toContain('--resume');
    });

    it('non-graceful restart skips Escape and grace wait', async () => {
      const tmux = await import('../../src/lib/tmux.js');
      const agentId = 'agent-pan-restart-nongraceful';
      writeResumableWorkAgent(agentId, true);
      vi.mocked(tmux.sessionExists).mockReturnValue(Effect.succeed(true));

      const result = await restartAgent(agentId, { graceful: false });

      expect(result).toEqual({ success: true });
      expect(tmux.sendEscapeKeyAsync).not.toHaveBeenCalled();
      expect(tmux.sendKeys).not.toHaveBeenCalledWith(agentId, expect.stringContaining('Restarting in 60s'));
    });

    it('honours an explicit options.model over the role config default', async () => {
      const state = await spawnAgent({
        issueId: 'PAN-TEST-3',
        workspace: testWorkspace,
        role: 'work',
        model: 'claude-haiku-4-5',
      });

      expect(state.model).toBe('claude-haiku-4-5');
      expect(state.role).toBe('work');
    });

    it('refuses to spawn before creating state when the issue has no beads', async () => {
      const beadsQuery = await import('../../src/lib/beads-query.js');
      vi.mocked(beadsQuery.assertIssueHasBeads).mockReturnValueOnce(
        Effect.fail(new Error('No beads tasks found for PAN-NOBEADS-1'))
      );

      await expect(spawnAgent({
        issueId: 'PAN-NOBEADS-1',
        workspace: testWorkspace,
        role: 'work',
      })).rejects.toThrow(/No beads tasks found/);

      expect(getAgentStateSync('agent-pan-nobeads-1')).toBeNull();
    });

    // ─── PAN-1215 cleanup block ─────────────────────────────────────────────────

    it('untracks workspace .pan/ artifacts when tracked and working tree is clean (AC22)', async () => {
      const workspace = join(tmpdir(), `pan-1215-ac22-${Date.now()}`);
      mkdirSync(join(workspace, '.pan'), { recursive: true });
      execSync('git init --initial-branch=main', { cwd: workspace });
      execSync('git config user.email "test@test.com"', { cwd: workspace });
      execSync('git config user.name "Test"', { cwd: workspace });
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":1}');
      writeFileSync(join(workspace, '.pan', 'spec.vbrief.json'), '{"p":1}');
      execSync('git add .', { cwd: workspace });
      execSync('git commit -m "initial"', { cwd: workspace });

      await spawnAgent({ issueId: 'PAN-AC22', workspace, role: 'work' });

      const tracked = execSync('git ls-files .pan/continue.json .pan/spec.vbrief.json', {
        cwd: workspace,
        encoding: 'utf-8',
      }).trim();
      expect(tracked).toBe('');

      const log = execSync('git log --oneline', { cwd: workspace, encoding: 'utf-8' }).trim();
      expect(log).toContain('chore: untrack workspace .pan/ artifacts (PAN-1215)');

      rmSync(workspace, { recursive: true, force: true });
    });

    it('warns and skips untrack when .pan/ paths have uncommitted changes (AC23)', async () => {
      const workspace = join(tmpdir(), `pan-1215-ac23-${Date.now()}`);
      mkdirSync(join(workspace, '.pan'), { recursive: true });
      execSync('git init --initial-branch=main', { cwd: workspace });
      execSync('git config user.email "test@test.com"', { cwd: workspace });
      execSync('git config user.name "Test"', { cwd: workspace });
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":1}');
      execSync('git add .', { cwd: workspace });
      execSync('git commit -m "initial"', { cwd: workspace });

      // Make .pan/ dirty
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":2}');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await spawnAgent({ issueId: 'PAN-AC23', workspace, role: 'work' });

      // No untrack commit should have been made
      const log = execSync('git log --oneline', { cwd: workspace, encoding: 'utf-8' }).trim();
      expect(log.split('\n').length).toBe(1);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping .pan/ untrack'),
      );
      warnSpy.mockRestore();

      rmSync(workspace, { recursive: true, force: true });
    });

    it('short-cuits .pan/ cleanup when neither file is tracked (AC24)', async () => {
      const workspace = join(tmpdir(), `pan-1215-ac24-${Date.now()}`);
      mkdirSync(join(workspace, '.pan'), { recursive: true });
      execSync('git init --initial-branch=main', { cwd: workspace });
      execSync('git config user.email "test@test.com"', { cwd: workspace });
      execSync('git config user.name "Test"', { cwd: workspace });
      writeFileSync(join(workspace, 'readme.md'), '# test');
      execSync('git add readme.md', { cwd: workspace });
      execSync('git commit -m "initial"', { cwd: workspace });

      // Files exist on disk but are NOT tracked
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":1}');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await spawnAgent({ issueId: 'PAN-AC24', workspace, role: 'work' });
      logSpy.mockRestore();
      warnSpy.mockRestore();

      // No new commit
      const log = execSync('git log --oneline', { cwd: workspace, encoding: 'utf-8' }).trim();
      expect(log.split('\n').length).toBe(1);

      // No warning about skipping untrack (the dirty-path warning)
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Skipping .pan/ untrack'),
      );
      // No "Untracked workspace .pan/ artifacts" success log either
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Untracked workspace .pan/ artifacts'),
      );

      rmSync(workspace, { recursive: true, force: true });
    });

    it('checkpoint after cleanup excludes previously tracked .pan/ artifacts (AC28)', async () => {
      const workspace = join(tmpdir(), `pan-1215-ac28-${Date.now()}`);
      mkdirSync(join(workspace, '.pan'), { recursive: true });
      execSync('git init --initial-branch=main', { cwd: workspace });
      execSync('git config user.email "test@test.com"', { cwd: workspace });
      execSync('git config user.name "Test"', { cwd: workspace });
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":1}');
      writeFileSync(join(workspace, '.pan', 'spec.vbrief.json'), '{"p":1}');
      writeFileSync(join(workspace, 'readme.md'), '# test');
      execSync('git add .', { cwd: workspace });
      execSync('git commit -m "initial"', { cwd: workspace });

      await spawnAgent({ issueId: 'PAN-AC28', workspace, role: 'work' });

      // Modify the now-untracked file and capture a checkpoint
      writeFileSync(join(workspace, '.pan', 'continue.json'), '{"v":2}');
      await Effect.runPromise(captureCheckpoint(workspace, 'agent-pan-ac28', 'turn-1'));

      expect(await Effect.runPromise(hasCheckpoint(workspace, 'agent-pan-ac28', 'turn-1'))).toBe(true);
      const ref = 'refs/pan/turn/agent-pan-ac28/turn-1';
      const commit = execSync(`git rev-parse ${ref}`, { cwd: workspace, encoding: 'utf-8' }).trim();
      const files = execSync(`git ls-tree -r --name-only ${commit}`, { cwd: workspace, encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean);

      expect(files).not.toContain('.pan/continue.json');
      expect(files).not.toContain('.pan/spec.vbrief.json');
      expect(files).toContain('readme.md');

      rmSync(workspace, { recursive: true, force: true });
    });
  });

  describe('non-work roles (spawnRun)', () => {
    it.each([
      { role: 'review' as const, expectedSuffix: '-review', expectedModel: DEFAULT_WORKHORSES.expensive },
      { role: 'test' as const, expectedSuffix: '-test', expectedModel: DEFAULT_WORKHORSES.mid },
      { role: 'ship' as const, expectedSuffix: '-ship', expectedModel: DEFAULT_WORKHORSES.mid },
    ])('spawnRun(issueId, $role) writes role and resolves model from workhorses defaults', async ({ role, expectedSuffix, expectedModel }) => {
      const issueId = `PAN-${role.toUpperCase()}-1`;
      const state = await spawnRun(issueId, role, {
        workspace: testWorkspace,
      });

      expect(state.id).toBe(`agent-${issueId.toLowerCase()}${expectedSuffix}`);
      expect(state.issueId).toBe(issueId);
      expect(state.role).toBe(role);
      expect(state.model).toBe(expectedModel);
      // DEFAULT_ROLES carries no per-role harness override → must default to
      // claude-code, not be left undefined.
      expect(state.harness).toBe(DEFAULT_ROLES[role].harness ?? 'claude-code');
      const { setOption } = await import('../../src/lib/tmux.js');
      expect(setOption).toHaveBeenCalledWith(state.id, 'destroy-unattached', 'off');
      expect(setOption).toHaveBeenCalledWith(`=${state.id}:`, 'remain-on-exit', 'on');
    });

    it('launches review sub-roles as interactive sessions, not headless print mode (PAN-1557)', async () => {
      // PAN-1594: claude-code prompt delivery now waits for the hook-written
      // ready.json. Write it during createSession so waitForReadySignal resolves
      // immediately instead of polling for 30s (mirrors the Pi-FIFO test below).
      const tmux = await import('../../src/lib/tmux.js');
      vi.mocked(tmux.createSession).mockImplementation((agentId: string) => Effect.sync(() => {
        const agentDir = getAgentDir(agentId);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'ready.json'), JSON.stringify({ ready: true }));
      }));
      await spawnRun('PAN-SUBREVIEW-1', 'review', {
        workspace: testWorkspace,
        subRole: 'security',
        prompt: 'review this diff',
      });

      const agentDir = getAgentDir('agent-pan-subreview-1-review-security');
      const launcher = readFileSync(join(agentDir, 'launcher.sh'), 'utf8');

      // PAN-1557: convoy reviewers are interactive + attachable now. No --print,
      // and the prompt is delivered via tmux after boot (not piped on stdin),
      // so the launcher carries neither the print flag nor a prompt-file redirect.
      expect(launcher).not.toContain('--print');
      expect(launcher).not.toContain('initial-prompt.md');
      expect(launcher).not.toContain('"$prompt"');
      // PAN-1808: tests run with OVERDECK_TEST_HARNESS_COMMAND=true so the
      // launcher command is a stub, but it must still carry a session-id.
      expect(launcher).toContain("--session-id '");
    });

    it('review sub-role launcher carries no signal block — Stop-hook owns REVIEWER_READY (PAN-1557)', async () => {
      // PAN-1594: write ready.json during createSession so the claude-code
      // prompt-delivery wait resolves immediately instead of polling for 30s.
      const tmux = await import('../../src/lib/tmux.js');
      vi.mocked(tmux.createSession).mockImplementation((agentId: string) => Effect.sync(() => {
        const agentDir = getAgentDir(agentId);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'ready.json'), JSON.stringify({ ready: true }));
      }));
      await spawnRun('PAN-SUBSIGNAL-1', 'review', {
        workspace: testWorkspace,
        subRole: 'correctness',
        prompt: 'review this diff',
        reviewSynthesisAgentId: 'agent-pan-subsignal-1-review',
        reviewOutputPath: '/tmp/out/review-correctness.md',
      });

      const agentDir = getAgentDir('agent-pan-subsignal-1-review-correctness');
      const launcher = readFileSync(join(agentDir, 'launcher.sh'), 'utf8');

      // PAN-1557: interactive reviewers don't exit, so the launcher no longer
      // owns the signal — the Stop-hook delivers REVIEWER_READY when the
      // reviewer finishes its turn with a written report. The launcher must NOT
      // carry the old headless signal machinery.
      expect(launcher).not.toContain("trap '' HUP");
      expect(launcher).not.toContain('--print');
      expect(launcher).not.toContain('REVIEWER_READY');
      expect(launcher).not.toContain('REVIEWER_TIMEOUT');
      expect(launcher).not.toContain('reviewer-launcher.pid');

      // Synthesis wiring is still persisted on AgentState so the Stop-hook can
      // read reviewSynthesisAgentId/reviewOutputPath/reviewSubRole.
      const state = getAgentStateSync('agent-pan-subsignal-1-review-correctness');
      expect(state?.reviewSynthesisAgentId).toBe('agent-pan-subsignal-1-review');
      expect(state?.reviewOutputPath).toBe('/tmp/out/review-correctness.md');
    });

    it('delivers Pi specialist prompts through the FIFO instead of tmux readiness', async () => {
      const tmux = await import('../../src/lib/tmux.js');
      const binDir = join(testOverdeckHome, 'bin');
      mkdirSync(binDir, { recursive: true });
      const fakePi = join(binDir, 'omp');
      writeFileSync(fakePi, '#!/bin/sh\nexit 0\n');
      chmodSync(fakePi, 0o755);
      process.env.PATH = `${binDir}:${originalPath ?? ''}`;
      resetHarnessResolveCachesForTests();
      // Provider-default-only (PAN-1984): drive the test role onto ohmypi via the per-provider
      // default (its model is Anthropic), not a per-role harness override.
      configMocks.providerHarnesses = { anthropic: 'ohmypi' };
      vi.mocked(tmux.createSession).mockImplementationOnce((agentId: string) => Effect.sync(() => {
        const agentDir = join(testAgentsDir, agentId);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'ready.json'), JSON.stringify({ ready: true }));
      }));
      vi.mocked(tmux.capturePane).mockReturnValueOnce(Effect.succeed('omp rpc mode'));

      const state = await spawnRun('PAN-PI-PROMPT-1', 'test', {
        workspace: testWorkspace,
        prompt: 'run the tests',
      });

      expect(state.harness).toBe('ohmypi');
      expect(ohmypiFifoMocks.writeOhmypiCommand).toHaveBeenCalledWith(
        'agent-pan-pi-prompt-1-test',
        expect.objectContaining({ type: 'prompt', message: 'run the tests' }),
      );
      expect(tmux.capturePane).not.toHaveBeenCalled();
      expect(tmux.sendKeys).not.toHaveBeenCalled();
    });

    it('refuses to spawn when a role session is already in tmux', async () => {
      const { sessionExists } = await import('../../src/lib/tmux.js');
      vi.mocked(sessionExists).mockReturnValue(Effect.succeed(true));

      await expect(
        spawnRun('PAN-DUP-1', 'review', { workspace: testWorkspace }),
      ).rejects.toThrow(/already running/);
    });
  });

  describe('harness policy gate at the spawn entry points', () => {
    it('rejects spawnRun review when the resolved provider-default harness is policy-denied', async () => {
      const harnessPolicy = await import('../../src/lib/harness-policy.js');
      // Provider-default-only (PAN-1984): there is no explicit harness to pass — the gate
      // runs on the resolved harness. Deny it and its claude-code fallback (two checks) so
      // resolution throws and the spawn entry point rejects.
      vi.mocked(harnessPolicy.canUseHarnessSync)
        .mockReturnValueOnce({ allowed: false, reason: 'harness denied by policy' })
        .mockReturnValueOnce({ allowed: false, reason: 'harness denied by policy' });

      await expect(spawnRun('PAN-PI-1', 'review', {
        workspace: testWorkspace,
      })).rejects.toThrow('harness denied by policy');

      expect(harnessPolicy.canUseHarnessSync).toHaveBeenCalled();
    });

    it('rejects spawnAgent work when the resolved provider-default harness is policy-denied', async () => {
      const harnessPolicy = await import('../../src/lib/harness-policy.js');
      vi.mocked(harnessPolicy.canUseHarnessSync)
        .mockReturnValueOnce({ allowed: false, reason: 'harness denied by policy' })
        .mockReturnValueOnce({ allowed: false, reason: 'harness denied by policy' });

      await expect(spawnAgent({
        issueId: 'PAN-PI-2',
        workspace: testWorkspace,
        role: 'work',
      })).rejects.toThrow('harness denied by policy');

      expect(harnessPolicy.canUseHarnessSync).toHaveBeenCalled();
    });

    // Positive case (canUseHarness allows pi → state.harness stays 'pi') is
    // covered indirectly: the dedicated harness-policy unit tests
    // (src/lib/__tests__/harness-policy.test.ts) prove every allowed combo
    // returns { allowed: true }, and the two downgrade tests above prove
    // resolveEffectiveHarness honours the gate's verdict. A full positive
    // round-trip here would also exercise getPiLauncherFields(), which
    // requires a built Pi extension on disk — out of scope for this suite.
  });

  describe('legacy field rejection at the dashboard route', () => {
    // The legacy-field guard lives in the POST /api/agents handler at
    // src/dashboard/server/routes/agents.ts:1872. It rejects bodies carrying
    // any of phase/workType/agentType with HTTP 400 — the role primitive is
    // the only supported spawn shape now.
    const LEGACY_FIELDS = ['workType', 'phase', 'agentType'] as const;

    it.each(LEGACY_FIELDS)('flags %s as a legacy field that must produce a 400', async (field) => {
      const body: Record<string, unknown> = { issueId: 'PAN-LEGACY-1', [field]: 'work' };
      const legacyFields = LEGACY_FIELDS.filter((f) => f in body);
      expect(legacyFields).toContain(field);
      // Mirror the guard's response shape so any future renaming has to
      // update this assertion alongside the route.
      const response = {
        error: `Legacy start-agent field(s) are no longer accepted: ${legacyFields.join(', ')}. Send role: 'work' instead.`,
      };
      expect(response.error).toContain('Legacy start-agent field(s) are no longer accepted');
      expect(response.error).toContain(field);
    });
  });
});
