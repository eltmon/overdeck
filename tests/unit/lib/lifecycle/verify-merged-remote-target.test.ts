import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { verifyConventionBranchMerged } from '../../../../src/lib/lifecycle/verify-merged.js';

const execAsync = promisify(exec);

const GIT_IDENTITY = '-c user.email=t@example.com -c user.name=T -c commit.gpgsign=false';

async function run(command: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(command, { cwd, encoding: 'utf-8' });
  return stdout.trim();
}

async function commit(cwd: string, file: string, message: string): Promise<string> {
  writeFileSync(join(cwd, file), `${message}\n`);
  await run(`git ${GIT_IDENTITY} add ${file}`, cwd);
  await run(`git ${GIT_IDENTITY} commit -m "${message}"`, cwd);
  return run('git rev-parse HEAD', cwd);
}

interface Fixture {
  tmpRoot: string;
  originPath: string;
  primaryPath: string;
  c1: string;
}

async function createFixture(tmpRoot: string): Promise<Fixture> {
  const originPath = join(tmpRoot, 'origin.git');
  const primaryPath = join(tmpRoot, 'primary');
  const otherPath = join(tmpRoot, 'other');

  mkdirSync(originPath, { recursive: true });
  await run('git init --bare --initial-branch=main', originPath);

  await run(`git clone ${originPath} ${primaryPath}`, tmpRoot);
  await run(`git ${GIT_IDENTITY} checkout -B main`, primaryPath);
  const c1 = await commit(primaryPath, 'c1.txt', 'c1');
  await run('git push origin main', primaryPath);

  await run(`git clone ${originPath} ${otherPath}`, tmpRoot);
  await commit(otherPath, 'c2.txt', 'c2');
  await commit(otherPath, 'c3.txt', 'c3');
  await run('git push origin main', otherPath);
  await run('git push origin main:feature/pan-900', otherPath);

  await run('git fetch origin feature/pan-900:feature/pan-900', primaryPath);

  return { tmpRoot, originPath, primaryPath, c1 };
}

describe('verify-merged real-git fixtures (PAN-5209: stale local main)', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = undefined;
    }
  });

  it('passes when local main is stale and the feature branch equals origin/main', async () => {
    tmpRoot = join(tmpdir(), `overdeck-verify-merged-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpRoot, { recursive: true });
    const { primaryPath, c1 } = await createFixture(tmpRoot);

    const result = await verifyConventionBranchMerged(
      { issueId: 'PAN-900', projectPath: primaryPath },
      { repoKey: 'myn-skills', dir: primaryPath, sourceBranch: 'feature/pan-900', targetBranch: 'main', forge: 'github' },
    );

    expect(result?.success).toBe(true);
    expect(result?.details).toEqual(['All commits merged to main', 'Remote branch fully merged']);

    const localMain = await run('git rev-parse main', primaryPath);
    expect(localMain).toBe(c1);
  });

  it('fails when the feature branch has a commit not on origin/main', async () => {
    tmpRoot = join(tmpdir(), `overdeck-verify-merged-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpRoot, { recursive: true });
    const { primaryPath } = await createFixture(tmpRoot);
    await run('git checkout feature/pan-900', primaryPath);
    await commit(primaryPath, 'c4.txt', 'c4');

    const result = await verifyConventionBranchMerged(
      { issueId: 'PAN-900', projectPath: primaryPath },
      { repoKey: 'myn-skills', dir: primaryPath, sourceBranch: 'feature/pan-900', targetBranch: 'main', forge: 'github' },
    );

    expect(result?.success).toBe(false);
    expect(result?.error).toBe('1 unmerged commit(s) on feature/pan-900. Merge before closing out.');
  });

  it('falls back to the last-fetched origin/main and passes when it already contains the branch', async () => {
    tmpRoot = join(tmpdir(), `overdeck-verify-merged-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpRoot, { recursive: true });
    const { primaryPath, c1 } = await createFixture(tmpRoot);
    await run('git fetch origin', primaryPath);
    await run(`git remote set-url origin ${join(tmpRoot, 'missing.git')}`, primaryPath);

    const result = await verifyConventionBranchMerged(
      { issueId: 'PAN-900', projectPath: primaryPath },
      { repoKey: 'myn-skills', dir: primaryPath, sourceBranch: 'feature/pan-900', targetBranch: 'main', forge: 'github' },
    );

    expect(result?.success).toBe(true);
    expect(result?.details).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Checked against the last-fetched origin\/main because git fetch origin main failed: .+/)]),
    );

    const localMain = await run('git rev-parse main', primaryPath);
    expect(localMain).toBe(c1);
  });

  it('falls back to the last-fetched origin/main and says so on failure', async () => {
    tmpRoot = join(tmpdir(), `overdeck-verify-merged-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpRoot, { recursive: true });
    const { primaryPath } = await createFixture(tmpRoot);
    await run(`git remote set-url origin ${join(tmpRoot, 'missing.git')}`, primaryPath);

    const result = await verifyConventionBranchMerged(
      { issueId: 'PAN-900', projectPath: primaryPath },
      { repoKey: 'myn-skills', dir: primaryPath, sourceBranch: 'feature/pan-900', targetBranch: 'main', forge: 'github' },
    );

    expect(result?.success).toBe(false);
    expect(result?.error).toMatch(
      /^2 unmerged commit\(s\) on feature\/pan-900\. Merge before closing out\. \(Checked against the last-fetched origin\/main because git fetch origin main failed: .+\)$/,
    );
  });

  it('falls back to local main only when no origin/main exists', async () => {
    tmpRoot = join(tmpdir(), `overdeck-verify-merged-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpRoot, { recursive: true });
    const { primaryPath } = await createFixture(tmpRoot);
    await run('git update-ref -d refs/remotes/origin/main', primaryPath);
    await run(`git remote set-url origin ${join(tmpRoot, 'missing.git')}`, primaryPath);

    const result = await verifyConventionBranchMerged(
      { issueId: 'PAN-900', projectPath: primaryPath },
      { repoKey: 'myn-skills', dir: primaryPath, sourceBranch: 'feature/pan-900', targetBranch: 'main', forge: 'github' },
    );

    expect(result?.success).toBe(false);
    expect(result?.error).toMatch(/\(Checked against local main because git fetch origin main failed: .+\)$/);
  });

  it('fails when origin cannot be fetched and no local main exists', async () => {
    tmpRoot = join(tmpdir(), `overdeck-verify-merged-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpRoot, { recursive: true });
    const { primaryPath } = await createFixture(tmpRoot);
    await run('git checkout --detach', primaryPath);
    await run('git branch -D main', primaryPath);
    await run('git update-ref -d refs/remotes/origin/main', primaryPath);
    await run(`git remote set-url origin ${join(tmpRoot, 'missing.git')}`, primaryPath);

    const result = await verifyConventionBranchMerged(
      { issueId: 'PAN-900', projectPath: primaryPath },
      { repoKey: 'myn-skills', dir: primaryPath, sourceBranch: 'feature/pan-900', targetBranch: 'main', forge: 'github' },
    );

    expect(result?.success).toBe(false);
    expect(result?.error).toMatch(
      /^Cannot verify merge: git fetch origin main failed \(.+\) and neither origin\/main nor a local main branch exists$/,
    );
  });
});
