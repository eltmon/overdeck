import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import type { FlywheelStatus } from '@panctl/contracts';
import { writeLatestFlywheelStatus } from '../../../dashboard/server/services/flywheel-run-state.js';

const flywheelLifecycleMocks = vi.hoisted(() => ({
  paused: false,
  activeRunId: null as string | null,
  sessionExists: false,
  pauseFlywheel: vi.fn(async () => {
    flywheelLifecycleMocks.paused = true;
  }),
  resumeFlywheel: vi.fn(async () => {
    flywheelLifecycleMocks.paused = false;
  }),
  spawnFlywheel: vi.fn(async ({ runId }: { runId: string }) => ({
    id: 'flywheel-orchestrator',
    issueId: runId,
    workspace: '/repo',
    role: 'flywheel',
    model: 'claude-opus-4-7',
    status: 'running',
    startedAt: '2026-05-18T12:00:00.000Z',
  })),
}));

vi.mock('../../../lib/cloister/flywheel.js', () => ({
  FLYWHEEL_ORCHESTRATOR_AGENT_ID: 'flywheel-orchestrator',
  pauseFlywheel: flywheelLifecycleMocks.pauseFlywheel,
  resumeFlywheel: flywheelLifecycleMocks.resumeFlywheel,
  spawnFlywheel: flywheelLifecycleMocks.spawnFlywheel,
}));

vi.mock('../../../lib/database/app-settings.js', () => ({
  getFlywheelActiveRunId: () => flywheelLifecycleMocks.activeRunId,
  isFlywheelGloballyPaused: () => flywheelLifecycleMocks.paused,
  setFlywheelActiveRunId: (runId: string | null) => {
    flywheelLifecycleMocks.activeRunId = runId;
  },
  setFlywheelGloballyPaused: (paused: boolean) => {
    flywheelLifecycleMocks.paused = paused;
  },
}));

vi.mock('../../../lib/tmux.js', () => ({
  sessionExistsAsync: vi.fn(async () => flywheelLifecycleMocks.sessionExists),
}));

import {
  emitStatusCommand,
  flywheelPauseCommand,
  flywheelReportCommand,
  flywheelResumeCommand,
  flywheelStartCommand,
  flywheelStatusCommand,
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

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout.trim();
}

async function createReportRepo(root: string): Promise<string> {
  const repoDir = join(root, 'repo');
  await mkdir(join(repoDir, 'docs'), { recursive: true });
  await writeFile(join(repoDir, 'docs', 'OPERATION-FIX-ALL.md'), '# Operation Fix-All\n\n## Run Log\n', 'utf8');
  await git(repoDir, ['init']);
  await git(repoDir, ['add', 'docs/OPERATION-FIX-ALL.md']);
  await git(repoDir, ['-c', 'user.name=Panopticon Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'docs: seed operation log']);
  return repoDir;
}

describe('flywheel CLI commands', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pan-flywheel-'));
    process.exitCode = undefined;
    process.env.PANOPTICON_HOME = tempDir;
    process.env.PANOPTICON_DASHBOARD_URL = 'http://dashboard.test';
    vi.stubEnv('GIT_AUTHOR_NAME', 'Panopticon Test');
    vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@example.com');
    vi.stubEnv('GIT_COMMITTER_NAME', 'Panopticon Test');
    vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@example.com');
    flywheelLifecycleMocks.paused = false;
    flywheelLifecycleMocks.activeRunId = null;
    flywheelLifecycleMocks.sessionExists = false;
    flywheelLifecycleMocks.pauseFlywheel.mockClear();
    flywheelLifecycleMocks.resumeFlywheel.mockClear();
    flywheelLifecycleMocks.spawnFlywheel.mockClear();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete process.env.PANOPTICON_HOME;
    delete process.env.PANOPTICON_DASHBOARD_URL;
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
      headers: { 'Content-Type': 'application/json' },
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
    await writeLatestFlywheelStatus(validStatus);

    await flywheelStatusCommand({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Run: RUN-1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Elapsed: 1s'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Bugs fixed: 1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SWARM items: 2/3'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('PRs merged: 4'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Awaiting UAT: 5'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Active agents: 1/8'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('RAM: 1024 MiB used / 4096 MiB total'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Last tick: 2026-05-18T12:00:00.000Z'));
    expect(process.exitCode).toBeUndefined();
  });

  it('emits raw FlywheelStatus JSON with --json', async () => {
    await writeLatestFlywheelStatus(validStatus);

    await flywheelStatusCommand({ json: true });

    const output = logSpy.mock.calls[0][0] as string;
    expect(JSON.parse(output)).toEqual(validStatus);
  });

  it('exits 1 when no active run exists', async () => {
    await flywheelStatusCommand({});

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('no active flywheel run');
  });

  it('starts a flywheel run with the default brief and writes initial state', async () => {
    await mkdir(join(tempDir, 'docs'), { recursive: true });
    await writeFile(join(tempDir, 'docs', 'flywheel-brief.md'), '# Flywheel Brief\n', 'utf8');

    await flywheelStartCommand({ cwd: tempDir });

    expect(flywheelLifecycleMocks.spawnFlywheel).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'RUN-1',
      briefPath: join(tempDir, 'docs', 'flywheel-brief.md'),
      workspace: tempDir,
    }));
    const latest = JSON.parse(await readFile(join(tempDir, 'flywheel', 'runs', 'RUN-1', 'latest.json'), 'utf8')) as FlywheelStatus;
    expect(latest.runId).toBe('RUN-1');
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

  it('resumes the flywheel and prints before/after gate state', async () => {
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    flywheelLifecycleMocks.paused = true;

    await flywheelResumeCommand();

    expect(flywheelLifecycleMocks.resumeFlywheel).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('Flywheel resumed: before paused=true active_run_id=RUN-1; after paused=false active_run_id=RUN-1');
    expect(process.exitCode).toBeUndefined();
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

  it('writes and commits a deterministic run report', async () => {
    const repoDir = await createReportRepo(tempDir);
    flywheelLifecycleMocks.activeRunId = 'RUN-1';
    flywheelLifecycleMocks.paused = true;
    await writeLatestFlywheelStatus({
      ...validStatus,
      activePipeline: [{ issueId: 'PAN-1', title: 'Pipeline item', verb: 'working', status: 'running', progressPercent: 50, pr: 123 }],
      substrateBugs: [{ issueId: 'PAN-2', title: 'Substrate bug', status: 'fixed', commitSha: 'abcdef1234567890' }],
      parked: [{ issueId: 'PAN-3', title: 'Parked item', reason: 'waiting on UAT' }],
      openQuestions: ['Should the next tick resume PAN-3?'],
    });

    await flywheelReportCommand({ cwd: repoDir });

    const stateReport = await readFile(join(repoDir, 'docs', 'FLYWHEEL-STATE.md'), 'utf8');
    const operationLog = await readFile(join(repoDir, 'docs', 'OPERATION-FIX-ALL.md'), 'utf8');
    expect(stateReport).toContain('# Flywheel State — 2026-05-18 (Run 1)');
    expect(stateReport).toContain('| PAN-1 | working | running | Pipeline item | 50 | 123 |');
    expect(stateReport).toContain('| PAN-2 | fixed | Substrate bug | abcdef1234 |');
    expect(operationLog).toContain('## Run 1 — 2026-05-18');
    expect(operationLog).toContain('**System:** 1/8 agents active');
    expect(await git(repoDir, ['log', '-1', '--format=%s'])).toBe('docs(flywheel): run 1');
    expect(await git(repoDir, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).toBe([
      'docs/FLYWHEEL-STATE.md',
      'docs/OPERATION-FIX-ALL.md',
    ].join('\n'));
    expect(flywheelLifecycleMocks.activeRunId).toBeNull();
    expect(flywheelLifecycleMocks.paused).toBe(false);

    flywheelLifecycleMocks.spawnFlywheel.mockClear();
    await writeFile(join(repoDir, 'docs', 'flywheel-brief.md'), '# Flywheel Brief\n', 'utf8');
    await flywheelStartCommand({ cwd: repoDir });

    expect(flywheelLifecycleMocks.spawnFlywheel).toHaveBeenCalledWith(expect.objectContaining({ runId: 'RUN-2' }));
    expect(process.exitCode).toBeUndefined();
  });

  it('does not create a second report commit without new ticks', async () => {
    const repoDir = await createReportRepo(tempDir);
    await writeLatestFlywheelStatus(validStatus);
    await flywheelReportCommand({ cwd: repoDir });
    logSpy.mockClear();

    await flywheelReportCommand({ cwd: repoDir });

    expect(logSpy).toHaveBeenCalledWith('nothing to report');
    expect(await git(repoDir, ['rev-list', '--count', 'HEAD'])).toBe('2');
  });

  it('amends the run report commit after new ticks', async () => {
    const repoDir = await createReportRepo(tempDir);
    await writeLatestFlywheelStatus(validStatus);
    await flywheelReportCommand({ cwd: repoDir });
    const firstCommit = await git(repoDir, ['rev-parse', 'HEAD']);

    await writeLatestFlywheelStatus({ ...validStatus, elapsedMs: 2000, ticks: 2, lastTickAt: '2026-05-18T12:00:02.000Z' });
    await flywheelReportCommand({ cwd: repoDir });

    expect(await git(repoDir, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(await git(repoDir, ['rev-parse', 'HEAD'])).not.toBe(firstCommit);
    expect(await git(repoDir, ['log', '-1', '--format=%s'])).toBe('docs(flywheel): run 1');
    expect(await readFile(join(repoDir, 'docs', 'FLYWHEEL-STATE.md'), 'utf8')).toContain('ticks 2');
  });

  it('registers flywheel subcommands with their flags', () => {
    const program = new Command();
    registerFlywheelCommands(program);

    const flywheel = program.commands.find(command => command.name() === 'flywheel');
    const start = flywheel?.commands.find(command => command.name() === 'start');
    const emitStatus = flywheel?.commands.find(command => command.name() === 'emit-status');
    const status = flywheel?.commands.find(command => command.name() === 'status');
    const pause = flywheel?.commands.find(command => command.name() === 'pause');
    const resume = flywheel?.commands.find(command => command.name() === 'resume');
    const report = flywheel?.commands.find(command => command.name() === 'report');
    expect(start?.options.map(option => option.long)).toContain('--brief');
    expect(emitStatus?.options.map(option => option.long)).toContain('--file');
    expect(status?.options.map(option => option.long)).toContain('--json');
    expect(pause).toBeDefined();
    expect(resume).toBeDefined();
    expect(report).toBeDefined();
  });
});
