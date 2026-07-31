import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runVersionShip } from '../../../../src/lib/cloister/version-ship.js';
import { buildVersionShipDeps } from '../../../../src/lib/cloister/version-ship-deps.js';
import { withVersionShipWorkspace } from '../../../../src/lib/cloister/version-ship-worktree.js';

const tempDirs: string[] = [];

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('version ship promoted worktree', () => {
  it('ships from the exact promoted merge while leaving a stale primary checkout untouched', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'version-ship-worktree-test-'));
    const remote = join(fixture, 'remote.git');
    const source = join(fixture, 'source');
    tempDirs.push(fixture);
    git(fixture, ['init', '--bare', remote]);
    git(fixture, ['clone', remote, source]);
    git(source, ['switch', '-c', 'main']);
    git(source, ['config', 'user.name', 'Fixture']);
    git(source, ['config', 'user.email', 'fixture@example.com']);

    writeFileSync(join(source, 'package.json'), '{"version":"1.0.0"}\n');
    git(source, ['add', 'package.json']);
    git(source, ['commit', '-m', 'initial']);
    git(source, ['push', '-u', 'origin', 'main']);

    writeFileSync(join(source, 'package.json'), '{"version":"2.0.0"}\n');
    git(source, ['add', 'package.json']);
    git(source, ['commit', '-m', 'promoted merge']);
    const mergeSha = git(source, ['rev-parse', 'HEAD']);
    git(source, ['push', 'origin', 'main']);

    // Simulate the stale ambient checkout that caused the review finding. Ship
    // must ignore this content and root its own worktree at mergeSha.
    writeFileSync(join(source, 'package.json'), '{"version":"1.0.0"}\n');

    const report = await withVersionShipWorkspace([{
      repoKey: 'fixture',
      repoPath: source,
      configPath: '.',
      mergeSha,
      targetBranch: 'main',
    }], workspace => runVersionShip({
      projectRoot: workspace.projectRoot,
      config: {
        set: [{ path: 'package.json', json_field: 'version' }],
        expect: [{ path: 'package.json', pattern: '"version":"{version}"' }],
        push: ['.'],
      },
      version: '3.0.0',
      batchName: 'uat/pan-worktree-0731',
      allowedRepos: workspace.allowedRepos,
    }, buildVersionShipDeps()));

    expect(report.status).toBe('passed');
    expect(git(source, ['show', 'origin/main:package.json'])).toContain('3.0.0');
    expect(readFileSync(join(source, 'package.json'), 'utf-8')).toContain('1.0.0');
  });
});
