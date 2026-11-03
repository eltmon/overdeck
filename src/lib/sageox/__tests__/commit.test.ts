/**
 * PAN-4852 WI-19: `commitSageoxBinding` against a scratch project repo with a
 * bare `origin`, the binding store under a temp OVERDECK_HOME, an injected
 * runner that passes git through with a test identity, and an injected
 * `createArtifact` in place of the forge CLI.
 */
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sageox-commit-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import type { CreateReviewArtifactInput } from '../../forge.js';
import { invalidateProjectsConfigCache } from '../../projects.js';
import { writeBinding } from '../binding.js';
import { commitSageoxBinding, parseOriginRepository, SAGEOX_LINK_BRANCH, SageoxCommitError, type CommitDeps } from '../commit.js';
import { readSageoxBindingCommitted } from '../config.js';

const execFileAsync = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'sageox-commit-scratch-'));
const FIVE_FILES = ['.gitignore', '.repo_0a1b2c3d-1111-2222-3333-444455556666', 'README.md', 'config.json', 'discovered.jsonl'];
const PR_URL = 'https://github.com/acme/app/pull/7';

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });
}

let caseNo = 0;

/** A project repo on `main` pushed to a bare `origin`, registered as project `app`. */
function makeProject(trackSageox = false): string {
  const dir = join(scratch, `case-${++caseNo}`);
  const repo = join(dir, 'app');
  const bare = join(dir, 'origin.git');
  mkdirSync(repo, { recursive: true });
  git(dir, ['init', '-q', '--bare', '-b', 'main', bare]);
  git(repo, ['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'README.md'), 'readme\n');
  if (trackSageox) {
    mkdirSync(join(repo, '.sageox'));
    writeFileSync(join(repo, '.sageox', 'config.json'), '{}\n');
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'init']);
  git(repo, ['remote', 'add', 'origin', bare]);
  git(repo, ['push', '-q', 'origin', 'main']);
  writeFileSync(join(overdeckHome, 'projects.yaml'), `projects:\n  app:\n    name: App\n    path: ${repo}\n`);
  invalidateProjectsConfigCache();
  return repo;
}

/** Stores the five link files `ox init` creates as project `app`'s binding. */
async function seedBinding(): Promise<void> {
  const source = join(scratch, `binding-src-${caseNo}`);
  mkdirSync(source, { recursive: true });
  for (const file of FIVE_FILES) writeFileSync(join(source, file), `content of ${file}\n`);
  await writeBinding('app', source, FIVE_FILES);
}

interface Recorded { order: string[]; artifacts: CreateReviewArtifactInput[]; pushes: number }

function makeDeps(overrides: Partial<CommitDeps> = {}): Partial<CommitDeps> & { recorded: Recorded } {
  const recorded: Recorded = { order: [], artifacts: [], pushes: 0 };
  return {
    recorded,
    run: async (cmd, args, opts) => {
      if (cmd !== 'git') throw new Error(`unexpected command: ${cmd}`);
      if (args.includes('push')) recorded.pushes++;
      const { stdout } = await execFileAsync('git', args, { cwd: opts.cwd, env: gitEnv });
      return { stdout };
    },
    createArtifact: async (forge, input) => {
      recorded.order.push('createArtifact');
      recorded.artifacts.push(input);
      return { forge, url: PR_URL, created: true };
    },
    ...overrides,
  };
}

function worktreeCount(repo: string): number {
  return git(repo, ['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith('worktree ')).length;
}

function tmpEntries(): string[] {
  const tmp = join(overdeckHome, 'packs', 'sageox', 'tmp');
  return existsSync(tmp) ? readdirSync(tmp) : [];
}

function remoteBranchFiles(repo: string): string[] {
  git(repo, ['fetch', '-q', 'origin']);
  return git(repo, ['diff', '--name-only', `origin/main...origin/${SAGEOX_LINK_BRANCH}`]).split('\n').filter(Boolean).sort();
}

const EXPECTED = FIVE_FILES.map(file => `.sageox/${file}`).sort();

beforeEach(() => {
  rmSync(join(overdeckHome, 'packs'), { recursive: true, force: true });
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(overdeckHome, { recursive: true, force: true });
});

describe('commitSageoxBinding', () => {
  it('pushes overdeck/sageox-link with only the binding files, opens the PR, records the flag and removes the worktree', async () => {
    const repo = makeProject();
    await seedBinding();
    const before = git(repo, ['status', '--porcelain']);
    const deps = makeDeps();

    const result = await commitSageoxBinding('app', deps);

    expect(result).toEqual({ status: 'opened', url: PR_URL, created: true });
    expect(remoteBranchFiles(repo)).toEqual(EXPECTED);
    expect(git(repo, ['log', '-1', '--format=%s', `origin/${SAGEOX_LINK_BRANCH}`]).trim()).toBe('chore(sageox): add the SageOx link files');
    expect(deps.recorded.artifacts).toEqual([
      expect.objectContaining({
        title: 'Add the SageOx link files (.sageox/)',
        sourceBranch: SAGEOX_LINK_BRANCH,
        targetBranch: 'main',
        repository: undefined,
      }),
    ]);
    expect(deps.recorded.artifacts[0].body).toContain('Adds the SageOx link files created by `ox init` in host-managed mode');
    expect(await readSageoxBindingCommitted('app')).toBe(true);
    expect(worktreeCount(repo)).toBe(1);
    expect(tmpEntries()).toEqual([]);
    expect(git(repo, ['status', '--porcelain'])).toBe(before);
  });

  it('commits the files even when .git/info/exclude hides /.sageox/', async () => {
    const repo = makeProject();
    await seedBinding();
    appendFileSync(join(repo, '.git', 'info', 'exclude'), '/.sageox/\n');

    await commitSageoxBinding('app', makeDeps({ setCommitted: async () => ({ changed: true }) }));

    expect(remoteBranchFiles(repo)).toEqual(EXPECTED);
  });

  it('records the flag only after the PR exists, and not at all when opening it throws', async () => {
    makeProject();
    await seedBinding();
    const ok = makeDeps();
    ok.setCommitted = async () => {
      ok.recorded.order.push('setCommitted');
      return { changed: true };
    };
    await commitSageoxBinding('app', ok);
    expect(ok.recorded.order).toEqual(['createArtifact', 'setCommitted']);

    const repo = makeProject();
    await seedBinding();
    const failing = makeDeps({ createArtifact: async () => { throw new Error('gh pr create failed'); } });
    let recorded = false;
    failing.setCommitted = async () => {
      recorded = true;
      return { changed: true };
    };
    await expect(commitSageoxBinding('app', failing)).rejects.toThrow('gh pr create failed');
    expect(recorded).toBe(false);
    expect(worktreeCount(repo)).toBe(1);
  });

  it('re-running pushes the existing branch again and reuses the PR', async () => {
    const repo = makeProject();
    await seedBinding();
    await commitSageoxBinding('app', makeDeps({ setCommitted: async () => ({ changed: true }) }));
    const firstHead = git(repo, ['rev-parse', `origin/${SAGEOX_LINK_BRANCH}`]).trim();

    const again = makeDeps({
      setCommitted: async () => ({ changed: false }),
      createArtifact: async forge => ({ forge, url: PR_URL, created: false }),
    });
    const result = await commitSageoxBinding('app', again);

    expect(result).toEqual({ status: 'opened', url: PR_URL, created: false });
    expect(again.recorded.pushes).toBe(1);
    expect(git(repo, ['rev-parse', `origin/${SAGEOX_LINK_BRANCH}`]).trim()).toBe(firstHead);
    expect(worktreeCount(repo)).toBe(1);
  });

  it('returns already-committed and pushes nothing when main tracks .sageox/config.json', async () => {
    const repo = makeProject(true);
    await seedBinding();
    let recorded = false;
    const deps = makeDeps({ setCommitted: async () => { recorded = true; return { changed: true }; } });

    const result = await commitSageoxBinding('app', deps);

    expect(result).toEqual({ status: 'already-committed', branch: 'main' });
    expect(recorded).toBe(true);
    expect(deps.recorded.pushes).toBe(0);
    expect(deps.recorded.artifacts).toEqual([]);
    expect(worktreeCount(repo)).toBe(1);
    expect(git(repo, ['ls-remote', '--heads', 'origin', SAGEOX_LINK_BRANCH])).toBe('');
  });

  it('refuses a project without a binding', async () => {
    makeProject();
    const deps = makeDeps();
    await expect(commitSageoxBinding('app', deps)).rejects.toThrow(SageoxCommitError);
    await expect(commitSageoxBinding('app', deps)).rejects.toThrow('run pan skills pack sageox link --project app');
    expect(deps.recorded.pushes).toBe(0);
  });
});

describe('parseOriginRepository', () => {
  it('reads owner/repo from https, ssh and scp URLs and rejects local paths', () => {
    expect(parseOriginRepository('https://github.com/acme/app.git\n')).toBe('acme/app');
    expect(parseOriginRepository('git@github.com:acme/app.git')).toBe('acme/app');
    expect(parseOriginRepository('ssh://git@gitlab.example.com:2222/group/sub/app.git')).toBe('group/sub/app');
    expect(parseOriginRepository('/tmp/origin.git')).toBeUndefined();
  });
});
