import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import type { FlywheelStatus } from '@panctl/contracts';
import { writeLatestFlywheelStatus } from '../../../dashboard/server/services/flywheel-run-state.js';
import {
  emitStatusCommand,
  flywheelStatusCommand,
  parseFlywheelStatusJson,
  readFlywheelStatusJson,
  registerFlywheelCommands,
} from '../flywheel.js';

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

describe('flywheel CLI commands', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pan-flywheel-'));
    process.exitCode = undefined;
    process.env.PANOPTICON_HOME = tempDir;
    process.env.PANOPTICON_DASHBOARD_URL = 'http://dashboard.test';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
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

  it('registers flywheel subcommands with their flags', () => {
    const program = new Command();
    registerFlywheelCommands(program);

    const flywheel = program.commands.find(command => command.name() === 'flywheel');
    const emitStatus = flywheel?.commands.find(command => command.name() === 'emit-status');
    const status = flywheel?.commands.find(command => command.name() === 'status');
    expect(emitStatus?.options.map(option => option.long)).toContain('--file');
    expect(status?.options.map(option => option.long)).toContain('--json');
  });
});
