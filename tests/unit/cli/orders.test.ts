import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createOrdersCommand,
  formatBook,
  formatBookList,
  runOrdersAdd,
  runOrdersCreate,
  runOrdersList,
  runOrdersMove,
  runOrdersQueue,
  runOrdersRemove,
  runOrdersShow,
  runOrdersStart,
} from '../../../src/cli/commands/orders.js';
import { addItems, createBook } from '../../../src/lib/orders/writer.js';
import type { ProjectConfig } from '../../../src/lib/projects.js';

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
  const root = join(process.cwd(), `.test-orders-cli-${process.pid}-${roots.length}`);
  const origin = `${root}-origin.git`;
  roots.push(root, origin);
  mkdirSync(root, { recursive: true });
  git(['init'], root);
  git(['config', 'user.name', 'Orders CLI Test'], root);
  git(['config', 'user.email', 'orders-cli@example.com'], root);
  writeFileSync(join(root, 'README.md'), 'orders cli fixture\n', 'utf8');
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

describe('pan orders commands', () => {
  it('creates, adds after an anchor, shows, moves, removes, lists, and starts a book', async () => {
    const panDir = gitFixture();
    const deps = {
      panDir,
      now: () => new Date(at),
      actor: 'operator',
    };
    const created = await runOrdersCreate('Refactor Campaign', deps);
    expect(created.id).toBe('2026-07-18-refactor-campaign');

    await runOrdersAdd(created.id, ['PAN-1'], { lane: 'B' }, deps);
    await runOrdersAdd(created.id, ['PAN-3'], { lane: 'B' }, deps);
    const added = await runOrdersAdd(created.id, ['PAN-2'], {
      lane: 'B',
      after: 'PAN-1',
      reverify: true,
    }, deps);
    expect(added.items.map(({ issue, lane, order, reVerify }) => ({ issue, lane, order, reVerify }))).toEqual([
      { issue: 'PAN-1', lane: 'B', order: 1, reVerify: false },
      { issue: 'PAN-2', lane: 'B', order: 2, reVerify: true },
      { issue: 'PAN-3', lane: 'B', order: 3, reVerify: false },
    ]);

    const shown = await runOrdersShow(created.id, deps);
    expect(formatBook(shown)).toContain('"issue": "PAN-2"');
    expect(formatBookList(runOrdersList(deps))).toContain('2026-07-18-refactor-campaign');

    const moved = await runOrdersMove(created.id, 'PAN-3', { lane: 'A', order: 1 }, deps);
    expect(moved.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ issue: 'PAN-3', lane: 'A', order: 1 }),
    ]));

    const removed = await runOrdersRemove(created.id, 'PAN-1', deps);
    expect(removed.items.map((item) => item.issue)).toEqual(['PAN-3', 'PAN-2']);

    const startOrderBook = vi.fn(async () => ({ runId: 'RUN-99' }));
    await expect(runOrdersStart(created.id, { ...deps, startOrderBook })).resolves.toEqual({ runId: 'RUN-99' });
    expect(startOrderBook).toHaveBeenCalledWith(created.id);
  });

  it('rejects duplicate membership and names the owning non-complete book', async () => {
    const panDir = gitFixture();
    await createBook(panDir, { id: '2026-07-18-first', name: 'First', createdAt: at });
    await createBook(panDir, { id: '2026-07-18-second', name: 'Second', createdAt: at });
    await addItems(panDir, '2026-07-18-first', [{
      issue: 'PAN-7',
      lane: 'A',
      order: 1,
      prereqs: [],
      reVerify: false,
    }], 'operator', at);

    await expect(runOrdersAdd('2026-07-18-second', ['PAN-7'], {}, { panDir, actor: 'operator' }))
      .rejects.toThrow('Issue PAN-7 already belongs to non-complete order book 2026-07-18-first');
  });

  it('registers every documented verb and option in Commander help', () => {
    const command = createOrdersCommand();
    expect(command.commands.map((child) => child.name())).toEqual([
      'create',
      'list',
      'show',
      'add',
      'remove',
      'move',
      'queue',
      'start',
    ]);
    for (const child of command.commands) {
      expect(child.options.map((option) => option.long)).toContain('--project');
    }
    const add = command.commands.find((child) => child.name() === 'add')!;
    expect(add.options.map((option) => option.long)).toEqual(['--lane', '--after', '--reverify', '--project']);
    const move = command.commands.find((child) => child.name() === 'move')!;
    expect(move.options.map((option) => option.long)).toEqual(['--lane', '--order', '--project']);
  });

  it('resolves --project through the projects registry regardless of cwd', async () => {
    const otherRoot = gitFixture();
    const otherProject = { path: '/fake/other-project' } as ProjectConfig;
    mockGetProjectSync.mockImplementation((key: string) => (key === 'other-project' ? otherProject : null));
    mockGetProjectPanPaths.mockImplementation(() => ({ panDir: otherRoot }));

    const created = await runOrdersCreate('Cross Project', {
      projectKey: 'other-project',
      now: () => new Date(at),
    });
    expect(created.id).toBe('2026-07-18-cross-project');
    expect(formatBookList(runOrdersList({ projectKey: 'other-project' }))).toContain('2026-07-18-cross-project');
  });

  it('throws Unknown project for an unregistered --project key', () => {
    mockGetProjectSync.mockReturnValue(null);
    expect(() => runOrdersList({ projectKey: 'ghost-project' })).toThrow('Unknown project: ghost-project');
  });

  it('exits non-zero with an unknown --project key from the command line', async () => {
    mockGetProjectSync.mockReturnValue(null);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const command = createOrdersCommand();
    await command.parseAsync(['list', '--project', 'ghost-project'], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown project: ghost-project'));
  });

  it('queues a draft book to ready through the write door', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at) };
    const created = await runOrdersCreate('Queueable', deps);
    expect(created.status).toBe('draft');

    const queued = await runOrdersQueue(created.id, deps);
    expect(queued.status).toBe('ready');
    expect((await runOrdersShow(created.id, deps)).status).toBe('ready');
  });

  it('rejects queueing a non-draft book', async () => {
    const panDir = gitFixture();
    const deps = { panDir, now: () => new Date(at) };
    const created = await runOrdersCreate('Already queued', deps);
    await runOrdersQueue(created.id, deps);

    await expect(runOrdersQueue(created.id, deps))
      .rejects.toThrow(`Order book ${created.id} must be draft before it can be queued`);
  });

  it('queues a book in another registered project via --project from an unrelated cwd', async () => {
    const otherRoot = gitFixture();
    const otherProject = { path: '/fake/other-project' } as ProjectConfig;
    mockGetProjectSync.mockImplementation((key: string) => (key === 'other-project' ? otherProject : null));
    mockGetProjectPanPaths.mockImplementation(() => ({ panDir: otherRoot }));

    const created = await runOrdersCreate('Cross Queue', {
      projectKey: 'other-project',
      now: () => new Date(at),
    });
    const queued = await runOrdersQueue(created.id, { projectKey: 'other-project' });
    expect(queued.status).toBe('ready');
    expect((await runOrdersShow(created.id, { projectKey: 'other-project' })).status).toBe('ready');
  });

  it('starts the Flywheel with cwd set to the selected --project, not the caller cwd', async () => {
    const otherRoot = gitFixture();
    const otherProject = { path: '/fake/other-project' } as ProjectConfig;
    mockGetProjectSync.mockImplementation((key: string) => (key === 'other-project' ? otherProject : null));
    mockGetProjectPanPaths.mockImplementation(() => ({ panDir: otherRoot }));
    mockStartFlywheelRun.mockResolvedValue({ runId: 'RUN-CLI-CROSS' });

    const created = await runOrdersCreate('Cross Start', {
      projectKey: 'other-project',
      now: () => new Date(at),
    });

    await expect(runOrdersStart(created.id, { projectKey: 'other-project' }))
      .resolves.toEqual({ runId: 'RUN-CLI-CROSS' });
    expect(mockStartFlywheelRun).toHaveBeenCalledWith({ cwd: '/fake/other-project', orders: created.id });
  });
});

/**
 * #4108: order books are committed on `main` in the plan home, so the verb
 * pushes them too (`pushPlanArtifacts`), or local main drifts ahead of origin.
 * Real git against the fixture's local bare remote.
 */
describe('pan orders pushes its order-book commits', () => {
  const originOf = (panDir: string): string => `${dirname(panDir)}-origin.git`;
  const originMain = (panDir: string): string => git(['rev-parse', 'main'], originOf(panDir));

  function commitElsewhere(panDir: string, rel: string, content: string): void {
    const other = `${dirname(panDir)}-other`;
    roots.push(other);
    execFileSync('git', ['clone', '-q', '-b', 'main', originOf(panDir), other], { encoding: 'utf8' });
    git(['config', 'user.name', 'Orders CLI Test'], other);
    git(['config', 'user.email', 'orders-cli@example.com'], other);
    writeFileSync(join(other, rel), content, 'utf8');
    git(['add', '--', rel], other);
    git(['commit', '-q', '-m', 'feat: land elsewhere'], other);
    git(['push', '-q', 'origin', 'main'], other);
  }

  it('pushes every write verb’s commit to origin main', async () => {
    const panDir = gitFixture();
    const home = dirname(panDir);
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };

    const created = await runOrdersCreate('Pushed', deps);
    expect(originMain(panDir)).toBe(git(['rev-parse', 'HEAD'], home));
    expect(git(['ls-tree', '-r', '--name-only', 'main', '--', '.pan/orders'], originOf(panDir))).toContain(created.id);

    await runOrdersAdd(created.id, ['PAN-1'], {}, deps);
    await runOrdersQueue(created.id, deps);
    expect(originMain(panDir)).toBe(git(['rev-parse', 'HEAD'], home));
    expect(git(['log', '-1', '--format=%s', 'main'], originOf(panDir))).toBe(`chore(orders): queue order book ${created.id}`);
  });

  it('replays the order-book commit onto a moved origin without forcing', async () => {
    const panDir = gitFixture();
    const home = dirname(panDir);
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    commitElsewhere(panDir, 'README.md', 'moved on origin\n');
    const moved = originMain(panDir);

    const created = await runOrdersCreate('Replayed', deps);

    const tip = originMain(panDir);
    expect(git(['rev-list', '--count', `${moved}..${tip}`], originOf(panDir))).toBe('1');
    expect(git(['show', `${tip}:README.md`], originOf(panDir))).toBe('moved on origin');
    expect(git(['ls-tree', '-r', '--name-only', tip, '--', '.pan/orders'], originOf(panDir))).toContain(created.id);
    expect(git(['rev-parse', 'HEAD'], home)).toBe(tip);
  });

  it('warns and leaves origin alone when local main carries a commit outside .pan/', async () => {
    const panDir = gitFixture();
    const home = dirname(panDir);
    const deps = { panDir, now: () => new Date(at), actor: 'operator' };
    const before = originMain(panDir);
    writeFileSync(join(home, 'README.md'), 'unpushed operator work\n', 'utf8');
    git(['commit', '-q', '-am', 'feat: unpushed operator work'], home);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runOrdersCreate('Held back', deps);

    expect(originMain(panDir)).toBe(before);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('README.md'));
  });
});
