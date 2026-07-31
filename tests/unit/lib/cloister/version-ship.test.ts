import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  runVersionShip,
  type VersionShipDeps,
} from '../../../../src/lib/cloister/version-ship.js';
import type { VersionSyncConfig } from '../../../../src/lib/projects.js';

const PROJECT_ROOT = '/repo';
const NOW = '2026-07-31T12:00:00.000Z';
const tempDirs: string[] = [];

interface FakeDeps extends VersionShipDeps {
  writeVersion: ReturnType<typeof vi.fn>;
  runCommand: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  hasChanges: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  push: ReturnType<typeof vi.fn>;
}

function fakeDeps(overrides: Partial<VersionShipDeps> = {}): FakeDeps {
  return {
    now: () => NOW,
    writeVersion: vi.fn(async () => {}),
    runCommand: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    readFile: vi.fn(async () => '"version": "1.2.3"'),
    hasChanges: vi.fn(async () => true),
    commit: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
    ...overrides,
  } as FakeDeps;
}

function config(overrides: Partial<VersionSyncConfig> = {}): VersionSyncConfig {
  return {
    set: [{ path: 'frontend/package.json', json_field: 'version' }],
    command: 'pnpm vsync',
    command_cwd: 'frontend',
    expect: [{ path: 'frontend/package.json', pattern: '"version": "{version}"' }],
    push: ['frontend'],
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('runVersionShip', () => {
  it('sets targets, runs the sync command, verifies paths, commits, and pushes', async () => {
    const deps = fakeDeps();

    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config(),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
    }, deps);

    expect(deps.writeVersion).toHaveBeenCalledWith('/repo/frontend/package.json', 'version', '1.2.3');
    expect(deps.runCommand).toHaveBeenCalledWith('pnpm vsync', '/repo/frontend');
    expect(deps.commit).toHaveBeenCalledWith(
      '/repo/frontend',
      ['package.json'],
      'chore: bump version to 1.2.3',
    );
    expect(deps.push).toHaveBeenCalledWith('/repo/frontend');
    expect(report).toEqual({
      status: 'passed',
      version: '1.2.3',
      batch: 'uat/myn-ember-0731',
      paths: [{ path: 'frontend/package.json', ok: true, detail: 'reports 1.2.3' }],
      at: NOW,
    });
  });

  it('returns partial with every missed path and still commits propagated changes', async () => {
    const deps = fakeDeps({
      readFile: vi.fn(async () => 'versionName "1.1"'),
    });

    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config({
        expect: [
          { path: 'frontend/package.json', pattern: '"version": "{version}"' },
          { path: 'frontend/android/app/build.gradle', pattern: 'versionName "{majorMinor}"' },
        ],
      }),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
    }, deps);

    expect(report.status).toBe('partial');
    expect(report.paths.filter(path => !path.ok).map(path => path.path)).toEqual([
      'frontend/package.json',
      'frontend/android/app/build.gradle',
    ]);
    expect(deps.commit).toHaveBeenCalledOnce();
    expect(deps.push).toHaveBeenCalledOnce();
  });

  it('returns failed with the stderr tail and never commits when the command fails', async () => {
    const stderr = `${'old output\n'.repeat(300)}final command failure`;
    const deps = fakeDeps({
      runCommand: vi.fn(async () => ({ exitCode: 2, stdout: '', stderr })),
    });

    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config(),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
    }, deps);

    expect(report.status).toBe('failed');
    expect(report.error).toContain('final command failure');
    expect(report.error?.length).toBeLessThanOrEqual(2_000);
    expect(deps.hasChanges).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });

  it('stages only declared set and expect paths relative to each repo', async () => {
    const deps = fakeDeps({
      readFile: vi.fn(async () => 'generated 1.2.3'),
    });

    await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config({
        set: [{ path: 'frontend/package.json', json_field: 'version' }],
        expect: [{ path: 'frontend/generated.txt', pattern: '{version}' }],
        push: ['frontend'],
      }),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
    }, deps);

    expect(deps.hasChanges).toHaveBeenCalledWith('/repo/frontend', [
      'package.json',
      'generated.txt',
    ]);
    expect(deps.commit).toHaveBeenCalledWith(
      '/repo/frontend',
      ['package.json', 'generated.txt'],
      'chore: bump version to 1.2.3',
    );
  });

  it('skips a no-op commit but still pushes a command that self-committed', async () => {
    const deps = fakeDeps({ hasChanges: vi.fn(async () => false) });

    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config(),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
    }, deps);

    expect(report.status).toBe('passed');
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.push).toHaveBeenCalledWith('/repo/frontend');
  });

  it('returns failed when the tracked-upstream push is rejected', async () => {
    const deps = fakeDeps({
      push: vi.fn(async () => { throw new Error('non-fast-forward'); }),
    });

    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config(),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
    }, deps);

    expect(report).toMatchObject({ status: 'failed', error: 'non-fast-forward' });
  });

  it('rejects a malformed version before changing files or running commands', async () => {
    const deps = fakeDeps();

    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config(),
      version: '1.2',
      batchName: 'uat/myn-ember-0731',
    }, deps);

    expect(report).toMatchObject({
      status: 'failed',
      error: 'invalid version "1.2"; expected X.Y.Z',
    });
    expect(deps.writeVersion).not.toHaveBeenCalled();
    expect(deps.runCommand).not.toHaveBeenCalled();
  });
});

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function runCommitGuard(subject: string): ReturnType<typeof spawnSync> {
  const repo = mkdtempSync(join(tmpdir(), 'version-ship-guard-'));
  tempDirs.push(repo);
  writeFileSync(join(repo, 'package.json'), '{\n  "name": "fixture",\n  "version": "1.0.0"\n}\n');
  runGit(repo, ['init']);
  runGit(repo, ['add', 'package.json']);
  runGit(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'test: initial']);
  writeFileSync(join(repo, 'package.json'), '{\n  "name": "fixture",\n  "version": "1.2.3"\n}\n');
  runGit(repo, ['add', 'package.json']);

  const bin = join(repo, 'bin');
  mkdirSync(bin);
  const npx = join(bin, 'npx');
  writeFileSync(npx, '#!/bin/sh\nexit 0\n');
  chmodSync(npx, 0o755);
  const messageFile = join(repo, 'COMMIT_EDITMSG');
  writeFileSync(messageFile, `${subject}\n`);

  return spawnSync('sh', [resolve(process.cwd(), '.husky/commit-msg'), messageFile], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
  });
}

describe('commit-msg version guard', () => {
  it('accepts the batch ship subject for a package version change', () => {
    const result = runCommitGuard('chore: bump version to 1.2.3');
    expect(result.status).toBe(0);
  });

  it('rejects an unrelated subject for the same package version change', () => {
    const result = runCommitGuard('chore: update package metadata');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('batch version ship step');
  });
});
