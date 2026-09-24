/**
 * PAN-3842 (adjudicated F-6a): spawn-entry fitness integration.
 *
 * The earlier round tested the fitness helpers directly and, later, a test-local
 * copy of the intended call-site ordering. Neither drove a real spawn, so the
 * suite stayed green while spawn.ts logged against the wrong model. These tests
 * call the exported spawnAgent and spawnRun entry points with the side effects
 * mocked (tmux, harness launch, hooks, delivery, state writes) and read the
 * warning off console.warn exactly as an operator would read it in the log.
 *
 * Nothing in the fitness path is mocked: tier-fitness, tier-fitness-context,
 * spawn-prep, staffing, and model-capability-class all run for real.
 *
 * The mock scaffold mirrors agents-spawn-supervisor.test.ts, which is the
 * established way to exercise spawn end to end in this codebase.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '../agents.js';
import { createOverdeckDatabase } from '../../../scripts/create-overdeck-db.js';
import { closeOverdeckDatabase } from '../overdeck/infra.js';

let tmpHome: string;
let workspace: string;
let packageRootDir: string;
let createSessionMock: ReturnType<typeof vi.fn>;
let sendRawKeystrokeMock: ReturnType<typeof vi.fn>;
let resolveHarnessMock: ReturnType<typeof vi.fn>;
let prepareHarnessLaunchMock: ReturnType<typeof vi.fn>;
let emitAgentEventMock: ReturnType<typeof vi.fn>;
let ensureLifecycleHooksMock: ReturnType<typeof vi.fn>;
let deliverAgentMessageMock: ReturnType<typeof vi.fn>;
let waitForPromptReadyMock: ReturnType<typeof vi.fn>;
let stopAgentMock: ReturnType<typeof vi.fn>;
let capturePaneText: string;
let planFixture: unknown;
let tieredFixture: unknown;
let warnLines: string[];
let warnSpy: ReturnType<typeof vi.spyOn>;
let channelsMcpEnabled: boolean;
let activeFlywheelRunId: string | null;
const HEAVY_HOOK_TIMEOUT_MS = 20_000;


const PARENT_DEFAULT_MODEL = 'claude-sonnet-4-6';   // workhorse
const TIER_FRONTIER_MODEL = 'claude-opus-4-8';      // frontier
const TIER_SMALL_MODEL = 'claude-haiku-4-5';        // small
const RETIRED_SMALL_MODEL = 'glm-4.7-flash';        // small, retires to frontier glm-5.1

const TIERED_OFF = { enabled: false, tiers: {}, difficultyToTier: {} };

function tieredWith(model: string) {
  return {
    enabled: true,
    tiers: { top: { model, harness: 'claude-code', difficulties: ['expert'] } },
    difficultyToTier: { trivial: 'top', simple: 'top', medium: 'top', complex: 'top', expert: 'top' },
  };
}

function expertPlan(itemId = 'item-expert') {
  return {
    xBRIEFInfo: { version: '0.8', created: '2026-09-16T00:00:00Z' },
    plan: {
      id: 'pan-3842',
      title: 'fitness spawn fixture',
      status: 'running',
      items: [{ id: itemId, title: itemId, status: 'pending', metadata: { difficulty: 'expert' } }],
      edges: [],
    },
  };
}

/** The `[spawn] tier fitness:` lines the spawn emitted, in order. */
function fitnessLines(): string[] {
  return warnLines.filter((line) => line.startsWith('[spawn] tier fitness:'));
}

function baseState(partial: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-3842',
    issueId: 'PAN-3842',
    workspace,
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-4-6',
    status: 'starting',
    startedAt: '2026-05-23T00:00:00.000Z',
    ...partial,
  };
}

function writeSupervisorArtifact(): string {
  const path = join(packageRootDir, 'dist', 'pty-supervisor.js');
  mkdirSync(join(packageRootDir, 'dist'), { recursive: true });
  writeFileSync(path, '#!/usr/bin/env node\n');
  return path;
}

function mockSpawnDependencies(): void {
  createSessionMock = vi.fn(() => undefined);
  sendRawKeystrokeMock = vi.fn(() => Effect.void);
  emitAgentEventMock = vi.fn(() => Effect.succeed(true));
  ensureLifecycleHooksMock = vi.fn(async () => undefined);
  deliverAgentMessageMock = vi.fn(async () => ({ ok: true, path: 'acp' }));
  waitForPromptReadyMock = vi.fn(async () => true);
  stopAgentMock = vi.fn(() => Effect.void);
  resolveHarnessMock = vi.fn(async ({ explicit, model }: { explicit?: string; model: string }) => {
    if (explicit) return explicit;
    if (model === 'gpt-5.5') return 'codex';
    if (model === 'kimi-k2.6') return 'ohmypi';
    return 'claude-code';
  });
  prepareHarnessLaunchMock = vi.fn(async (harness: string) => ({
    binaryPath: `/home/test/.local/bin/${harness === 'claude-code' ? 'claude' : harness === 'ohmypi' ? 'omp' : 'codex'}`,
    pathExport: `export PATH='/home/test/.local/bin':"$PATH"`,
  }));

  vi.doMock('../harness-resolve.js', () => ({
    resolveHarness: resolveHarnessMock,
  }));
  vi.doMock('../harness-binary.js', () => ({
    prepareHarnessLaunch: prepareHarnessLaunchMock,
  }));
  vi.doMock('../agent-runtime.js', () => ({
    emitAgentEvent: emitAgentEventMock,
  }));
  vi.doMock('../agents/hook-readiness.js', () => ({
    ensureLifecycleHooksBeforeLaunch: ensureLifecycleHooksMock,
  }));
  vi.doMock('../agents/delivery.js', async (importOriginal) => ({
    ...((await importOriginal()) as typeof import('../agents/delivery.js')),
    deliverAgentMessage: deliverAgentMessageMock,
    // Slot spawns carry a kickoff prompt and go through the retrying PTY path;
    // delivery transport is a side effect, not the subject of these tests.
    deliverInitialPromptWithRetry: vi.fn(async () => ({ ok: true, path: 'acp' })),
  }));
  vi.doMock('../agents/runtime-command.js', async (importOriginal) => ({
    ...((await importOriginal()) as typeof import('../agents/runtime-command.js')),
    waitForPromptReady: waitForPromptReadyMock,
  }));
  vi.doMock('../agents/termination.js', async (importOriginal) => ({
    ...((await importOriginal()) as typeof import('../agents/termination.js')),
    stopAgent: stopAgentMock,
  }));
  vi.doMock('../agent-runtime-mirror.js', () => ({
    getRuntimeSnapshot: vi.fn(() => Effect.succeed(null)),
    isAgentStateServiceInProcess: vi.fn(() => Effect.succeed(true)),
  }));
  vi.doMock('../runtimes/codex.js', () => ({
    initCodexHome: vi.fn(),
  }));
  vi.doMock('../codex-auth.js', () => ({
    assertCodexNativeAuthForSpawn: vi.fn(),
  }));
  vi.doMock('../runtimes/pi-fifo.js', () => ({
    PiNotReady: class PiNotReady extends Error {
      readonly code = 'PI_NOT_READY';
    },
    createPiFifo: vi.fn(async (agentId: string) => join(tmpHome, 'agents', agentId, 'rpc.in')),
    piFifoPaths: vi.fn((agentId: string) => ({
      agentDir: join(tmpHome, 'agents', agentId),
      readyPath: join(tmpHome, 'agents', agentId, 'ready.json'),
      fifoPath: join(tmpHome, 'agents', agentId, 'rpc.in'),
    })),
    writePiCommand: vi.fn(),
  }));

  vi.doMock('../paths.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../paths.js')>();
    return {
      ...actual,
      AGENTS_DIR: join(tmpHome, 'agents'),
      packageRoot: packageRootDir,
    };
  });

  vi.doMock('../tmux.js', () => ({
    createSessionSync: vi.fn(),
    createSession: vi.fn((...args: unknown[]) => Effect.sync(() => createSessionMock(...args))),
    killSessionSync: vi.fn(),
    killSession: vi.fn(() => Effect.void),
    sendKeys: vi.fn(() => Effect.void),
    sendRawKeystroke: sendRawKeystrokeMock,
    sessionExistsSync: vi.fn(() => false),
    sessionExists: vi.fn(() => Effect.succeed(false)),
    getAgentSessionsSync: vi.fn(() => []),
    getAgentSessions: vi.fn(() => Effect.succeed([])),
    capturePaneSync: vi.fn(() => capturePaneText),
    capturePane: vi.fn(async () => capturePaneText),
    listPaneValuesSync: vi.fn(() => []),
    listPaneValues: vi.fn(async () => []),
    waitForClaudePrompt: vi.fn(async () => true),
    setOption: vi.fn(() => Effect.void),
    exactPaneTarget: vi.fn((name: string) => `=${name}:`),
  }));

  vi.doMock('../agents/registered-slot-spawn.js', async (importOriginal) => ({
    ...((await importOriginal()) as typeof import('../agents/registered-slot-spawn.js')),
    // Create the slot directory the real worktree call would have produced;
    // the spawn guard refuses a missing workspace.
    ensureRegisteredSlotWorktree: vi.fn(async (_issueId: string, _base: string, slot: { workspace: string }) => {
      mkdirSync(slot.workspace, { recursive: true });
    }),
  }));
  vi.doMock('../workspace/stack-health.js', () => ({
    getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [], lastObserved: null })),
  }));
  // PAN-3917 FR-5/W8: launchAgentPane auto-selects Herdr when the dev host has
  // a live `herdr` binary and `overdeck` session socket, which would make this
  // test drive the real Herdr session instead of the mocked tmux.js path. Force
  // tmux selection so createSessionMock stays the single source of truth.
  vi.doMock('../terminal-backends/select.js', async (importOriginal) => ({
    ...((await importOriginal()) as typeof import('../terminal-backends/select.js')),
    selectTerminalBackend: vi.fn(async () => ({ backend: 'tmux' as const, diagnostic: 'test: forced tmux backend' })),
  }));
  vi.doMock('../xbrief/io.js', async (importOriginal) => ({
    ...((await importOriginal()) as typeof import('../xbrief/io.js')),
    readWorkspacePlanSync: vi.fn(() => planFixture),
  }));
  vi.doMock('../activity-logger.js', () => ({
    emitActivityEntry: vi.fn(),
    emitActivityTts: vi.fn(),
  }));
  vi.doMock('../cloister/work-agent-prompt.js', () => ({
    writeStoryFeatureContext: vi.fn(async () => undefined),
  }));
  vi.doMock('../config-yaml.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../config-yaml.js')>();
    return {
      ...actual,
      isClaudeCodeChannelsMcpEnabled: () => channelsMcpEnabled,
      loadConfigSync: () => ({
        config: {
          workhorses: actual.DEFAULT_WORKHORSES,
          roles: { ...actual.DEFAULT_ROLES, work: { model: PARENT_DEFAULT_MODEL } },
          providerHarnesses: {},
          providerAuth: {},
          apiKeys: { kimi: 'test-kimi-key', zai: 'test-zai-key' },
          caveman: { enabled: false },
          enabledProviders: new Set(['anthropic', 'zai']),
          tieredExecution: tieredFixture,
        },
      }),
    };
  });
  vi.doMock('../claude-auth.js', () => ({
    getClaudeAuthStatus: vi.fn(() => Effect.succeed({ loggedIn: true, hasAnthropicApiKey: true })),
  }));
  vi.doMock('../openai-auth.js', () => ({
    getOpenAIAuthStatus: vi.fn(async () => ({ loggedIn: true, hasOpenAIApiKey: false })),
  }));
  vi.doMock('../cliproxy.js', async (importOriginal) => ({
    ...((await importOriginal()) as typeof import('../cliproxy.js')),
    bridgeGeminiAuthToCliproxy: vi.fn(async () => true),
    getCliproxyClientEnv: vi.fn(() => ({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:4141' })),
    isCliproxyRunning: vi.fn(async () => true),
  }));
  vi.doMock('../provider-health.js', () => ({
    validateProviderHealth: vi.fn(async () => undefined),
  }));
  // agents.ts now imports getFlywheelActiveRunId from overdeck/control-settings (not database/app-settings)
  vi.doMock('../overdeck/control-settings.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../overdeck/control-settings.js')>();
    return {
      ...actual,
      getFlywheelActiveRunId: () => activeFlywheelRunId,
    };
  });
  vi.doMock('../projects.js', async (importOriginal) => ({
    ...((await importOriginal()) as typeof import('../projects.js')),
    findProjectByPath: vi.fn(() => null),
  }));
}

beforeEach(() => {
  vi.resetModules();
  tmpHome = mkdtempSync(join(tmpdir(), 'pan-spawn-fitness-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-spawn-fitness-workspace-'));
  packageRootDir = mkdtempSync(join(tmpdir(), 'pan-spawn-fitness-package-'));
  // Seed overdeck.db so saveAgentStateSync can find the migration SQL
  closeOverdeckDatabase();
  createOverdeckDatabase({ dbPath: join(tmpHome, 'overdeck.db') });
  closeOverdeckDatabase();
  process.env.OVERDECK_HOME = tmpHome;
  process.env.OVERDECK_AGENT_STARTED_BY = 'test:agents-spawn-fitness';
  capturePaneText = 'Claude Code';
  planFixture = expertPlan();
  tieredFixture = TIERED_OFF;
  warnLines = [];
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnLines.push(args.map(String).join(' '));
  });
  channelsMcpEnabled = false;
  activeFlywheelRunId = null;
  delete process.env.PAN_DOCKER;
  delete process.env.OVERDECK_DOCKER_WORKSPACE;
  mockSpawnDependencies();
}, HEAVY_HOOK_TIMEOUT_MS);

afterEach(() => {
  warnSpy?.mockRestore();
  vi.doUnmock('../harness-resolve.js');
  vi.doUnmock('../harness-binary.js');
  vi.doUnmock('../agent-runtime.js');
  vi.doUnmock('../agents/hook-readiness.js');
  vi.doUnmock('../agents/delivery.js');
  vi.doUnmock('../agents/runtime-command.js');
  vi.doUnmock('../agents/termination.js');
  vi.doUnmock('../agent-runtime-mirror.js');
  vi.doUnmock('../runtimes/codex.js');
  vi.doUnmock('../codex-auth.js');
  vi.doUnmock('../runtimes/pi-fifo.js');
  vi.doUnmock('../paths.js');
  vi.doUnmock('../tmux.js');
  vi.doUnmock('../agents/registered-slot-spawn.js');
  vi.doUnmock('../workspace/stack-health.js');
  vi.doUnmock('../terminal-backends/select.js');
  vi.doUnmock('../xbrief/io.js');
  vi.doUnmock('../activity-logger.js');
  vi.doUnmock('../review-status.js');
  vi.doUnmock('../cloister/merge-agent.js');
  vi.doUnmock('../cloister/work-agent-prompt.js');
  vi.doUnmock('../config-yaml.js');
  vi.doUnmock('../claude-auth.js');
  vi.doUnmock('../openai-auth.js');
  vi.doUnmock('../cliproxy.js');
  vi.doUnmock('../provider-health.js');
  vi.doUnmock('../overdeck/control-settings.js');
  vi.doUnmock('../projects.js');
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  delete process.env.OVERDECK_AGENT_STARTED_BY;
  delete process.env.PAN_DOCKER;
  delete process.env.OVERDECK_DOCKER_WORKSPACE;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  rmSync(packageRootDir, { recursive: true, force: true });
}, HEAVY_HOOK_TIMEOUT_MS);


describe('single-work spawn emits the fitness warning for the model it launches', () => {
  it('warns on an explicit retired small model against an expert plan, and still spawns', async () => {
    // The adjudicated R4 case, driven through the real entry point:
    // glm-4.7-flash is launched verbatim and is small-class, so an expert plan
    // must warn. Before the classification fix it hopped to frontier glm-5.1
    // and said nothing.
    writeSupervisorArtifact();
    const { spawnAgent } = await import('../agents.js');

    const state = await spawnAgent({
      issueId: 'PAN-3842',
      workspace,
      role: 'work',
      model: RETIRED_SMALL_MODEL,
    });

    // Warning-only: the spawn completed and returned real agent state.
    expect(state.id).toBe('agent-pan-3842');
    expect(state.status).toBe('running');
    expect(state.model).toBe(RETIRED_SMALL_MODEL);

    const [line, ...rest] = fitnessLines();
    expect(rest).toEqual([]);
    expect(line).toContain(RETIRED_SMALL_MODEL);
    expect(line).toContain('small-class');
    expect(line).toContain('expert');
    expect(line).toContain('item-expert');
  });

  it('stays silent for an explicit frontier model on the same expert plan', async () => {
    writeSupervisorArtifact();
    const { spawnAgent } = await import('../agents.js');

    const state = await spawnAgent({
      issueId: 'PAN-3842',
      workspace,
      role: 'work',
      model: TIER_FRONTIER_MODEL,
    });

    expect(state.model).toBe(TIER_FRONTIER_MODEL);
    expect(fitnessLines()).toEqual([]);
  });

  it('names the model in the warning, never the role default it replaced', async () => {
    writeSupervisorArtifact();
    const { spawnAgent } = await import('../agents.js');

    await spawnAgent({
      issueId: 'PAN-3842',
      workspace,
      role: 'work',
      model: TIER_SMALL_MODEL,
    });

    const [line] = fitnessLines();
    expect(line).toContain(TIER_SMALL_MODEL);
    expect(line).not.toContain(PARENT_DEFAULT_MODEL);
  });
});

describe('slot spawn checks the staffed model, not the parent default', () => {
  // This is the ordering the earlier in-test simulator could not protect. The
  // slot path resolves a tier AFTER computing a parent default, so logging
  // before the reassignment described a model that never ran.
  it('stays silent when the tier staffs frontier for an expert item under a workhorse default', async () => {
    tieredFixture = tieredWith(TIER_FRONTIER_MODEL);
    writeSupervisorArtifact();
    const { spawnRun } = await import('../agents.js');

    const state = await spawnRun('PAN-3842', 'work', {
      workspace,
      slotIndex: 1,
      slotItemId: 'item-expert',
      startedBy: 'test:agents-spawn-fitness',
    });

    // The agent really is staffed frontier, so there is nothing to warn about.
    expect(state.model).toBe(TIER_FRONTIER_MODEL);
    // Logging the pre-reassignment parent default (workhorse) against an expert
    // item would have produced a spurious underpowered line here.
    expect(fitnessLines()).toEqual([]);
  });

  it('warns naming the staffed small model when the tier underpowers an expert item', async () => {
    tieredFixture = tieredWith(TIER_SMALL_MODEL);
    writeSupervisorArtifact();
    const { spawnRun } = await import('../agents.js');

    const state = await spawnRun('PAN-3842', 'work', {
      workspace,
      slotIndex: 1,
      slotItemId: 'item-expert',
      startedBy: 'test:agents-spawn-fitness',
    });

    expect(state.model).toBe(TIER_SMALL_MODEL);
    const [line, ...rest] = fitnessLines();
    expect(rest).toEqual([]);
    // The staffed model is what the operator must change — name it, not the
    // role default the slot started from.
    expect(line).toContain(TIER_SMALL_MODEL);
    expect(line).not.toContain(PARENT_DEFAULT_MODEL);
    expect(line).toContain('expert');
    expect(line).toContain('item-expert');
  });

  it('honours an explicit override on a slot and warns about that model', async () => {
    tieredFixture = tieredWith(TIER_FRONTIER_MODEL);
    writeSupervisorArtifact();
    const { spawnRun } = await import('../agents.js');

    const state = await spawnRun('PAN-3842', 'work', {
      workspace,
      slotIndex: 1,
      slotItemId: 'item-expert',
      model: RETIRED_SMALL_MODEL,
      startedBy: 'test:agents-spawn-fitness',
    });

    // Override precedence: the tier said frontier, the operator said otherwise.
    expect(state.model).toBe(RETIRED_SMALL_MODEL);
    const [line] = fitnessLines();
    expect(line).toContain(RETIRED_SMALL_MODEL);
    expect(line).toContain('small-class');
  });

  it('adds no tiered-execution abort of its own when the slot item is gone from the plan', async () => {
    // Slot registrations outlive plan edits. resolveSlotTierSpawnParams used to
    // throw "Tiered execution is enabled but item ... was not found" on this
    // path under an override — an abort the warning feature introduced.
    //
    // Honest scope: the spawn still fails here, at buildRegisteredSlotPrompt ->
    // createActiveSlice, which rejects a missing item independently of this
    // feature and predates it. What this test pins is that the failure is NOT
    // the tiered-execution one, so no new abort was added.
    tieredFixture = tieredWith(TIER_FRONTIER_MODEL);
    planFixture = expertPlan('item-renamed');
    writeSupervisorArtifact();
    const { spawnRun } = await import('../agents.js');

    await expect(spawnRun('PAN-3842', 'work', {
      workspace,
      slotIndex: 1,
      slotItemId: 'item-expert',
      model: RETIRED_SMALL_MODEL,
      startedBy: 'test:agents-spawn-fitness',
    })).rejects.toThrow('Plan item not found: item-expert');

    // The tiered-execution abort must not be what stopped it.
    await expect(spawnRun('PAN-3842', 'work', {
      workspace,
      slotIndex: 1,
      slotItemId: 'item-expert',
      model: RETIRED_SMALL_MODEL,
      startedBy: 'test:agents-spawn-fitness',
    })).rejects.not.toThrow('Tiered execution is enabled');
  });
});
