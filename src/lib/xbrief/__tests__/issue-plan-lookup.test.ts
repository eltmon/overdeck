/**
 * PAN-4683 WI-1: findIssuePlan finds a planned issue's spec in the local
 * workspace, on the feature branch refs, or on the primary checkout.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPanSpecFilename } from '../../pan-dir/specs.js';
import { findIssuePlan } from '../issue-plan-lookup.js';

const gitCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const promisified = (actual.execFile as unknown as Record<symbol, (...args: unknown[]) => unknown>)[promisify.custom];
  const execFile = Object.assign(
    (...args: Parameters<typeof actual.execFile>) => actual.execFile(...args),
    {
      [promisify.custom]: (...args: unknown[]) => {
        gitCalls.count++;
        return promisified(...args);
      },
    },
  );
  return { ...actual, execFile };
});

const roots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'issue-plan-lookup-'));
  roots.push(root);
  return root;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function writeFile(path: string, content = '{}'): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function initRepo(root: string): void {
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFile(join(root, 'README.md'), 'readme\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
}

/** Commit a spec on a new branch, then return to main so the primary checkout has no spec. */
function commitSpecOnBranch(root: string, branch: string, specIssueId: string): string {
  const specPath = `.pan/specs/${buildPanSpecFilename(specIssueId, 'slug')}`;
  git(root, 'checkout', '-q', '-b', branch);
  writeFile(join(root, specPath));
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'plan');
  git(root, 'checkout', '-q', 'main');
  return specPath;
}

beforeEach(() => {
  gitCalls.count = 0;
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('findIssuePlan', () => {
  it('finds a spec committed only on the local feature branch', async () => {
    const root = tempDir();
    initRepo(root);
    const specPath = commitSpecOnBranch(root, 'feature/pan-9001', 'PAN-9001');

    const plan = await findIssuePlan({ issueId: 'PAN-9001', projectRoot: root, localWorkspace: null });

    expect(plan).toBe(`refs/heads/feature/pan-9001:${specPath}`);
    expect(plan?.startsWith('refs/heads/feature/pan-9001:.pan/specs/')).toBe(true);
    expect(gitCalls.count).toBeGreaterThan(0);
  });

  it('finds a spec only on the origin feature branch', async () => {
    const base = tempDir();
    const origin = join(base, 'origin.git');
    const seed = join(base, 'seed');
    const clone = join(base, 'clone');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    mkdirSync(seed);
    initRepo(seed);
    git(seed, 'remote', 'add', 'origin', origin);
    git(seed, 'push', '-q', 'origin', 'main');
    execFileSync('git', ['clone', '-q', origin, clone]);
    git(clone, 'config', 'user.email', 'test@example.com');
    git(clone, 'config', 'user.name', 'Test');
    git(clone, 'config', 'commit.gpgsign', 'false');
    commitSpecOnBranch(clone, 'feature/pan-9002', 'PAN-9002');
    git(clone, 'push', '-q', 'origin', 'feature/pan-9002');
    git(clone, 'branch', '-q', '-D', 'feature/pan-9002');

    const plan = await findIssuePlan({ issueId: 'PAN-9002', projectRoot: clone, localWorkspace: null });

    expect(plan?.startsWith('refs/remotes/origin/feature/pan-9002:.pan/specs/')).toBe(true);
  });

  it('returns the local workspace spec without running git', async () => {
    const root = tempDir();
    const workspace = join(root, 'workspaces', 'feature-pan-9005');
    const specFile = join(workspace, '.pan', 'specs', buildPanSpecFilename('PAN-9005', 'slug'));
    writeFile(specFile);

    const plan = await findIssuePlan({ issueId: 'PAN-9005', projectRoot: root, localWorkspace: workspace });

    expect(plan).toBe(specFile);
    expect(gitCalls.count).toBe(0);
  });

  it('falls back to the primary checkout', async () => {
    const root = tempDir();
    initRepo(root);
    const specFile = join(root, '.pan', 'specs', buildPanSpecFilename('PAN-9006', 'slug'));
    writeFile(specFile, JSON.stringify({
      xBRIEFInfo: { version: '0.8', created: '2026-11-01T00:00:00Z', updated: '2026-11-01T00:00:00Z' },
      status: 'active',
      plan: { id: 'PAN-9006', title: 'Primary', status: 'active', items: [], edges: [] },
    }));

    const plan = await findIssuePlan({ issueId: 'PAN-9006', projectRoot: root, localWorkspace: null });

    expect(plan).toBe(specFile);
  });

  it('ignores a spec for a different issue on the branch', async () => {
    const root = tempDir();
    initRepo(root);
    commitSpecOnBranch(root, 'feature/pan-9003', 'PAN-9999');

    await expect(findIssuePlan({ issueId: 'PAN-9003', projectRoot: root, localWorkspace: null })).resolves.toBeNull();
  });

  it('returns null when nothing matches and no ref exists', async () => {
    const root = tempDir();
    initRepo(root);

    await expect(
      findIssuePlan({ issueId: 'PAN-9004', projectRoot: root, localWorkspace: join(root, 'workspaces', 'feature-pan-9004') }),
    ).resolves.toBeNull();
  });
});
