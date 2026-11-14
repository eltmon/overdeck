import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

vi.mock('../../../../src/lib/forge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/forge.js')>();
  return {
    ...actual,
    getForgeAdapter: vi.fn(),
  };
});

import { getForgeAdapter, type ForgeAdapter } from '../../../../src/lib/forge.js';
import type { ResolvedProjectRepo } from '../../../../src/lib/project-repos.js';
import {
  assessRepoLanding,
  readForgeMergeVerdict,
  memoizeOnce,
  type RepoLandingEvidence,
} from '../../../../src/lib/lifecycle/dod-forge-merge.js';

const execAsync = promisify(exec);
const GIT_IDENTITY = '-c user.email=t@example.com -c user.name=T -c commit.gpgsign=false';

async function run(command: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(command, { cwd, encoding: 'utf-8' });
  return stdout.trim();
}

async function commit(cwd: string, file: string, message: string): Promise<void> {
  writeFileSync(join(cwd, file), `${message}\n`);
  await run(`git ${GIT_IDENTITY} add ${file}`, cwd);
  await run(`git ${GIT_IDENTITY} commit -m "${message}"`, cwd);
}

function stubFindMergedArtifact(impl: ReturnType<typeof vi.fn>): void {
  vi.mocked(getForgeAdapter).mockReturnValue({ findMergedArtifact: impl } as unknown as ForgeAdapter);
}

function makeRepo(overrides: Partial<ResolvedProjectRepo>): ResolvedProjectRepo {
  return {
    projectKey: 'myn',
    projectPath: overrides.repoPath ?? '',
    repoKey: 'fe',
    repoPath: '',
    forge: 'gitlab',
    sourceBranch: 'feature/pan-900',
    targetBranch: 'main',
    mergeOrder: 0,
    required: true,
    ...overrides,
  };
}

describe('dod-forge-merge: readForgeMergeVerdict', () => {
  it('rule 1: a throwing read is unverifiable', async () => {
    const verdict = await readForgeMergeVerdict(async () => { throw new Error('read exploded'); });
    expect(verdict).toEqual({ kind: 'unverifiable', text: 'forge merge state read failed: read exploded' });
  });

  it('rule 2: any unverifiable repo is unverifiable', async () => {
    const evidence: RepoLandingEvidence = {
      repos: [
        { repoKey: 'api', state: 'merged', url: 'https://gitlab.com/x/-/merge_requests/121', reason: '' },
        { repoKey: 'fe', state: 'unverifiable', reason: 'fe: merged-artifact lookup failed: glab mr list failed: 401' },
      ],
    };
    const verdict = await readForgeMergeVerdict(async () => evidence);
    expect(verdict).toEqual({
      kind: 'unverifiable',
      text: 'forge merge evidence unavailable: fe: merged-artifact lookup failed: glab mr list failed: 401',
    });
  });

  it('rule 3: no resolved repos is incomplete', async () => {
    const verdict = await readForgeMergeVerdict(async () => ({ repos: [] }));
    expect(verdict).toEqual({ kind: 'incomplete', text: 'forge merge incomplete: no repositories resolved' });
  });

  it('rule 4: any unlanded repo is incomplete', async () => {
    const evidence: RepoLandingEvidence = {
      repos: [
        { repoKey: 'fe', state: 'unlanded', reason: 'fe: feature/min-1 is not on origin/main and has no merged review artifact' },
      ],
    };
    const verdict = await readForgeMergeVerdict(async () => evidence);
    expect(verdict).toEqual({
      kind: 'incomplete',
      text: 'forge merge incomplete: fe: feature/min-1 is not on origin/main and has no merged review artifact',
    });
  });

  it('rule 5: no merged repo is incomplete', async () => {
    const evidence: RepoLandingEvidence = {
      repos: [{ repoKey: 'myn-skills', state: 'no-branch-work', reason: 'myn-skills: no feature/pan-900 branch' }],
    };
    const verdict = await readForgeMergeVerdict(async () => evidence);
    expect(verdict).toEqual({ kind: 'incomplete', text: 'forge merge incomplete: no repository has a merged review artifact' });
  });

  it('rule 6: at least one merged and nothing unlanded or unverifiable is complete', async () => {
    const evidence: RepoLandingEvidence = {
      repos: [
        { repoKey: 'fe', state: 'merged', url: 'https://gitlab.com/x/-/merge_requests/121', reason: '' },
        { repoKey: 'myn-skills', state: 'no-branch-work', reason: 'myn-skills: feature/pan-900 points at origin/main history' },
      ],
    };
    const verdict = await readForgeMergeVerdict(async () => evidence);
    expect(verdict).toEqual({
      kind: 'complete',
      text: 'forge merge complete: fe merged (https://gitlab.com/x/-/merge_requests/121), myn-skills no branch work',
    });
  });

  it('memoizeOnce calls read once across two awaits', async () => {
    const spy = vi.fn().mockResolvedValue({ repos: [] });
    const memoized = memoizeOnce(spy);
    await memoized();
    await memoized();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('dod-forge-merge: assessRepoLanding', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    vi.mocked(getForgeAdapter).mockReset();
    if (tmpRoot) {
      rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = undefined;
    }
  });

  async function createNoFastForwardFixture(): Promise<string> {
    tmpRoot = join(tmpdir(), `overdeck-dod-forge-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpRoot, { recursive: true });
    const originPath = join(tmpRoot, 'origin.git');
    const repoPath = join(tmpRoot, 'repo');

    mkdirSync(originPath, { recursive: true });
    await run('git init --bare --initial-branch=main', originPath);
    await run(`git clone ${originPath} ${repoPath}`, tmpRoot);
    await run(`git ${GIT_IDENTITY} checkout -B main`, repoPath);
    await commit(repoPath, 'c1.txt', 'c1');
    await run('git push origin main', repoPath);

    await run(`git ${GIT_IDENTITY} checkout -b feature/pan-900`, repoPath);
    await commit(repoPath, 'c2.txt', 'c2');
    await run('git push origin feature/pan-900', repoPath);

    await run(`git ${GIT_IDENTITY} checkout main`, repoPath);
    await run(`git ${GIT_IDENTITY} merge --no-ff -m merge feature/pan-900`, repoPath);
    await run('git push origin main', repoPath);

    return repoPath;
  }

  async function createEqualsMainFixture(): Promise<string> {
    tmpRoot = join(tmpdir(), `overdeck-dod-forge-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpRoot, { recursive: true });
    const originPath = join(tmpRoot, 'origin.git');
    const repoPath = join(tmpRoot, 'repo');

    mkdirSync(originPath, { recursive: true });
    await run('git init --bare --initial-branch=main', originPath);
    await run(`git clone ${originPath} ${repoPath}`, tmpRoot);
    await run(`git ${GIT_IDENTITY} checkout -B main`, repoPath);
    await commit(repoPath, 'c1.txt', 'c1');
    await run('git push origin main', repoPath);
    await run('git push origin main:feature/pan-900', repoPath);

    return repoPath;
  }

  it('(a) returns merged when the forge reports a merged artifact', async () => {
    const repoPath = await createNoFastForwardFixture();
    stubFindMergedArtifact(vi.fn().mockResolvedValue({
      forge: 'gitlab', created: false, url: 'https://gitlab.com/x/-/merge_requests/121', id: '121',
    }));

    const result = await assessRepoLanding(makeRepo({ repoKey: 'fe', repoPath }));

    expect(result).toEqual({ repoKey: 'fe', state: 'merged', url: 'https://gitlab.com/x/-/merge_requests/121', reason: '' });
  });

  it('(b) returns no-branch-work when the branch points at origin/main history', async () => {
    const repoPath = await createEqualsMainFixture();
    stubFindMergedArtifact(vi.fn().mockResolvedValue(null));

    const result = await assessRepoLanding(makeRepo({ repoKey: 'myn-skills', repoPath }));

    expect(result).toEqual({
      repoKey: 'myn-skills',
      state: 'no-branch-work',
      reason: 'myn-skills: feature/pan-900 points at origin/main history',
    });
  });

  it('(c) returns unlanded when the branch landed via a merge commit with no merged artifact', async () => {
    const repoPath = await createNoFastForwardFixture();
    stubFindMergedArtifact(vi.fn().mockResolvedValue(null));

    const result = await assessRepoLanding(makeRepo({ repoKey: 'fe', repoPath }));

    expect(result).toEqual({
      repoKey: 'fe',
      state: 'unlanded',
      reason: 'fe: feature/pan-900 work reached origin/main without a merged review artifact',
    });
  });

  it('(d) returns unverifiable when the forge lookup throws', async () => {
    stubFindMergedArtifact(vi.fn().mockRejectedValue(new Error('glab mr list failed: 401')));

    const result = await assessRepoLanding(makeRepo({ repoKey: 'fe', repoPath: tmpdir() }));

    expect(result).toEqual({
      repoKey: 'fe',
      state: 'unverifiable',
      reason: 'fe: merged-artifact lookup failed: glab mr list failed: 401',
    });
  });

  it('(e) returns unverifiable (never no-branch-work) when origin is unreachable', async () => {
    const repoPath = await createEqualsMainFixture();
    stubFindMergedArtifact(vi.fn().mockResolvedValue(null));
    await run(`git remote set-url origin ${join(tmpRoot!, 'missing.git')}`, repoPath);

    const result = await assessRepoLanding(makeRepo({ repoKey: 'fe', repoPath }));

    expect(result.state).toBe('unverifiable');
    expect(result.reason.startsWith('fe: git read failed:')).toBe(true);
  });

  async function createAddsNoChangesFixture(): Promise<string> {
    tmpRoot = join(tmpdir(), `overdeck-dod-forge-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpRoot, { recursive: true });
    const originPath = join(tmpRoot, 'origin.git');
    const repoPath = join(tmpRoot, 'repo');

    mkdirSync(originPath, { recursive: true });
    await run('git init --bare --initial-branch=main', originPath);
    await run(`git clone ${originPath} ${repoPath}`, tmpRoot);
    await run(`git ${GIT_IDENTITY} checkout -B main`, repoPath);
    await commit(repoPath, 'c1.txt', 'c1');
    await run('git push origin main', repoPath);

    await run(`git ${GIT_IDENTITY} checkout -b feature/pan-900`, repoPath);
    await commit(repoPath, 'x.txt', 'add x');
    await run(`git ${GIT_IDENTITY} rm x.txt`, repoPath);
    await run(`git ${GIT_IDENTITY} commit -m "remove x"`, repoPath);
    await run('git push origin feature/pan-900', repoPath);

    await run(`git ${GIT_IDENTITY} checkout main`, repoPath);
    return repoPath;
  }

  it('(f) returns no-branch-work when the branch is off main but adds no changes', async () => {
    const repoPath = await createAddsNoChangesFixture();
    stubFindMergedArtifact(vi.fn().mockResolvedValue(null));

    const result = await assessRepoLanding(makeRepo({ repoKey: 'myn-skills', repoPath }));

    expect(result).toEqual({
      repoKey: 'myn-skills',
      state: 'no-branch-work',
      reason: 'myn-skills: feature/pan-900 adds no changes over origin/main',
    });
  });

  it('(g) stays no-branch-work after main advances', async () => {
    const repoPath = await createAddsNoChangesFixture();
    stubFindMergedArtifact(vi.fn().mockResolvedValue(null));
    await commit(repoPath, 'c2.txt', 'c2');
    await run('git push origin main', repoPath);

    const result = await assessRepoLanding(makeRepo({ repoKey: 'myn-skills', repoPath }));

    expect(result).toEqual({
      repoKey: 'myn-skills',
      state: 'no-branch-work',
      reason: 'myn-skills: feature/pan-900 adds no changes over origin/main',
    });
  });

  it('(h) still returns unlanded when the off-main branch adds changes', async () => {
    const repoPath = await createAddsNoChangesFixture();
    stubFindMergedArtifact(vi.fn().mockResolvedValue(null));
    await run(`git ${GIT_IDENTITY} checkout feature/pan-900`, repoPath);
    await commit(repoPath, 'c2.txt', 'c2');
    await run('git push origin feature/pan-900', repoPath);
    await run(`git ${GIT_IDENTITY} checkout main`, repoPath);

    const result = await assessRepoLanding(makeRepo({ repoKey: 'myn-skills', repoPath }));

    expect(result).toEqual({
      repoKey: 'myn-skills',
      state: 'unlanded',
      reason: 'myn-skills: feature/pan-900 is not on origin/main and has no merged review artifact',
    });
  });
});
