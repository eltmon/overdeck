import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelDerivedStatus } from '@overdeck/contracts';

const mocks = vi.hoisted(() => ({
  startFlywheel: vi.fn(),
  stopFlywheel: vi.fn(),
  pauseFlywheel: vi.fn(),
  abortFlywheel: vi.fn(),
  resumeFlywheel: vi.fn(),
  requestFlywheelReport: vi.fn(),
  deriveFlywheelStatus: vi.fn(),
  readFlywheelRun: vi.fn(),
  resolveFlywheelProjectRoot: vi.fn(),
  readFlywheelReportFile: vi.fn(),
  computeSubstrateStats: vi.fn(),
}));

vi.mock('../../../../src/lib/flywheel/actions.js', () => ({
  startFlywheel: mocks.startFlywheel,
  stopFlywheel: mocks.stopFlywheel,
  pauseFlywheel: mocks.pauseFlywheel,
  abortFlywheel: mocks.abortFlywheel,
  resumeFlywheel: mocks.resumeFlywheel,
  requestFlywheelReport: mocks.requestFlywheelReport,
}));
vi.mock('../../../../src/lib/flywheel/derive-status.js', () => ({
  deriveFlywheelStatus: mocks.deriveFlywheelStatus,
  readFlywheelRun: mocks.readFlywheelRun,
  resolveFlywheelProjectRoot: mocks.resolveFlywheelProjectRoot,
}));
vi.mock('../../../../src/lib/flywheel/files.js', () => ({ readFlywheelReportFile: mocks.readFlywheelReportFile }));
vi.mock('../../../../src/lib/flywheel/substrate-stats.js', () => ({ computeSubstrateStats: mocks.computeSubstrateStats }));

const { registerFlywheelCommands, startFlywheelRun } = await import('../../../../src/cli/commands/flywheel.js');
const { FlywheelAlreadyRunning, FlywheelPausedExists } = await import('../../../../src/lib/flywheel/errors.js');

function program(): Command {
  const root = new Command();
  root.exitOverride();
  root.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerFlywheelCommands(root);
  return root;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(['node', 'pan', 'flywheel', ...args]);
}

const status: FlywheelDerivedStatus = {
  run: 'running',
  conversation: { name: 'conv-flywheel', id: 1, title: 'Flywheel', model: 'm', harness: 'claude-code', cwd: '/repos/overdeck', createdAt: '2026-09-23T08:00:00.000Z', sessionAlive: true },
  lastTick: { tick: 3, pick: 'PAN-1', phase: 'watch', inFlight: ['PAN-1'], needsYou: 'decide', at: '2026-09-23T10:00:00.000Z' },
  freshness: 'live',
  policies: { auto_pickup_backlog: false, require_uat_before_merge: true, merge_train_enabled: false },
  inFlight: [{ issueId: 'PAN-1', title: 'Fix the thing', state: 'working', liveAgents: 0, inTick: true, lastJournal: null }],
  agents: [],
  inFlightSource: 'tick',
  orderBook: null,
  projectRoot: '/repos/overdeck',
  generatedAt: '2026-09-23T10:00:05.000Z',
};

describe('pan flywheel verbs (PAN-3964 FR-6)', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let err: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    err = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    log.mockRestore();
    err.mockRestore();
    process.exitCode = undefined;
  });

  it('registers every v1 verb and the start/stop/stats flags', () => {
    const flywheel = program().commands.find((c) => c.name() === 'flywheel')!;
    expect(flywheel.commands.map((c) => c.name())).toEqual(['start', 'stop', 'abort', 'pause', 'resume', 'report', 'status', 'stats']);
    const flags = (name: string) => flywheel.commands.find((c) => c.name() === name)!.options.map((o) => o.long);
    expect(flags('start')).toEqual(expect.arrayContaining(['--orders', '--fresh', '--model', '--harness', '--cwd']));
    expect(flags('stop')).toEqual(['--timeout']);
    expect(flags('status')).toEqual(['--json']);
    expect(flags('stats')).toEqual(['--json', '--window']);
  });

  it('start passes --orders and --fresh to the action', async () => {
    mocks.startFlywheel.mockResolvedValue({ session: 'conv-flywheel', harness: 'claude-code', model: 'm', prompt: '/pan-flywheel b1', cwd: '/r' });
    await run('start', '--orders', 'b1', '--fresh');
    expect(mocks.startFlywheel).toHaveBeenCalledWith(expect.objectContaining({ orders: 'b1', fresh: true }));
    expect(process.exitCode).toBeUndefined();
  });

  it('start on a paused flywheel exits 1 with the D5 message', async () => {
    mocks.startFlywheel.mockRejectedValue(new FlywheelPausedExists());
    await run('start');
    expect(process.exitCode).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('paused flywheel exists — `pan flywheel resume` to continue, `pan flywheel start --fresh` to start over'));
  });

  it('stop parses --timeout', async () => {
    mocks.stopFlywheel.mockResolvedValue({ reportWritten: true, stopped: true });
    await run('stop', '--timeout', '5000');
    expect(mocks.stopFlywheel).toHaveBeenCalledWith({ timeoutMs: 5000 });
  });

  it.each([
    ['abort', 'abortFlywheel'],
    ['pause', 'pauseFlywheel'],
    ['resume', 'resumeFlywheel'],
  ] as const)('%s calls %s', async (verb, action) => {
    mocks[action].mockResolvedValue(undefined);
    await run(verb);
    expect(mocks[action]).toHaveBeenCalledOnce();
  });

  it('report asks a running loop, and prints the file otherwise', async () => {
    mocks.readFlywheelRun.mockResolvedValue({ run: 'running' });
    await run('report');
    expect(mocks.requestFlywheelReport).toHaveBeenCalledOnce();

    mocks.readFlywheelRun.mockResolvedValue({ run: 'paused' });
    mocks.resolveFlywheelProjectRoot.mockResolvedValue({ projectRoot: '/r', planHome: '/r' });
    mocks.readFlywheelReportFile.mockResolvedValue({ exists: true, path: '.pan/flywheel/report.md', content: '# Report body', lastModified: '2026-09-23T00:00:00Z' });
    await run('report');
    expect(mocks.readFlywheelReportFile).toHaveBeenCalledWith('/r');
    expect(log).toHaveBeenCalledWith('# Report body');

    mocks.readFlywheelReportFile.mockResolvedValue({ exists: false, path: '.pan/flywheel/report.md', content: null, lastModified: null });
    await run('report');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('No report yet.'));
  });

  it('status --json prints the deriver result verbatim', async () => {
    mocks.deriveFlywheelStatus.mockResolvedValue(status);
    await run('status', '--json');
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual(status);
  });

  it('status prints tick, needs-you, and the in-flight table', async () => {
    mocks.deriveFlywheelStatus.mockResolvedValue(status);
    await run('status');
    const out = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('running · tick 3');
    expect(out).toContain('decide');
    expect(out).toContain('PAN-1');
  });

  it('status names the no-agent row, its title, and the loop in-flight count (PAN-4199 ac1)', async () => {
    mocks.deriveFlywheelStatus.mockResolvedValue(status);
    await run('status');
    const out = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('no agent');
    expect(out).toContain('Fix the thing');
    expect(out).toContain('in flight (loop) 1');
  });

  it('status prints (tracker unknown) in place of a missing title (PAN-4199 ac2)', async () => {
    mocks.deriveFlywheelStatus.mockResolvedValue({
      ...status,
      inFlight: [{ ...status.inFlight[0]!, title: null, trackerUnknown: true }],
    });
    await run('status');
    const line = log.mock.calls.map((c) => String(c[0])).join('\n').split('\n').find((l) => l.startsWith('    PAN-1'));
    expect(line).toContain('(tracker unknown)');
  });

  it('status counts feature workspaces when the source is the census (PAN-4199 ac3)', async () => {
    mocks.deriveFlywheelStatus.mockResolvedValue({
      ...status,
      inFlightSource: 'census',
      inFlight: ['PAN-1', 'PAN-2', 'PAN-3'].map((issueId) => ({ ...status.inFlight[0]!, issueId, inTick: false })),
    });
    await run('status');
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('feature workspaces 3');
  });

  it('stats passes --window and prints JSON', async () => {
    mocks.resolveFlywheelProjectRoot.mockResolvedValue({ projectRoot: '/repos/overdeck', planHome: '/repos/overdeck' });
    mocks.computeSubstrateStats.mockResolvedValue({ window: { days: 7 } });
    await run('stats', '--window', '7', '--json');
    expect(mocks.computeSubstrateStats).toHaveBeenCalledWith({ projectPath: '/repos/overdeck', windowDays: 7 });
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual({ window: { days: 7 } });
  });

  it('startFlywheelRun treats an already-running flywheel as started', async () => {
    mocks.startFlywheel.mockRejectedValue(new FlywheelAlreadyRunning());
    await expect(startFlywheelRun({ orders: 'b1' })).resolves.toEqual({ runId: 'conv-flywheel' });
  });
});
