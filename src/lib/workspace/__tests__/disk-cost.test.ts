import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DISK_COST_MEMO_TTL_MS,
  estimateWorkspaceDiskCost,
  invalidateWorkspaceDiskCostMemo,
  parseDockerSize,
  resetWorkspaceDiskCostMemo,
  SEED_STACK_DISK_COST_BYTES,
  sumUnsharedBytes,
  type DiskCostDeps,
  type DiskCostProject,
} from '../disk-cost.js';

const LS_TREE = [
  '100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa    1000\tsrc/a.ts',
  '100644 blob bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb     234\tsrc/b.ts',
  '160000 commit cccccccccccccccccccccccccccccccccccccccc       -\tvendor/sub',
  '',
].join('\n');

function dockerDf(volumes: Array<[string, string]>, images: Array<[string, string]> = []): string {
  return JSON.stringify({
    Images: images.map(([Repository, UniqueSize]) => ({ Repository, UniqueSize, SharedSize: '287.3MB', Tag: 'latest' })),
    Containers: [],
    Volumes: volumes.map(([Name, Size]) => ({ Name, Size, Driver: 'local' })),
    BuildCache: [],
  });
}

describe('parseDockerSize (disk-cost-estimate.ac1)', () => {
  it('parses decimal docker sizes', () => {
    expect(parseDockerSize('1.938GB')).toBe(1_938_000_000);
    expect(parseDockerSize('287.3MB')).toBe(287_300_000);
    expect(parseDockerSize('512kB')).toBe(512_000);
    expect(parseDockerSize('0B')).toBe(0);
  });

  it('returns NaN for unparsable sizes', () => {
    expect(parseDockerSize('N/A')).toBeNaN();
    expect(parseDockerSize('12XB')).toBeNaN();
  });
});

describe('estimateWorkspaceDiskCost', () => {
  let root: string;
  let project: DiskCostProject;

  beforeEach(() => {
    resetWorkspaceDiskCostMemo();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    root = mkdtempSync(join(tmpdir(), 'disk-cost-'));
    project = { path: root, workspace: { docker: { compose_template: 'devcontainer' } } };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetWorkspaceDiskCostMemo();
    rmSync(root, { recursive: true, force: true });
  });

  function addSibling(folder: string): void {
    mkdirSync(join(root, 'workspaces', folder, 'node_modules'), { recursive: true });
  }

  function execWith(df: string | Error): NonNullable<DiskCostDeps['exec']> & ReturnType<typeof vi.fn> {
    return vi.fn(async (command: string) => {
      if (command === 'git') return LS_TREE;
      if (df instanceof Error) throw df;
      return df;
    });
  }

  it('host bytes are the ls-tree blob sum plus unshared node_modules bytes', async () => {
    const unsharedBytes = vi.fn(async () => 5_000);

    const cost = await estimateWorkspaceDiskCost(
      { path: root },
      { exec: execWith(dockerDf([])), unsharedBytes },
    );

    expect(cost).toEqual({ hostBytes: 1_234 + 5_000, stackBytes: 0, hostSource: 'measured', stackSource: 'none' });
    expect(unsharedBytes).toHaveBeenCalledWith(join(root, 'node_modules'));
  });

  it('stack bytes are the larger finished sibling stack (disk-cost-estimate.ac2)', async () => {
    addSibling('feature-pan-1');
    addSibling('feature-pan-2');
    const df = dockerDf(
      [
        ['overdeck-feature-pan-1_container-node-modules', '1.5GB'],
        ['overdeck-feature-pan-2_container-node-modules', '1.938GB'],
        ['unrelated_data', '9GB'],
      ],
      [
        ['overdeck-feature-pan-2-frontend', '287.3MB'],
        ['overdeck-feature-pan-1-frontend', '0B'],
      ],
    );

    const cost = await estimateWorkspaceDiskCost(project, { exec: execWith(df), unsharedBytes: async () => 0 });

    expect(cost.stackBytes).toBe(1_938_000_000 + 287_300_000);
    expect(cost.stackSource).toBe('measured');
  });

  it('skips a sibling whose setup is incomplete', async () => {
    addSibling('feature-pan-1');
    addSibling('feature-pan-2');
    mkdirSync(join(root, 'workspaces', 'feature-pan-2', '.overdeck'), { recursive: true });
    writeFileSync(join(root, 'workspaces', 'feature-pan-2', '.overdeck', 'setup-incomplete'), 'x');
    const df = dockerDf([
      ['overdeck-feature-pan-1_container-node-modules', '2.5GB'],
      ['overdeck-feature-pan-2_container-node-modules', '4GB'],
    ]);

    const cost = await estimateWorkspaceDiskCost(project, { exec: execWith(df), unsharedBytes: async () => 0 });

    expect(cost.stackBytes).toBe(2_500_000_000);
  });

  it('with no sibling stack, uses the largest compose-project volume group on the host (disk-cost-estimate.ac3)', async () => {
    const df = dockerDf([
      ['myn-feature-min-1_postgres-data', '3GB'],
      ['myn-feature-min-1_container-node-modules', '2GB'],
      ['other_cache', '1GB'],
    ]);

    const cost = await estimateWorkspaceDiskCost(project, { exec: execWith(df), unsharedBytes: async () => 0 });

    expect(cost.stackBytes).toBe(5_000_000_000);
    expect(cost.stackSource).toBe('machine');
  });

  it('falls back to the seed when docker fails (disk-cost-estimate.ac3)', async () => {
    const cost = await estimateWorkspaceDiskCost(project, {
      exec: execWith(new Error('docker: command not found')),
      unsharedBytes: async () => 0,
    });

    expect(cost.stackBytes).toBe(SEED_STACK_DISK_COST_BYTES);
    expect(cost.stackSource).toBe('seed');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[disk-cost] stack bytes unmeasured'));
  });

  it('memoizes within the TTL and re-measures after invalidation (disk-cost-estimate.ac5)', async () => {
    const exec = execWith(dockerDf([]));
    let nowMs = 1_000_000;
    const deps: DiskCostDeps = { exec, unsharedBytes: async () => 0, now: () => nowMs };

    await estimateWorkspaceDiskCost(project, deps);
    const callsAfterFirst = exec.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    nowMs += DISK_COST_MEMO_TTL_MS - 1;
    await estimateWorkspaceDiskCost(project, deps);
    expect(exec.mock.calls.length).toBe(callsAfterFirst);

    invalidateWorkspaceDiskCostMemo(root);
    await estimateWorkspaceDiskCost(project, deps);
    expect(exec.mock.calls.length).toBe(callsAfterFirst * 2);
  });

  it('passes a hostile project path to exec as one argument-vector element (disk-cost-estimate.ac4)', async () => {
    const hostile = join(root, '"$(touch pwned)"');
    mkdirSync(hostile);
    const exec = execWith(dockerDf([]));

    await estimateWorkspaceDiskCost({ path: hostile }, { exec, unsharedBytes: async () => 0 });
    expect(exec).toHaveBeenCalledWith('git', ['-C', hostile, 'ls-tree', '-r', '-l', 'HEAD']);

    resetWorkspaceDiskCostMemo();
    const cost = await estimateWorkspaceDiskCost({ path: hostile });
    expect(cost.hostSource).toBe('seed');
    expect(existsSync(join(root, 'pwned'))).toBe(false);
    expect(existsSync(join(hostile, 'pwned'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'pwned'))).toBe(false);
  });
});

describe('sumUnsharedBytes (disk-cost-estimate.ac4)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'disk-cost-walk-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('counts only single-link files', async () => {
    mkdirSync(join(root, 'pkg', 'nested'), { recursive: true });
    const single = join(root, 'pkg', 'nested', 'single.js');
    writeFileSync(single, 'x'.repeat(10_000));
    writeFileSync(join(root, 'pkg', 'shared.js'), 'y'.repeat(20_000));
    linkSync(join(root, 'pkg', 'shared.js'), join(root, 'pkg', 'shared-link.js'));

    expect(await sumUnsharedBytes(root)).toBe(lstatSync(single).blocks * 512);
  });

  it('returns 0 for a missing directory', async () => {
    expect(await sumUnsharedBytes(join(root, 'missing'))).toBe(0);
  });
});
