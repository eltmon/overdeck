import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runOrdersAdd, runOrdersCreate } from '../../../src/cli/commands/orders.js';
import { runOrdersItem, runOrdersPause, runOrdersResume, runOrdersRename, runOrdersSet } from '../../../src/cli/commands/orders-edit.js';

const { mockGetProjectSync, mockGetProjectPanPaths, mockStartFlywheelRun } = vi.hoisted(() => ({
  mockGetProjectSync: vi.fn(),
  mockGetProjectPanPaths: vi.fn(),
  mockStartFlywheelRun: vi.fn(),
}));

vi.mock('../../../src/lib/pan-dir/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/pan-dir/paths.js')>();
  return {
    ...actual,
    getProjectPanPaths: (root: string) => mockGetProjectPanPaths(root) ?? actual.getProjectPanPaths(root),
  };
});

vi.mock('../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/projects.js')>();
  return {
    ...actual,
    getProjectSync: mockGetProjectSync,
  };
});

vi.mock('../../../src/cli/commands/flywheel.js', () => ({
  startFlywheelRun: mockStartFlywheelRun,
}));

const roots: string[] = [];
const at = '2026-07-18T12:00:00.000Z';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitFixture(): string {
  const root = join(process.cwd(), `.test-orders-edit-cli-${process.pid}-${roots.length}`);
  const origin = `${root}-origin.git`;
  roots.push(root, origin);
  mkdirSync(root, { recursive: true });
  git(['init'], root);
  git(['config', 'user.name', 'Orders Edit CLI Test'], root);
  git(['config', 'user.email', 'orders-edit-cli@example.com'], root);
  writeFileSync(join(root, 'README.md'), 'orders edit cli fixture\n', 'utf8');
  git(['add', 'README.md'], root);
  git(['commit', '-m', 'seed'], root);
  git(['branch', '-M', 'main'], root);
  execFileSync('git', ['init', '--bare', origin], { encoding: 'utf8' });
  git(['remote', 'add', 'origin', origin], root);
  git(['push', '-u', 'origin', 'main'], root);
  return join(root, '.pan');
}

beforeEach(() => {
  mockGetProjectSync.mockReset().mockReturnValue(null);
  mockGetProjectPanPaths.mockReset().mockReturnValue(undefined);
  mockStartFlywheelRun.mockReset();
});

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('pan orders rename, set, pause, resume (PAN-5598 WI-7)', () => {
  it('rename writes the new name and commits', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const created = await runOrdersCreate('Original Name', deps);
    const renamed = await runOrdersRename(created.id, 'New Name', deps);
    expect(renamed.name).toBe('New Name');
    expect(git(['log', '-1', '--format=%s'], dirname(panDir))).toBe(`chore(orders): rename order book ${created.id}`);
  });

  it('set --parallel 3 writes laneAConcurrency', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const created = await runOrdersCreate('Parallel Book', deps);
    const updated = await runOrdersSet(created.id, { parallel: 3 }, deps);
    expect(updated.settings.laneAConcurrency).toBe(3);
  });

  it('set refuses --parallel 9', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const created = await runOrdersCreate('Over Limit', deps);
    await expect(runOrdersSet(created.id, { parallel: 9 }, deps)).rejects.toThrow();
  });

  it('set --no-brief clears the overlay', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const created = await runOrdersCreate('Brief Book', deps);
    await runOrdersSet(created.id, { brief: 'docs/overlay.md' }, deps);
    const cleared = await runOrdersSet(created.id, { brief: false }, deps);
    expect(cleared.settings.briefOverlay).toBe('');
  });

  it('set with no flag fails', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const created = await runOrdersCreate('No Flag', deps);
    await expect(runOrdersSet(created.id, {}, deps)).rejects.toThrow('--parallel, --brief or --no-brief is required');
  });

  it('pause records posture drain with the reason, time and cli', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const created = await runOrdersCreate('Pausable', deps);
    const paused = await runOrdersPause(created.id, { reason: 'x' }, deps);
    expect(paused.settings).toMatchObject({
      posture: 'drain',
      postureReason: 'x',
      postureSetAt: at,
      postureSetBy: 'cli',
    });
  });

  it('resume records posture open with the default reason', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const created = await runOrdersCreate('Resumable', deps);
    await runOrdersPause(created.id, {}, deps);
    const resumed = await runOrdersResume(created.id, {}, deps);
    expect(resumed.settings).toMatchObject({ posture: 'open', postureReason: 'Operator reopened pickup.' });
  });
});

describe('pan orders item (PAN-5598 WI-8)', () => {
  it('item --prereqs sets the list and leaves reVerify unchanged', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const created = await runOrdersCreate('Item Book', deps);
    await runOrdersAdd(created.id, ['PAN-2'], { reverify: true }, deps);
    const updated = await runOrdersItem(created.id, 'PAN-2', { prereqs: 'pan-1' }, deps);
    const item = updated.items.find((candidate) => candidate.issue === 'PAN-2');
    expect(item).toMatchObject({ prereqs: ['PAN-1'], reVerify: true });
  });

  it('item --no-reverify clears reVerify', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const created = await runOrdersCreate('Item Reverify', deps);
    await runOrdersAdd(created.id, ['PAN-2'], { reverify: true }, deps);
    const updated = await runOrdersItem(created.id, 'PAN-2', { reverify: false }, deps);
    const item = updated.items.find((candidate) => candidate.issue === 'PAN-2');
    expect(item).toMatchObject({ reVerify: false });
  });

  it('item --prereqs "" clears the list', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const created = await runOrdersCreate('Item Clear', deps);
    await runOrdersAdd(created.id, ['PAN-2'], { prereqs: 'PAN-1' }, deps);
    const updated = await runOrdersItem(created.id, 'PAN-2', { prereqs: '' }, deps);
    const item = updated.items.find((candidate) => candidate.issue === 'PAN-2');
    expect(item).toMatchObject({ prereqs: [] });
  });

  it('item with no flag fails', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const created = await runOrdersCreate('Item No Flag', deps);
    await runOrdersAdd(created.id, ['PAN-2'], {}, deps);
    await expect(runOrdersItem(created.id, 'PAN-2', {}, deps))
      .rejects.toThrow('--prereqs, --reverify, --no-reverify, --plan-at-pickup or --no-plan-at-pickup is required');
  });
});
