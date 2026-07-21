import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startFlywheelRun, type StartFlywheelRunDeps } from '../../../src/cli/commands/flywheel.js';
import { getBook } from '../../../src/lib/orders/resolver.js';
import { createBook, setSettings, setStatus } from '../../../src/lib/orders/writer.js';

const roots: string[] = [];
const at = '2026-07-18T12:00:00.000Z';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitFixture(): string {
  const root = join(process.cwd(), `.test-flywheel-orders-state-${process.pid}-${roots.length}`);
  const origin = `${root}-origin.git`;
  roots.push(root, origin);
  mkdirSync(root, { recursive: true });
  git(['init'], root);
  git(['config', 'user.name', 'Flywheel Orders Test'], root);
  git(['config', 'user.email', 'flywheel-orders@example.com'], root);
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
  const root = join(process.cwd(), `.test-flywheel-orders-home-${process.pid}-${roots.length}`);
  roots.push(root);
  mkdirSync(root, { recursive: true });
  process.env['OVERDECK_HOME'] = root;
  return root;
}

async function readyBook(stateRoot: string, id: string): Promise<void> {
  await createBook(stateRoot, { id, name: id, createdAt: at });
  await setStatus(stateRoot, id, 'ready', { at });
}

function startDeps(stateRoot: string, overrides: Partial<StartFlywheelRunDeps> = {}): StartFlywheelRunDeps {
  return {
    resolvePrimaryRoot: async () => process.cwd(),
    requireBrief: async () => ({
      absolutePath: join(process.cwd(), 'docs', 'flywheel-brief.md'),
      displayPath: 'docs/flywheel-brief.md',
    }),
    resolveRoleConfig: async () => ({
      harness: 'claude-code',
      model: 'claude-sonnet-5',
      effort: 'high',
      minAgents: 1,
      maxAgents: 3,
      scope: 'pan-only',
      autoPickupBacklog: false,
      requireUatBeforeMerge: true,
    }),
    spawn: vi.fn(async ({ runId, model, harness }) => ({
      id: 'flywheel-orchestrator',
      issueId: runId,
      workspace: process.cwd(),
      harness,
      role: 'flywheel' as const,
      model,
      status: 'running' as const,
      startedAt: at,
    })),
    writeStatus: vi.fn(async () => 'latest.json'),
    cleanupSpawnedRun: vi.fn(async () => {}),
    orderStateRoot: () => stateRoot,
    validateOrderBook: () => ({ blocks: [], warns: [] }),
    ...overrides,
  };
}

afterEach(() => {
  delete process.env['OVERDECK_HOME'];
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('pan flywheel start --orders', () => {
  it('persists the book binding and marks the book running after spawn succeeds', async () => {
    const stateRoot = gitFixture();
    const home = overdeckHome();
    const bookId = '2026-07-18-clean';
    await readyBook(stateRoot, bookId);
    const deps = startDeps(stateRoot);

    await expect(startFlywheelRun({ cwd: process.cwd(), orders: bookId }, deps)).resolves.toMatchObject({
      runId: 'RUN-1',
      briefDisplayPath: 'docs/flywheel-brief.md',
    });

    const launch = JSON.parse(readFileSync(join(home, 'flywheel', 'runs', 'RUN-1', 'launch.json'), 'utf8')) as Record<string, unknown>;
    expect(launch).toMatchObject({ runId: 'RUN-1', orders: { bookId } });
    expect(getBook(stateRoot, bookId)).toMatchObject({ status: 'running', runId: 'RUN-1' });
    expect(deps.spawn).toHaveBeenCalledOnce();
  });

  it('resolves and appends the configured brief overlay for the spawned orchestrator', async () => {
    const stateRoot = gitFixture();
    const home = overdeckHome();
    const bookId = '2026-07-18-overlay';
    await readyBook(stateRoot, bookId);
    await setSettings(stateRoot, bookId, { briefOverlay: 'docs/campaign-overlay.md' }, at);
    const requireBrief = vi.fn(async (_cwd: string, requested?: string) => ({
      absolutePath: join(process.cwd(), requested ?? 'docs/flywheel-brief.md'),
      displayPath: requested ?? 'docs/flywheel-brief.md',
    }));
    const deps = startDeps(stateRoot, {
      requireBrief,
      readBrief: async () => 'Campaign-specific instruction.',
    });

    await startFlywheelRun({ cwd: process.cwd(), orders: bookId }, deps);

    expect(requireBrief).toHaveBeenCalledWith(process.cwd(), 'docs/campaign-overlay.md');
    expect(deps.spawn).toHaveBeenCalledWith(expect.objectContaining({
      briefOverlayPath: 'docs/campaign-overlay.md',
      briefOverlayContent: 'Campaign-specific instruction.',
    }));
    expect(JSON.parse(readFileSync(join(home, 'flywheel', 'runs', 'RUN-1', 'launch.json'), 'utf8')))
      .toMatchObject({ briefOverlayPath: 'docs/campaign-overlay.md' });
  });

  it('reports every validation block and leaves the ready book unchanged', async () => {
    const stateRoot = gitFixture();
    overdeckHome();
    const bookId = '2026-07-18-blocked';
    await readyBook(stateRoot, bookId);
    const deps = startDeps(stateRoot, {
      validateOrderBook: () => ({
        blocks: [
          { code: 'issue-not-open', issue: 'PAN-1', message: 'PAN-1 is not open' },
          { code: 'missing-prd', issue: 'PAN-2', message: 'PAN-2 has no PRD' },
        ],
        warns: [],
      }),
    });

    await expect(startFlywheelRun({ cwd: process.cwd(), orders: bookId }, deps)).rejects.toThrow(
      'Order book 2026-07-18-blocked cannot start:\n' +
      '- [issue-not-open] PAN-1: PAN-1 is not open\n' +
      '- [missing-prd] PAN-2: PAN-2 has no PRD',
    );
    expect(deps.spawn).not.toHaveBeenCalled();
    const unchanged = getBook(stateRoot, bookId);
    expect(unchanged).toMatchObject({ status: 'ready' });
    expect(unchanged?.runId).toBeUndefined();
  });

  it('leaves the book ready when the existing active-run gate refuses spawn', async () => {
    const stateRoot = gitFixture();
    overdeckHome();
    const bookId = '2026-07-18-gated';
    await readyBook(stateRoot, bookId);
    const deps = startDeps(stateRoot, {
      spawn: vi.fn(async () => {
        throw new Error('Flywheel run RUN-7 is already active; pause, resume, or report it before starting another run');
      }),
    });

    await expect(startFlywheelRun({ cwd: process.cwd(), orders: bookId }, deps)).rejects.toThrow(
      'Flywheel run RUN-7 is already active',
    );
    const unchanged = getBook(stateRoot, bookId);
    expect(unchanged).toMatchObject({ status: 'ready' });
    expect(unchanged?.runId).toBeUndefined();
  });

  it('rolls the book back to ready when a post-spawn start step fails', async () => {
    const stateRoot = gitFixture();
    overdeckHome();
    const bookId = '2026-07-18-rollback';
    await readyBook(stateRoot, bookId);
    const deps = startDeps(stateRoot, {
      writeStatus: vi.fn(async () => {
        throw new Error('latest status write failed');
      }),
    });

    await expect(startFlywheelRun({ cwd: process.cwd(), orders: bookId }, deps)).rejects.toThrow(
      'latest status write failed',
    );
    expect(deps.cleanupSpawnedRun).toHaveBeenCalledWith('RUN-1');
    expect(getBook(stateRoot, bookId)).toMatchObject({ status: 'ready' });
    expect(getBook(stateRoot, bookId)?.runId).toBeUndefined();
  });
});
