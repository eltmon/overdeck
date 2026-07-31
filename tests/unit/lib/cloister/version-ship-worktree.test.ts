import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

    const hookMarker = join(fixture, 'hook-ran');
    mkdirSync(join(source, '.hooks'));
    writeFileSync(join(source, '.hooks', 'pre-commit'), `#!/bin/sh\ntouch "${hookMarker}"\nexit 1\n`);
    chmodSync(join(source, '.hooks', 'pre-commit'), 0o755);
    git(source, ['config', 'core.hooksPath', '.hooks']);
    writeFileSync(join(source, 'package.json'), '{"version":"2.0.0"}\n');
    git(source, ['add', 'package.json', '.hooks/pre-commit']);
    git(source, ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'promoted merge']);
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
    expect(existsSync(hookMarker)).toBe(false);

    // A record-write failure after the first push must be recoverable. The retry
    // keeps mergeSha as ancestry evidence but starts from the fetched target head.
    const retry = await withVersionShipWorkspace([{
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
      version: '4.0.0',
      batchName: 'uat/pan-worktree-0731',
      allowedRepos: workspace.allowedRepos,
    }, buildVersionShipDeps()));

    expect(retry.status).toBe('passed');
    expect(git(source, ['show', 'origin/main:package.json'])).toContain('4.0.0');
  });

  it('refuses privileged Git when prepared worktree metadata changes', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'version-ship-identity-test-'));
    const remote = join(fixture, 'remote.git');
    const source = join(fixture, 'source');
    const ambient = join(fixture, 'ambient');
    tempDirs.push(fixture);
    git(fixture, ['init', '--bare', remote]);
    git(fixture, ['clone', remote, source]);
    git(source, ['switch', '-c', 'main']);
    git(source, ['config', 'user.name', 'Fixture']);
    git(source, ['config', 'user.email', 'fixture@example.com']);
    writeFileSync(join(source, 'package.json'), '{"version":"2.0.0"}\n');
    git(source, ['add', 'package.json']);
    git(source, ['commit', '-m', 'promoted merge']);
    const mergeSha = git(source, ['rev-parse', 'HEAD']);
    git(source, ['push', '-u', 'origin', 'main']);

    git(fixture, ['init', ambient]);
    git(ambient, ['config', 'user.name', 'Fixture']);
    git(ambient, ['config', 'user.email', 'fixture@example.com']);
    writeFileSync(join(ambient, 'package.json'), '{"version":"ambient"}\n');
    git(ambient, ['add', 'package.json']);
    git(ambient, ['commit', '-m', 'ambient']);
    const ambientHead = git(ambient, ['rev-parse', 'HEAD']);

    const report = await withVersionShipWorkspace([{
      repoKey: 'fixture',
      repoPath: source,
      configPath: '.',
      mergeSha,
      targetBranch: 'main',
    }], workspace => {
      writeFileSync(join(workspace.projectRoot, '.git'), `gitdir: ${join(ambient, '.git')}\n`);
      return runVersionShip({
        projectRoot: workspace.projectRoot,
        config: {
          set: [{ path: 'package.json', json_field: 'version' }],
          expect: [{ path: 'package.json', pattern: '"version":"{version}"' }],
          push: ['.'],
        },
        version: '3.0.0',
        batchName: 'uat/pan-identity-0731',
        allowedRepos: workspace.allowedRepos,
      }, buildVersionShipDeps());
    });

    expect(report).toMatchObject({ status: 'failed', errorCode: 'workspace-failed' });
    expect(git(source, ['show', 'origin/main:package.json'])).toContain('2.0.0');
    expect(git(ambient, ['rev-parse', 'HEAD'])).toBe(ambientHead);
    expect(readFileSync(join(ambient, 'package.json'), 'utf-8')).toContain('ambient');
  });

  it('recovers when one polyrepo push landed before a later repository rejected', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'version-ship-polyrepo-retry-'));
    tempDirs.push(fixture);

    const setupRepo = (name: string) => {
      const remote = join(fixture, `${name}.git`);
      const source = join(fixture, name);
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
      return { source, mergeSha };
    };

    const one = setupRepo('one');
    const two = setupRepo('two');
    const repos = [
      { repoKey: 'one', repoPath: one.source, configPath: 'one', mergeSha: one.mergeSha, targetBranch: 'main' },
      { repoKey: 'two', repoPath: two.source, configPath: 'two', mergeSha: two.mergeSha, targetBranch: 'main' },
    ];
    const ship = (version: string, beforeRun?: () => void) => withVersionShipWorkspace(repos, workspace => {
      beforeRun?.();
      return runVersionShip({
        projectRoot: workspace.projectRoot,
        config: {
          set: [
            { path: 'one/package.json', json_field: 'version' },
            { path: 'two/package.json', json_field: 'version' },
          ],
          expect: [
            { path: 'one/package.json', pattern: '"version":"{version}"' },
            { path: 'two/package.json', pattern: '"version":"{version}"' },
          ],
          push: ['one', 'two'],
        },
        version,
        batchName: 'uat/pan-polyrepo-0731',
        allowedRepos: workspace.allowedRepos,
      }, buildVersionShipDeps());
    });

    const first = await ship('3.0.0', () => {
      writeFileSync(join(two.source, 'concurrent.txt'), 'advanced\n');
      git(two.source, ['add', 'concurrent.txt']);
      git(two.source, ['commit', '-m', 'concurrent target advance']);
      git(two.source, ['push', 'origin', 'main']);
    });

    expect(first).toMatchObject({ status: 'failed', errorCode: 'push-failed' });
    expect(git(one.source, ['show', 'origin/main:package.json'])).toContain('3.0.0');
    expect(git(two.source, ['show', 'origin/main:package.json'])).toContain('2.0.0');

    const retry = await ship('4.0.0');

    expect(retry.status).toBe('passed');
    expect(git(one.source, ['show', 'origin/main:package.json'])).toContain('4.0.0');
    expect(git(two.source, ['show', 'origin/main:package.json'])).toContain('4.0.0');
  });
});
