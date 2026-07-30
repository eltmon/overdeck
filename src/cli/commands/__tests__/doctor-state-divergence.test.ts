import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../../../lib/projects.js';
import { recordReconcileFailure } from '../../../lib/pan-dir/push-health.js';
import { STATE_BRANCH } from '../../../lib/state-read-home.js';
import { checkStateDivergence } from '../doctor-state-divergence.js';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

describe('doctor state divergence check', () => {
  let sandbox: string;
  let stateRoot: string;
  let remote: string;
  let project: ProjectConfig;
  const projectKey = 'doctor-divergence';
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'pan-doctor-state-divergence-'));
    process.env.OVERDECK_HOME = join(sandbox, 'home');
    stateRoot = join(process.env.OVERDECK_HOME, 'state', projectKey);
    remote = join(sandbox, 'origin.git');
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(remote, { recursive: true });
    project = { name: 'Doctor Divergence', path: stateRoot };

    git(stateRoot, 'init', '-q');
    git(stateRoot, 'config', 'user.email', 'test@overdeck.local');
    git(stateRoot, 'config', 'user.name', 'Overdeck Test');
    git(stateRoot, 'config', 'commit.gpgsign', 'false');
    git(remote, 'init', '--bare', '-q');
    git(stateRoot, 'remote', 'add', 'origin', remote);
    writeFileSync(join(stateRoot, 'migration-complete.json'), JSON.stringify({
      sourceMainSha: '0'.repeat(40),
      stateBranchSha: '0'.repeat(40),
      completedAt: '2026-07-30T00:00:00.000Z',
      version: 1,
    }));
    git(stateRoot, 'add', 'migration-complete.json');
    git(stateRoot, 'commit', '-q', '-m', 'seed state branch');
    git(stateRoot, 'branch', '-M', STATE_BRANCH);
    git(stateRoot, 'push', '-q', '-u', 'origin', STATE_BRANCH);
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(sandbox, { recursive: true, force: true });
  });

  async function check() {
    const results = await checkStateDivergence([{ key: projectKey, config: project }]);
    expect(results).toHaveLength(1);
    return results[0]!;
  }

  it('reports converged ahead and behind counts as ok', async () => {
    const result = await check();

    expect(result.status).toBe('ok');
    expect(result.name).toBe(`State Divergence: ${projectKey} (${project.name})`);
    expect(result.message).toContain('0 ahead / 0 behind origin');
    expect(result.message).toContain('reconcile failure streak: 0');
  });

  it('warns when the local state branch is at least ten commits ahead', async () => {
    for (let index = 1; index <= 12; index += 1) {
      git(stateRoot, 'commit', '-q', '--allow-empty', '-m', `local state commit ${index}`);
    }

    const result = await check();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('12 ahead / 0 behind origin');
    expect(result.fix).toContain(`git merge origin/${STATE_BRANCH}`);
  });

  it('reports an error at a three-failure streak and includes the last reason', async () => {
    for (let index = 1; index <= 3; index += 1) {
      recordReconcileFailure(project, {
        reason: `state conflict ${index}`,
        conflictedPaths: ['specs/shared.json'],
      });
    }

    const result = await check();
    expect(result.status).toBe('error');
    expect(result.message).toContain('reconcile failure streak: 3');
    expect(result.message).toContain('last failure: state conflict 3');
  });

  it('uses cached origin counts and labels them stale when fetch fails', async () => {
    git(stateRoot, 'remote', 'set-url', 'origin', join(sandbox, 'missing-origin.git'));

    const result = await check();
    expect(result.status).toBe('ok');
    expect(result.message).toContain('0 ahead / 0 behind origin (stale — fetch failed)');
  });

  it('skips projects without a completed state migration', async () => {
    const legacy = { name: 'Legacy', path: join(sandbox, 'legacy') } satisfies ProjectConfig;
    mkdirSync(legacy.path, { recursive: true });

    await expect(checkStateDivergence([{ key: 'legacy', config: legacy }])).resolves.toEqual([]);
  });
});
