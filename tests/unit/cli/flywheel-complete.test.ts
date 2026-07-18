import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelStatus } from '@overdeck/contracts';

import {
  completeFlywheelRun,
  createFlywheelCompleteCommand,
  type CompleteFlywheelDeps,
} from '../../../src/cli/commands/flywheel-complete.js';
import { startFlywheelRun, type StartFlywheelRunDeps } from '../../../src/cli/commands/flywheel.js';
import { getFlywheelRunDir } from '../../../src/dashboard/server/services/flywheel-run-state.js';
import { getBook } from '../../../src/lib/orders/resolver.js';
import type { OrderBookProgress } from '../../../src/lib/orders/types.js';
import { createBook, setStatus } from '../../../src/lib/orders/writer.js';

const roots: string[] = [];
const at = '2026-07-18T12:00:00.000Z';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitFixture(): string {
  const root = join(process.cwd(), `.test-flywheel-complete-state-${process.pid}-${roots.length}`);
  const origin = `${root}-origin.git`;
  roots.push(root, origin);
  mkdirSync(root, { recursive: true });
  git(['init'], root);
  git(['config', 'user.name', 'Flywheel Complete Test'], root);
  git(['config', 'user.email', 'flywheel-complete@example.com'], root);
  writeFileSync(join(root, 'migration-complete.json'), JSON.stringify({ seededAt: at }), 'utf8');
  git(['add', 'migration-complete.json'], root);
  git(['commit', '-m', 'seed'], root);
  git(['branch', '-M', 'overdeck-state'], root);
  execFileSync('git', ['init', '--bare', origin], { encoding: 'utf8' });
  git(['remote', 'add', 'origin', origin], root);
  git(['push', '-u', 'origin', 'overdeck-state'], root);
  return root;
}

function overdeckHome(): string {
  const root = join(process.cwd(), `.test-flywheel-complete-home-${process.pid}-${roots.length}`);
  roots.push(root);
  mkdirSync(root, { recursive: true });
  process.env['OVERDECK_HOME'] = root;
  return root;
}

function status(runId = 'RUN-1'): FlywheelStatus {
  return {
    runId,
    startedAt: at,
    elapsedMs: 1000,
    orchestrator: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high', ctxPercent: 25 },
    headline: { bugsFixed: 0, swarmItemsMerged: 0, swarmItemsTotal: 0, prsMerged: 0, awaitingUat: 0 },
    activePipeline: [],
    substrateBugs: [],
    agents: [],
    parked: [],
    suggestions: [],
    system: { mainHead: 'abc1234', ramUsedMb: 1, ramTotalMb: 2, swapUsedMb: 0, swapTotalMb: 0, agentsActive: 1, agentsCap: 3 },
    openQuestions: [],
    ticks: 1,
    lastTickAt: at,
  };
}

function progress(drained: boolean, issues: string[] = []): OrderBookProgress {
  return {
    bookId: '2026-07-18-current',
    total: issues.length,
    landed: 0,
    drained,
    items: issues.map((issue, index) => ({ issue, lane: 'A', order: index + 1, closed: false, parked: false, terminal: drained })),
  };
}

async function runningBook(stateRoot: string, id = '2026-07-18-current'): Promise<void> {
  await createBook(stateRoot, { id, name: id, createdAt: at });
  await setStatus(stateRoot, id, 'running', { runId: 'RUN-1', at });
}

function startDeps(stateRoot: string): StartFlywheelRunDeps {
  return {
    resolvePrimaryRoot: async () => process.cwd(),
    requireBrief: async () => ({ absolutePath: join(process.cwd(), 'docs', 'flywheel-brief.md'), displayPath: 'docs/flywheel-brief.md' }),
    resolveRoleConfig: async () => ({
      harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high', minAgents: 1, maxAgents: 3,
      scope: 'pan-only', autoPickupBacklog: false, requireUatBeforeMerge: true,
    }),
    spawn: vi.fn(async ({ runId, model, harness }) => ({
      id: 'flywheel-orchestrator', issueId: runId, workspace: process.cwd(), harness,
      role: 'flywheel' as const, model, status: 'running' as const, startedAt: at,
    })),
    writeStatus: vi.fn(async () => 'latest.json'),
    orderStateRoot: () => stateRoot,
    validateOrderBook: () => ({ blocks: [], warns: [] }),
  };
}

function completeDeps(stateRoot: string, overrides: Partial<CompleteFlywheelDeps> = {}): CompleteFlywheelDeps {
  const reportPath = join(getFlywheelRunDir('RUN-1'), 'report.md');
  mkdirSync(getFlywheelRunDir('RUN-1'), { recursive: true });
  return {
    loadStatus: async () => status(),
    buildReport: async () => '# Flywheel Run 1 Report\n',
    persistReport: vi.fn(async (_status, _cwd, report) => writeFileSync(reportPath, report, 'utf8')),
    clearGate: vi.fn(),
    start: vi.fn(async () => ({ runId: 'RUN-2' })),
    readLaunch: async () => ({
      version: 1, runId: 'RUN-1', workspace: process.cwd(),
      briefPath: join(process.cwd(), 'docs', 'flywheel-brief.md'),
      briefDisplayPath: 'docs/flywheel-brief.md', orders: { bookId: '2026-07-18-current' },
    }),
    stateRoot: () => stateRoot,
    computeProgress: () => progress(true),
    autoPickupBacklog: () => false,
    ...overrides,
  };
}

afterEach(() => {
  delete process.env['OVERDECK_HOME'];
  process.exitCode = undefined;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('pan flywheel complete', () => {
  it('refuses a non-drained book unless --force names every non-terminal item', async () => {
    const stateRoot = gitFixture();
    overdeckHome();
    await runningBook(stateRoot);
    const deps = completeDeps(stateRoot, { computeProgress: () => progress(false, ['PAN-1', 'PAN-2']) });

    await expect(completeFlywheelRun({}, deps)).rejects.toThrow(
      'Order book 2026-07-18-current is not drained; non-terminal items: PAN-1, PAN-2. Pass --force to complete anyway.',
    );
    expect(deps.persistReport).not.toHaveBeenCalled();
    expect(deps.clearGate).not.toHaveBeenCalled();

    await expect(completeFlywheelRun({ force: true }, deps)).resolves.toMatchObject({ continuation: 'needs-you' });
    expect(deps.clearGate).toHaveBeenCalledWith('RUN-1');
    expect(getBook(stateRoot, '2026-07-18-current')?.status).toBe('complete');
  });

  it('writes retrospective findings, completes the book, and starts the next ready book in-process', async () => {
    const stateRoot = gitFixture();
    const home = overdeckHome();
    await runningBook(stateRoot);
    await createBook(stateRoot, { id: '2026-07-18-next', name: 'Next', createdAt: at });
    await setStatus(stateRoot, '2026-07-18-next', 'ready', { at });
    const runDir = getFlywheelRunDir('RUN-1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'retro.md'), 'Improve the dispatch refusal copy.\n', 'utf8');
    const nextDeps = startDeps(stateRoot);
    const deps = completeDeps(stateRoot, {
      start: (options) => startFlywheelRun(options, nextDeps),
    });

    const result = await completeFlywheelRun({}, deps);

    expect(result).toMatchObject({ continuation: 'next-book', nextRunId: 'RUN-2', nextBookId: '2026-07-18-next', retrospectiveIncluded: true });
    expect(readFileSync(join(runDir, 'report.md'), 'utf8')).toContain('## Retrospective\n\nImprove the dispatch refusal copy.');
    expect(getBook(stateRoot, '2026-07-18-current')?.status).toBe('complete');
    expect(getBook(stateRoot, '2026-07-18-next')).toMatchObject({ status: 'running', runId: 'RUN-2' });
    expect(JSON.parse(readFileSync(join(home, 'flywheel', 'runs', 'RUN-2', 'launch.json'), 'utf8'))).toMatchObject({ orders: { bookId: '2026-07-18-next' } });
  });

  it('starts a backlog-mode run when no book is queued and auto-pickup is on', async () => {
    const stateRoot = gitFixture();
    overdeckHome();
    await runningBook(stateRoot);
    const start = vi.fn(async () => ({ runId: 'RUN-2' }));
    const deps = completeDeps(stateRoot, { start, autoPickupBacklog: () => true });

    await expect(completeFlywheelRun({}, deps)).resolves.toMatchObject({ continuation: 'backlog', nextRunId: 'RUN-2' });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ cwd: process.cwd() }));
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty('orders');
  });

  it('writes the exact no-findings line and emits needs-you when continuation is disabled', async () => {
    const stateRoot = gitFixture();
    overdeckHome();
    await runningBook(stateRoot);
    const deps = completeDeps(stateRoot);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await createFlywheelCompleteCommand(deps)({});

    expect(readFileSync(join(getFlywheelRunDir('RUN-1'), 'report.md'), 'utf8')).toContain('Retrospective: no findings recognized.');
    expect(log).toHaveBeenCalledWith('needs-you: pipeline idle — no order book queued and auto-pickup is off');
    expect(deps.start).not.toHaveBeenCalled();
    expect(getBook(stateRoot, '2026-07-18-current')?.status).toBe('complete');
  });
});
