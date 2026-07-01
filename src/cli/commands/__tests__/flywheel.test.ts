import { Effect } from 'effect';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import type { FlywheelStats, FlywheelStatus } from '@overdeck/contracts';
import { getFlywheelRunDir, readFlywheelLaunchMetadata, subscribeLatestFlywheelStatus, writeFlywheelLaunchMetadata, writeLatestFlywheelStatus } from '../../../dashboard/server/services/flywheel-run-state.js';

const flywheelLifecycleMocks = vi.hoisted(() => ({
  paused: false,
  activeRunId: null as string | null,
  autoPickupBacklog: false,
  requireUatBeforeMerge: true,
  sessionExists: false,
  sessionExistsSync: false,
  stoppedAgents: [] as string[],
  pauseFlywheel: vi.fn(async () => {
    flywheelLifecycleMocks.paused = true;
  }),
  resumeFlywheel: vi.fn(async () => {
    flywheelLifecycleMocks.paused = false;
  }),
  spawnFlywheel: vi.fn(async ({ runId, model, harness }: { runId: string; model?: string; harness?: 'claude-code' | 'pi' }) => ({
    id: 'flywheel-orchestrator',
    issueId: runId,
    workspace: '/repo',
    harness,
    role: 'flywheel',
    model: model ?? 'claude-opus-4-7',
    status: 'running',
    startedAt: '2026-05-18T12:00:00.000Z',
  })),
  stopAgentProgram: vi.fn(),
}));

vi.mock('../../../lib/cloister/flywheel.js', () => ({
  FLYWHEEL_ORCHESTRATOR_AGENT_ID: 'flywheel-orchestrator',
  pauseFlywheel: flywheelLifecycleMocks.pauseFlywheel,
  resumeFlywheel: flywheelLifecycleMocks.resumeFlywheel,
  spawnFlywheel: flywheelLifecycleMocks.spawnFlywheel,
}));

vi.mock('../../../lib/overdeck/control-settings.js', () => ({
  FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY: 'flywheel.auto_pickup_backlog',
  FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY: 'flywheel.require_uat_before_merge',
  getFlywheelActiveRunId: () => flywheelLifecycleMocks.activeRunId,
  isFlywheelGloballyPaused: () => flywheelLifecycleMocks.paused,
  isFlywheelAutoPickupBacklog: () => flywheelLifecycleMocks.autoPickupBacklog,
  isFlywheelRequireUatBeforeMerge: () => flywheelLifecycleMocks.requireUatBeforeMerge,
  setFlywheelActiveRunId: (runId: string | null) => {
    flywheelLifecycleMocks.activeRunId = runId;
  },
  setFlywheelAutoPickupBacklog: (enabled: boolean) => {
    flywheelLifecycleMocks.autoPickupBacklog = enabled;
  },
  setFlywheelGloballyPaused: (paused: boolean) => {
    flywheelLifecycleMocks.paused = paused;
  },
  setFlywheelRequireUatBeforeMerge: (required: boolean) => {
    flywheelLifecycleMocks.requireUatBeforeMerge = required;
  },
}));

vi.mock('../../../lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    sessionExists: vi.fn(() => Effect.succeed(flywheelLifecycleMocks.sessionExists)),
    sessionExistsSync: vi.fn(() => Effect.succeed(flywheelLifecycleMocks.sessionExists)),
  };
});

vi.mock('../../../lib/agents.js', async () => {
  const { Effect } = await import('effect');
  flywheelLifecycleMocks.stopAgentProgram.mockImplementation((agentId: string) => Effect.sync(() => {
    flywheelLifecycleMocks.stoppedAgents.push(agentId);
  }));
  return {
    stopAgent: flywheelLifecycleMocks.stopAgentProgram,
    stopAgentProgram: flywheelLifecycleMocks.stopAgentProgram,
  };
});

const mockLoadConfig = vi.hoisted(() => () => ({
  config: {
    roles: {
      flywheel: {
        harness: 'claude-code',
        model: 'claude-sonnet-4-6',
        effort: 'low',
        maxAgents: 3,
        scope: 'all-tracked-projects',
      },
    },
    workhorses: {},
  },
}));

vi.mock('../../../lib/config-yaml.js', () => ({
  loadConfig: mockLoadConfig,
  loadConfigSync: mockLoadConfig,
  resolveModel: () => 'claude-sonnet-4-6',
}));

// Harness is provider-default-only (PAN-1984): the flywheel start path derives it from the
// model via resolveHarness, NOT from the per-role config. Mock it so this unit test doesn't
// shell out to `command -v`; the real derivation is covered by harness-resolve.test.ts.
vi.mock('../../../lib/harness-resolve.js', () => ({
  resolveHarness: vi.fn(async () => 'claude-code'),
}));

const mergeBackendMocks = vi.hoisted(() => ({
  getMergeBackendStatus: vi.fn(async () => ({
    available: true,
    mode: 'gh-cli' as const,
    detail: 'gh CLI is authenticated',
  })),
}));

vi.mock('../../../lib/github-app.js', () => mergeBackendMocks);

import {
  emitStatusCommand,
  flywheelAbortCommand,
  flywheelConfigCommand,
  flywheelPauseCommand,
  flywheelReportCommand,
  flywheelResumeCommand,
  flywheelStopCommand,
  formatFlywheelStateReport,
  flywheelStartCommand,
  flywheelStatsCommand,
  flywheelStatusCommand,
  formatFlywheelStats,
  parseFlywheelStatusJson,
  readFlywheelStatusJson,
  registerFlywheelCommands,
} from '../flywheel.js';

const execFileAsync = promisify(execFile);

const validStatus: FlywheelStatus = {
  runId: 'RUN-1',
  startedAt: '2026-05-18T12:00:00.000Z',
  elapsedMs: 1000,
  orchestrator: {
    harness: 'claude-code',
    model: 'claude-opus-4-7',
    effort: 'high',
    ctxPercent: 42,
  },
  headline: {
    bugsFixed: 1,
    swarmItemsMerged: 2,
    swarmItemsTotal: 3,
    prsMerged: 4,
    awaitingUat: 5,
  },
  activePipeline: [],
  substrateBugs: [],
  agents: [],
  parked: [],
  suggestions: [],
  system: {
    mainHead: 'abc1234',
    ramUsedMb: 1024,
    ramTotalMb: 4096,
    swapUsedMb: 0,
    swapTotalMb: 1024,
    agentsActive: 1,
    agentsCap: 8,
  },
  openQuestions: [],
  ticks: 1,
  lastTickAt: '2026-05-18T12:00:00.000Z',
};

const validStats: FlywheelStats = {
  window: '30d',
  generatedAt: '2026-05-25T10:00:00.000Z',
  criteria: {
    c1_bugRate: { label: 'Substrate-bug discovery rate', value: 0.01, target: 0.02, status: 'green', trend: 'down', sampleSize: 120, dataSufficient: true },
    c2_p0Bugs: { label: 'Critical/P0 substrate bugs', value: 0, target: 0, status: 'green', sampleSize: 120, dataSufficient: true },
    c3_passRate: { label: 'Pipeline pass success rate', value: 0.995, target: 0.99, status: 'green', trend: 'up', sampleSize: 120, dataSufficient: true },
    c4_mttr: { label: 'MTTR for filed substrate bugs', value: { medianMs: 3_600_000, p95Ms: 86_400_000 }, target: { medianMs: 86_400_000, p95Ms: 604_800_000 }, status: 'yellow', trend: 'flat', sampleSize: 12, dataSufficient: true },
    c5_intervention: { label: 'Operator intervention rate', value: 0.02, target: 0.05, status: 'green', sampleSize: 120, dataSufficient: true },
    c6_timeConsistency: { label: 'Time-in-pipeline consistency', value: { simple: 1.1, medium: 1.4, complex: 1.8 }, target: { maxRatio: 2 }, status: 'green', sampleSize: 87, dataSufficient: true },
    c7_flake: { label: 'Substrate-attributable flake rate', value: 0.03, target: 0.05, status: 'red', sampleSize: 20, dataSufficient: true },
  },
};

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout.trim();
}

async function createReportRepo(root: string): Promise<string> {
  const repoDir = join(root, 'repo');
  await mkdir(join(repoDir, 'docs'), { recursive: true });
  await writeFile(join(repoDir, 'docs', '.placeholder'), '', 'utf8');
  await git(repoDir, ['init']);
  await git(repoDir, ['add', 'docs/.placeholder']);
  await git(repoDir, ['-c', 'user.name=Overdeck Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'docs: seed repo']);
  return repoDir;
}

describe('formatFlywheelStateReport', () => {
  it('renders populated suggestions before the active pipeline and escapes table cells', () => {
    const report = formatFlywheelStateReport({
      ...validStatus,
      suggestions: [
        {
          priority: 'urgent',
          action: 'investigate',
          issueId: 'PAN-9',
          rationale: 'Route | gate\nneeds root-cause fix',
        },
      ],
    });

    expect(report.indexOf('## Suggestions')).toBeLessThan(report.indexOf('## Active Pipeline'));
    expect(report).toContain('| Priority | Action | Issue | Rationale |');
    expect(report).toContain('| urgent | investigate | PAN-9 | Route \\| gate needs root-cause fix |');
  });

  it('renders an empty suggestions message', () => {
    const report = formatFlywheelStateReport({ ...validStatus, suggestions: [] });

    expect(report).toContain('## Suggestions\n\nNo suggestions emitted this run.');
  });
});

describe('flywheel CLI commands', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pan-flywheel-'));
    process.exitCode = undefined;
    process.env.OVERDECK_HOME = tempDir;
    process.env.OVERDECK_DASHBOARD_URL = 'http://dashboard.test';
    vi.stubEnv('GIT_AUTHOR_NAME', 'Overdeck Test');
    vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@example.com');
    vi.stubEnv('GIT_COMMITTER_NAME', 'Overdeck Test');
    vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@example.com');
    flywheelLifecycleMocks.paused = false;
    flywheelLifecycleMocks.activeRunId = null;
    flywheelLifecycleMocks.autoPickupBacklog = false;
    flywheelLifecycleMocks.requireUatBeforeMerge = true;
    flywheelLifecycleMocks.sessionExists = false;
    flywheelLifecycleMocks.stoppedAgents = [];
    flywheelLifecycleMocks.pauseFlywheel.mockClear();
    flywheelLifecycleMocks.resumeFlywheel.mockClear();
    flywheelLifecycleMocks.spawnFlywheel.mockClear();
    flywheelLifecycleMocks.stopAgentProgram.mockClear();
    mergeBackendMocks.getMergeBackendStatus.mockResolvedValue({
      available: true,
      mode: 'gh-cli',
      detail: 'gh CLI is authenticated',
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete process.env.OVERDECK_HOME;
    delete process.env.OVERDECK_DASHBOARD_URL;
    process.exitCode = undefined;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('validates and posts a status file', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const statusPath = join(tempDir, 'status.json');
    await writeFile(statusPath, JSON.stringify(validStatus));

    await emitStatusCommand({ file: statusPath });

    expect(fetchMock).toHaveBeenCalledWith('http://dashboard.test/api/flywheel/status', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'x-overdeck-internal-token': expect.any(String),
      }),
      body: JSON.stringify(validStatus),
    }));
    expect(logSpy).toHaveBeenCalledWith('Flywheel status emitted for RUN-1');
    expect(process.exitCode).toBeUndefined();
  });

  it('rejects schema-invalid input before making a network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const statusPath = join(tempDir, 'status.json');
    const invalidStatus: Partial<FlywheelStatus> = { ...validStatus };
    delete invalidStatus.runId;
    await writeFile(statusPath, JSON.stringify(invalidStatus));

    await emitStatusCommand({ file: statusPath });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('runId'));
  });

  it('reads stdin when --file is - and reports bad JSON clearly', async () => {
    const raw = await readFlywheelStatusJson('-', Readable.from(['{"runId"']));

    expect(() => parseFlywheelStatusJson(raw)).toThrow(/Invalid JSON/);
  });

  it('renders human-readable active run status', async () => {
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    await writeLatestFlywheelStatus(validStatus);

    await flywheelStatusCommand({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Run: RUN-1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Elapsed: 1s'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Bugs fixed: 1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SWARM items: 2/3'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('PRs merged: 4'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Awaiting UAT: 5'));
    // PAN-1528: agentsActive is now overlaid with the live work-agent count
    // from disk. The test overdeckHome has no agents, so the count is 0.
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Active agents: 0/8'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('RAM: 1024 MiB used / 4096 MiB total'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Last tick: 2026-05-18T12:00:00.000Z'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Merge backend: gh-cli (gh CLI is authenticated)'));
    expect(process.exitCode).toBeUndefined();
  });

  it('renders an unavailable merge backend in human-readable active run status', async () => {
    mergeBackendMocks.getMergeBackendStatus.mockResolvedValue({
      available: false,
      mode: 'none',
      detail: 'No GitHub App credentials or gh CLI authentication found',
    });
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    await writeLatestFlywheelStatus(validStatus);

    await flywheelStatusCommand({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(
      'Merge backend: UNAVAILABLE - No GitHub App credentials or gh CLI authentication found',
    ));
  });

  it('emits raw FlywheelStatus JSON with --json', async () => {
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    await writeLatestFlywheelStatus(validStatus);

    await flywheelStatusCommand({ json: true });

    const output = logSpy.mock.calls[0][0] as string;
    // PAN-1528: agentsActive overlaid with live count (0 in test home).
    expect(JSON.parse(output)).toEqual({
      ...validStatus,
      system: { ...validStatus.system, agentsActive: 0 },
      mergeBackend: {
        available: true,
        mode: 'gh-cli',
        detail: 'gh CLI is authenticated',
      },
    });
  });

  it('prints a seven-row stats table with the default 30-day window', async () => {
    const fetchMock = vi.fn(async () => Response.json(validStats));
    vi.stubGlobal('fetch', fetchMock);

    await flywheelStatsCommand({});

    expect(fetchMock).toHaveBeenCalledWith('http://dashboard.test/api/flywheel/stats?window=30d', expect.objectContaining({
      headers: expect.objectContaining({ 'x-overdeck-internal-token': expect.any(String) }),
    }));
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('Flywheel stats (30d)');
    expect(output).toContain('| Criterion | Value | Target | Status | Trend | Sample |');
    expect(output).toContain('| Substrate-bug discovery rate | 1.0% | 2.0% | ● green | ↘ down | 120 |');
    expect(output).toContain('| Substrate-attributable flake rate | 3.0% | 5.0% | ● red | — | 20 |');
    expect(output.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('|---') && !line.startsWith('| Criterion'))).toHaveLength(7);
    expect(process.exitCode).toBeUndefined();
  });

  it('queries stats with an explicit window', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ...validStats, window: '7d' }));
    vi.stubGlobal('fetch', fetchMock);

    await flywheelStatsCommand({ window: '7d' });

    expect(fetchMock).toHaveBeenCalledWith('http://dashboard.test/api/flywheel/stats?window=7d', expect.any(Object));
    expect(logSpy.mock.calls[0][0]).toContain('Flywheel stats (7d)');
  });

  it('emits raw FlywheelStats JSON with --json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(validStats)));

    await flywheelStatsCommand({ json: true });

    const output = logSpy.mock.calls[0][0] as string;
    expect(JSON.parse(output)).toEqual(validStats);
  });

  it('colors stats status glyphs when formatting for a TTY', () => {
    const output = formatFlywheelStats(validStats, { color: true });

    expect(output).toContain('\x1b[32m●\x1b[0m green');
    expect(output).toContain('\x1b[31m●\x1b[0m red');
  });

  it('exits 1 when no active run exists', async () => {
    await flywheelStatusCommand({});

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('no active flywheel run');
  });

  it('prints all flywheel config values', async () => {
    await flywheelConfigCommand({ get: true });

    expect(logSpy).toHaveBeenCalledWith([
      'flywheel.auto_pickup_backlog=false',
      'flywheel.require_uat_before_merge=true',
    ].join('\n'));
    expect(process.exitCode).toBeUndefined();
  });

  it('prints one flywheel config value', async () => {
    await flywheelConfigCommand({ get: 'flywheel.require_uat_before_merge' });

    expect(logSpy).toHaveBeenCalledWith('flywheel.require_uat_before_merge=true');
    expect(process.exitCode).toBeUndefined();
  });

  it('sets one flywheel config value', async () => {
    await flywheelConfigCommand({ set: 'flywheel.auto_pickup_backlog=true' });

    expect(flywheelLifecycleMocks.autoPickupBacklog).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('flywheel.auto_pickup_backlog=true');
    expect(process.exitCode).toBeUndefined();
  });

  it('rejects unknown flywheel config keys', async () => {
    await flywheelConfigCommand({ set: 'unknown.key=true' });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Unknown flywheel config key: unknown.key');
  });

  it('rejects non-boolean flywheel config values', async () => {
    await flywheelConfigCommand({ set: 'flywheel.auto_pickup_backlog=maybe' });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Boolean value required for flywheel.auto_pickup_backlog: maybe');
  });

  it('starts a flywheel run with the default brief and writes initial state', async () => {
    await mkdir(join(tempDir, 'docs'), { recursive: true });
    await writeFile(join(tempDir, 'docs', 'flywheel-brief.md'), '# Flywheel Brief\n', 'utf8');

    await flywheelStartCommand({ cwd: tempDir });

    expect(flywheelLifecycleMocks.spawnFlywheel).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'RUN-1',
      briefPath: join(tempDir, 'docs', 'flywheel-brief.md'),
      workspace: tempDir,
      harness: 'claude-code',
      model: 'claude-sonnet-4-6',
      effort: 'low',
      maxAgents: 3,
      scope: 'all-tracked-projects',
      autoPickupBacklog: false,
      requireUatBeforeMerge: true,
    }));
    const latest = JSON.parse(await readFile(join(tempDir, 'flywheel', 'runs', 'RUN-1', 'latest.json'), 'utf8')) as FlywheelStatus;
    const launch = await readFlywheelLaunchMetadata('RUN-1');
    expect(latest.runId).toBe('RUN-1');
    expect(launch).toMatchObject({
      runId: 'RUN-1',
      workspace: tempDir,
      briefPath: join(tempDir, 'docs', 'flywheel-brief.md'),
      briefDisplayPath: 'docs/flywheel-brief.md',
    });
    expect(latest.orchestrator).toMatchObject({ harness: 'claude-code', model: 'claude-sonnet-4-6', effort: 'low' });
    expect(latest.system.agentsCap).toBe(3);
    expect(latest.agents[0]?.id).toBe('flywheel-orchestrator');
    expect(logSpy).toHaveBeenCalledWith('Flywheel started: RUN-1');
    expect(logSpy).toHaveBeenCalledWith('Brief: docs/flywheel-brief.md');
    expect(logSpy).toHaveBeenCalledWith('Run URL: http://dashboard.test/flywheel');
    expect(process.exitCode).toBeUndefined();
  });

  it('starts a flywheel run with a brief override', async () => {
    await writeFile(join(tempDir, 'some-brief.md'), '# Custom Brief\n', 'utf8');

    await flywheelStartCommand({ cwd: tempDir, brief: './some-brief.md' });

    expect(flywheelLifecycleMocks.spawnFlywheel).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'RUN-1',
      briefPath: join(tempDir, 'some-brief.md'),
      workspace: tempDir,
    }));
    expect(logSpy).toHaveBeenCalledWith('Brief: some-brief.md');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a missing flywheel brief clearly', async () => {
    await flywheelStartCommand({ cwd: tempDir, brief: './missing.md' });

    expect(flywheelLifecycleMocks.spawnFlywheel).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Flywheel brief not found: missing.md');
  });

  it('rejects a brief symlink that resolves outside the project root', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'pan-flywheel-outside-'));
    await writeFile(join(outsideDir, 'brief.md'), '# Outside\n', 'utf8');
    await symlink(join(outsideDir, 'brief.md'), join(tempDir, 'brief-link.md'));

    await flywheelStartCommand({ cwd: tempDir, brief: './brief-link.md' });

    expect(flywheelLifecycleMocks.spawnFlywheel).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Brief path must stay inside the project root');
    await rm(outsideDir, { recursive: true, force: true });
  });

  it('surfaces the active run gate when start is refused', async () => {
    await mkdir(join(tempDir, 'docs'), { recursive: true });
    await writeFile(join(tempDir, 'docs', 'flywheel-brief.md'), '# Flywheel Brief\n', 'utf8');
    flywheelLifecycleMocks.spawnFlywheel.mockRejectedValueOnce(new Error('Flywheel run RUN-7 is already active; pause, resume, or report it before starting another run'));

    await flywheelStartCommand({ cwd: tempDir });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Flywheel run RUN-7 is already active; pause, resume, or report it before starting another run');
  });

  it('pauses the flywheel and prints before/after gate state', async () => {
    flywheelLifecycleMocks.activeRunId = 'RUN-1';

    await flywheelPauseCommand();

    expect(flywheelLifecycleMocks.pauseFlywheel).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('Flywheel paused: before paused=false active_run_id=RUN-1; after paused=true active_run_id=RUN-1');
    expect(process.exitCode).toBeUndefined();
  });

  it('treats pause while already paused as an idempotent notice', async () => {
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    flywheelLifecycleMocks.paused = true;

    await flywheelPauseCommand();

    expect(flywheelLifecycleMocks.pauseFlywheel).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('Flywheel already paused (paused=true active_run_id=RUN-1)');
    expect(process.exitCode).toBeUndefined();
  });

  it('resumes the flywheel with the original workspace and brief metadata', async () => {
    const repoDir = join(tempDir, 'repo');
    await mkdir(repoDir, { recursive: true });
    const briefPath = join(repoDir, 'some-brief.md');
    await writeFile(briefPath, '# Resume Brief\n', 'utf8');
    await writeFlywheelLaunchMetadata({
      version: 1,
      runId: 'RUN-1',
      workspace: repoDir,
      briefPath,
      briefDisplayPath: 'some-brief.md',
    });
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    flywheelLifecycleMocks.paused = true;

    await flywheelResumeCommand();

    expect(flywheelLifecycleMocks.resumeFlywheel).toHaveBeenCalledWith(expect.objectContaining({
      workspace: repoDir,
      briefPath,
      harness: 'claude-code',
      model: 'claude-sonnet-4-6',
      effort: 'low',
      maxAgents: 3,
      scope: 'all-tracked-projects',
      autoPickupBacklog: false,
      requireUatBeforeMerge: true,
    }));
    expect(logSpy).toHaveBeenCalledWith('Flywheel resumed: before paused=true active_run_id=RUN-1; after paused=false active_run_id=RUN-1');
    expect(process.exitCode).toBeUndefined();
  });

  it('refuses to resume legacy runs without launch metadata', async () => {
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    flywheelLifecycleMocks.paused = true;

    await flywheelResumeCommand();

    expect(flywheelLifecycleMocks.resumeFlywheel).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Flywheel run RUN-1 is missing launch metadata; cannot resume safely');
    expect(process.exitCode).toBe(1);
  });

  it('treats resume while already running as an idempotent notice', async () => {
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    flywheelLifecycleMocks.paused = false;
    flywheelLifecycleMocks.sessionExists = true;

    await flywheelResumeCommand();

    expect(flywheelLifecycleMocks.resumeFlywheel).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('Flywheel already running (paused=false active_run_id=RUN-1)');
    expect(process.exitCode).toBeUndefined();
  });

  it('writes a per-run report under the run directory and does not touch FLYWHEEL-STATE.md', async () => {
    const repoDir = await createReportRepo(tempDir);
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    flywheelLifecycleMocks.paused = true;
    const received: Array<FlywheelStatus | null> = [];
    const unsubscribe = subscribeLatestFlywheelStatus((next) => received.push(next));
    await writeLatestFlywheelStatus({
      ...validStatus,
      activePipeline: [{ issueId: 'PAN-1', title: 'Pipeline item', verb: 'working', status: 'running', progressPercent: 50, pr: 123 }],
      substrateBugs: [{ issueId: 'PAN-2', title: 'Substrate bug', status: 'fixed', commitSha: 'abcdef1234567890' }],
      parked: [{ issueId: 'PAN-3', title: 'Parked item', reason: 'waiting on UAT' }],
      openQuestions: ['Should the next tick resume PAN-3?'],
    });

    const commitsBefore = await git(repoDir, ['rev-list', '--count', 'HEAD']);

    await flywheelReportCommand({ cwd: repoDir });
    unsubscribe();

    const runReport = await readFile(join(tempDir, 'flywheel', 'runs', 'RUN-1', 'report.md'), 'utf8');
    expect(runReport).toContain('# Flywheel Run 1 Report — 2026-05-18');
    expect(runReport).toContain('| PAN-1 | working | running | Pipeline item | 50 | 123 |');
    expect(runReport).toContain('| PAN-2 | fixed | Substrate bug | abcdef1234 |');

    await expect(readFile(join(repoDir, 'docs', 'FLYWHEEL-STATE.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(await git(repoDir, ['rev-list', '--count', 'HEAD'])).toBe(commitsBefore);
    expect(flywheelLifecycleMocks.activeRunId).toBeNull();
    expect(flywheelLifecycleMocks.paused).toBe(false);
    expect(received.at(-1)).toBeNull();

    flywheelLifecycleMocks.spawnFlywheel.mockClear();
    await writeFile(join(repoDir, 'docs', 'flywheel-brief.md'), '# Flywheel Brief\n', 'utf8');
    await flywheelStartCommand({ cwd: repoDir });

    expect(flywheelLifecycleMocks.spawnFlywheel).toHaveBeenCalledWith(expect.objectContaining({ runId: 'RUN-2' }));
    expect(process.exitCode).toBeUndefined();
  });

  it('commits orchestrator-authored changes to FLYWHEEL-STATE.md', async () => {
    const repoDir = await createReportRepo(tempDir);
    await writeLatestFlywheelStatus(validStatus);
    await writeFile(join(repoDir, 'docs', 'FLYWHEEL-STATE.md'), '# Flywheel State\n\nFirst observation.\n', 'utf8');

    await flywheelReportCommand({ cwd: repoDir });

    expect(await git(repoDir, ['log', '-1', '--format=%s'])).toBe('docs(flywheel): run 1');
    expect(await git(repoDir, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).toBe('docs/FLYWHEEL-STATE.md');
    expect(await readFile(join(repoDir, 'docs', 'FLYWHEEL-STATE.md'), 'utf8')).toContain('First observation.');
  });

  it('does not create a commit when FLYWHEEL-STATE.md is unchanged', async () => {
    const repoDir = await createReportRepo(tempDir);
    await writeLatestFlywheelStatus(validStatus);
    const commitsBefore = await git(repoDir, ['rev-list', '--count', 'HEAD']);

    await flywheelReportCommand({ cwd: repoDir });

    expect(await git(repoDir, ['rev-list', '--count', 'HEAD'])).toBe(commitsBefore);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No FLYWHEEL-STATE.md changes to commit'));
  });

  it('amends the run commit when FLYWHEEL-STATE.md changes again', async () => {
    const repoDir = await createReportRepo(tempDir);
    await writeLatestFlywheelStatus(validStatus);
    await writeFile(join(repoDir, 'docs', 'FLYWHEEL-STATE.md'), '# Flywheel State\n\nFirst observation.\n', 'utf8');
    await flywheelReportCommand({ cwd: repoDir });
    const firstCommit = await git(repoDir, ['rev-parse', 'HEAD']);

    await writeFile(join(repoDir, 'docs', 'FLYWHEEL-STATE.md'), '# Flywheel State\n\nFirst observation.\n\nSecond observation.\n', 'utf8');
    await flywheelReportCommand({ cwd: repoDir });

    expect(await git(repoDir, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(await git(repoDir, ['rev-parse', 'HEAD'])).not.toBe(firstCommit);
    expect(await git(repoDir, ['log', '-1', '--format=%s'])).toBe('docs(flywheel): run 1');
    expect(await readFile(join(repoDir, 'docs', 'FLYWHEEL-STATE.md'), 'utf8')).toContain('Second observation.');
  });

  // Guard: pan flywheel report finalizes the run (writes report.md, clears
  // the active-run gate, flips deriveRunStatus to 'complete'). Running it
  // mid-flight silently terminates a live run, which surprised an operator
  // who invoked it expecting a read-only snapshot. The guard refuses when
  // the orchestrator session is alive; the orchestrator's own end-of-run
  // call passes --force.
  it('refuses to write a report while the orchestrator session is alive', async () => {
    const repoDir = await createReportRepo(tempDir);
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    flywheelLifecycleMocks.paused = false;
    flywheelLifecycleMocks.sessionExists = true;
    await writeLatestFlywheelStatus(validStatus);

    await flywheelReportCommand({ cwd: repoDir });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Refusing to write report'));
    // Gate must NOT have been cleared.
    expect(flywheelLifecycleMocks.activeRunId).toBe('RUN-1');
    // report.md must NOT have been written.
    await expect(readFile(join(tempDir, 'flywheel', 'runs', 'RUN-1', 'report.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });

    process.exitCode = undefined;
  });

  it('writes the report under --force even when the orchestrator session is alive', async () => {
    const repoDir = await createReportRepo(tempDir);
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    flywheelLifecycleMocks.paused = false;
    flywheelLifecycleMocks.sessionExists = true;
    await writeLatestFlywheelStatus(validStatus);

    await flywheelReportCommand({ cwd: repoDir, force: true });

    expect(process.exitCode).toBeUndefined();
    const runReport = await readFile(join(tempDir, 'flywheel', 'runs', 'RUN-1', 'report.md'), 'utf8');
    expect(runReport).toContain('# Flywheel Run 1 Report');
    // Gate cleared as before.
    expect(flywheelLifecycleMocks.activeRunId).toBeNull();
  });

  // PAN-1245: report must clear the gate even when the cwd is not a git
  // repo. Previously isFlywheelStateDirty threw on non-git cwd and the gate
  // stayed stuck, blocking the next pan flywheel start.
  it('clears the active-run gate even when run from a non-git directory', async () => {
    const nonRepoDir = await mkdtemp(join(tmpdir(), 'pan-flywheel-noreport-'));
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    flywheelLifecycleMocks.paused = true;
    await writeLatestFlywheelStatus(validStatus);

    await flywheelReportCommand({ cwd: nonRepoDir });

    expect(flywheelLifecycleMocks.activeRunId).toBeNull();
    expect(flywheelLifecycleMocks.paused).toBe(false);
    expect(process.exitCode).toBeUndefined();
    await rm(nonRepoDir, { recursive: true, force: true });
  });

  // PAN-1245: abort is the discard affordance for stuck runs (orchestrator
  // dead post-reboot, run never produced useful output, etc.). Writes
  // aborted.json, stops the orchestrator, clears the gate. Idempotent.
  it('aborts the active run and clears the gate', async () => {
    flywheelLifecycleMocks.activeRunId = 'RUN-3';
    flywheelLifecycleMocks.paused = true;
    await writeLatestFlywheelStatus({ ...validStatus, runId: 'RUN-3' });

    await flywheelAbortCommand();

    const aborted = JSON.parse(
      await readFile(join(getFlywheelRunDir('RUN-3'), 'aborted.json'), 'utf8'),
    ) as { runId: string; abortedAt: string };
    expect(aborted.runId).toBe('RUN-3');
    expect(flywheelLifecycleMocks.stoppedAgents).toContain('flywheel-orchestrator');
    expect(flywheelLifecycleMocks.activeRunId).toBeNull();
    expect(flywheelLifecycleMocks.paused).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('Aborted flywheel run RUN-3.');
    expect(process.exitCode).toBeUndefined();
  });

  it('treats abort with no active run as an idempotent notice', async () => {
    await flywheelAbortCommand();

    expect(flywheelLifecycleMocks.stoppedAgents).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('No active flywheel run to abort.');
    expect(process.exitCode).toBeUndefined();
  });

  it('registers flywheel subcommands with their flags', () => {
    const program = new Command();
    registerFlywheelCommands(program);

    const flywheel = program.commands.find(command => command.name() === 'flywheel');
    const start = flywheel?.commands.find(command => command.name() === 'start');
    const emitStatus = flywheel?.commands.find(command => command.name() === 'emit-status');
    const config = flywheel?.commands.find(command => command.name() === 'config');
    const status = flywheel?.commands.find(command => command.name() === 'status');
    const stats = flywheel?.commands.find(command => command.name() === 'stats');
    const pause = flywheel?.commands.find(command => command.name() === 'pause');
    const resume = flywheel?.commands.find(command => command.name() === 'resume');
    const report = flywheel?.commands.find(command => command.name() === 'report');
    const stop = flywheel?.commands.find(command => command.name() === 'stop');
    const abort = flywheel?.commands.find(command => command.name() === 'abort');
    expect(start?.options.map(option => option.long)).toContain('--brief');
    expect(emitStatus?.options.map(option => option.long)).toContain('--file');
    expect(config?.options.map(option => option.long)).toEqual(expect.arrayContaining(['--get', '--set']));
    expect(status?.options.map(option => option.long)).toContain('--json');
    expect(stats?.options.map(option => option.long)).toEqual(expect.arrayContaining(['--window', '--json']));
    expect(pause).toBeDefined();
    expect(resume).toBeDefined();
    expect(report).toBeDefined();
    expect(stop).toBeDefined();
    expect(abort).toBeDefined();
  });

  it('stops a live orchestrator session even when paused and writes the report', async () => {
    const repoDir = await createReportRepo(tempDir);
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    flywheelLifecycleMocks.paused = true;
    flywheelLifecycleMocks.sessionExists = true;
    await writeLatestFlywheelStatus(validStatus);

    await flywheelStopCommand();

    expect(flywheelLifecycleMocks.stoppedAgents).toContain('flywheel-orchestrator');
    const runReport = await readFile(join(tempDir, 'flywheel', 'runs', 'RUN-1', 'report.md'), 'utf8');
    expect(runReport).toContain('# Flywheel Run 1 Report');
    expect(flywheelLifecycleMocks.activeRunId).toBeNull();
    expect(flywheelLifecycleMocks.paused).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it('treats stop with nothing active as an idempotent notice', async () => {
    await flywheelStopCommand();

    expect(flywheelLifecycleMocks.stoppedAgents).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('No flywheel run is active and nothing is left to report.');
    expect(process.exitCode).toBeUndefined();
  });
});
