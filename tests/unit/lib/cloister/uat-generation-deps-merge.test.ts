/**
 * PAN-5269: assembly must always cut a new batch head commit.
 *
 * A feature that already contains the base used to fast-forward, so the uat
 * branch pointed at the feature's existing head and GitHub ran no `uat/**`
 * push CI for it. Real git against a temp origin, no mocks.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUatGenerationGitDeps } from '../../../../src/lib/cloister/uat-generation-deps.js';

const execFileAsync = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await execFileAsync('git', args, { cwd })).stdout.trim();

let root = '';
let project = '';

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pan-5269-'));
  const origin = join(root, 'origin.git');
  project = join(root, 'project');
  await execFileAsync('git', ['init', '--bare', '-b', 'main', origin]);
  await execFileAsync('git', ['init', '-b', 'main', project]);
  await git(project, 'config', 'user.name', 'Test');
  await git(project, 'config', 'user.email', 'test@example.com');
  await git(project, 'config', 'commit.gpgsign', 'false');
  await git(project, 'remote', 'add', 'origin', origin);
  writeFileSync(join(project, 'a.txt'), 'a\n');
  await git(project, 'add', 'a.txt');
  await git(project, 'commit', '-m', 'base');
  await git(project, 'push', 'origin', 'main');
  // The feature branches off the current main, so it already contains the base.
  await git(project, 'switch', '-c', 'feature/pan-1');
  writeFileSync(join(project, 'b.txt'), 'b\n');
  await git(project, 'add', 'b.txt');
  await git(project, 'commit', '-m', 'feature');
  await git(project, 'push', 'origin', 'feature/pan-1');
  await git(project, 'switch', 'main');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('batch assembly merge (PAN-5269)', () => {
  it('cuts a new merge commit even when the feature already contains the base', async () => {
    const deps = buildUatGenerationGitDeps(project);
    const base = await deps.fetchMain();
    const worktree = join(project, 'workspaces', 'uat-pan-train-test-1114');
    await deps.createWorktree('uat/pan-train-test-1114', worktree);

    await expect(deps.mergeBranch('feature/pan-1')).resolves.toEqual({ ok: true });

    const featureHead = await git(project, 'rev-parse', 'origin/feature/pan-1');
    const batchHead = await git(worktree, 'rev-parse', 'HEAD');
    expect(batchHead).not.toBe(featureHead);
    // Two parents: the base it was cut from, then the feature.
    expect((await git(worktree, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ').slice(1)).toEqual([base, featureHead]);
  });
});
