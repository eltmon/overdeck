import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  runVersionShip,
  VersionShipOperationError,
  type VersionShipDeps,
} from '../../../../src/lib/cloister/version-ship.js';
import type { VersionSyncConfig } from '../../../../src/lib/projects.js';
import {
  buildVersionShipDeps,
  redactVersionShipDiagnostic,
} from '../../../../src/lib/cloister/version-ship-deps.js';

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
  logDiagnostic: ReturnType<typeof vi.fn>;
}

function fakeDeps(overrides: Partial<VersionShipDeps> = {}): FakeDeps {
  return {
    now: () => NOW,
    resolveFile: vi.fn(async (root: string, path: string) => resolve(root, path)),
    resolveDirectory: vi.fn(async (root: string, path: string) => resolve(root, path)),
    writeVersion: vi.fn(async () => {}),
    runCommand: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    readFile: vi.fn(async () => '"version": "1.2.3"'),
    testPattern: vi.fn(async (pattern: string, content: string) => new RegExp(pattern).test(content)),
    verifyRepo: vi.fn(async () => {}),
    hasChanges: vi.fn(async () => true),
    commit: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
    logDiagnostic: vi.fn(),
    ...overrides,
  } as FakeDeps;
}

function allowedRepo(path: string, targetBranch = 'main') {
  return {
    path,
    targetBranch,
    expectedHead: 'prepared-head',
    expectedGitDir: `/git/${path}`,
  };
}

function config(overrides: Partial<VersionSyncConfig> = {}): VersionSyncConfig {
  return {
    set: [{ path: 'frontend/package.json', json_field: 'version' }],
    command: 'pnpm vsync',
    command_cwd: 'frontend',
    command_image: 'myn-version-sync:latest',
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
      allowedRepos: [allowedRepo('frontend')],
    }, deps);

    expect(deps.writeVersion).toHaveBeenCalledWith('/repo/frontend/package.json', 'version', '1.2.3');
    expect(deps.runCommand).toHaveBeenCalledWith(
      'pnpm vsync',
      '/repo/frontend',
      '/repo',
      'myn-version-sync:latest',
      ['frontend/package.json'],
    );
    expect(deps.commit).toHaveBeenCalledWith(
      '/repo/frontend',
      ['package.json'],
      'chore: bump version to 1.2.3',
    );
    expect(deps.push).toHaveBeenCalledWith('/repo/frontend', 'main');
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
      allowedRepos: [allowedRepo('frontend')],
    }, deps);

    expect(report.status).toBe('partial');
    expect(report.paths.filter(path => !path.ok).map(path => path.path)).toEqual([
      'frontend/package.json',
      'frontend/android/app/build.gradle',
    ]);
    expect(deps.commit).toHaveBeenCalledOnce();
    expect(deps.push).toHaveBeenCalledOnce();
  });

  it('keeps raw command stderr local and persists only a fixed failure summary', async () => {
    const stderr = 'registry token=secret-value final command failure';
    const deps = fakeDeps({
      runCommand: vi.fn(async () => ({ exitCode: 2, stdout: '', stderr })),
    });

    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config(),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
      allowedRepos: [allowedRepo('frontend')],
    }, deps);

    expect(report).toMatchObject({
      status: 'failed',
      errorCode: 'command-failed',
      error: 'version sync command failed (exit 2); inspect the local dashboard log',
    });
    expect(report.error).not.toContain('secret-value');
    expect(deps.logDiagnostic).toHaveBeenCalledWith(expect.stringContaining('secret-value'));
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
      allowedRepos: [allowedRepo('frontend')],
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

  it('skips a no-op commit but still verifies the explicit target push', async () => {
    const deps = fakeDeps({ hasChanges: vi.fn(async () => false) });

    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config(),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
      allowedRepos: [allowedRepo('frontend')],
    }, deps);

    expect(report.status).toBe('passed');
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.push).toHaveBeenCalledWith('/repo/frontend', 'main');
  });

  it('returns a redacted failure when the explicit target push is rejected', async () => {
    const deps = fakeDeps({
      push: vi.fn(async () => { throw new VersionShipOperationError('push-failed', 'could not push version commit to main'); }),
    });

    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config(),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
      allowedRepos: [allowedRepo('frontend')],
    }, deps);

    expect(report).toMatchObject({
      status: 'failed',
      errorCode: 'push-failed',
      error: 'could not push version commit to main',
    });
  });

  it('rejects a malformed version before changing files or running commands', async () => {
    const deps = fakeDeps();

    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config(),
      version: '1.2',
      batchName: 'uat/myn-ember-0731',
      allowedRepos: [allowedRepo('frontend')],
    }, deps);

    expect(report).toMatchObject({
      status: 'failed',
      errorCode: 'invalid-version',
      error: 'version must look like 48.8.0',
    });
    expect(deps.writeVersion).not.toHaveBeenCalled();
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'version_sync.expect must contain at least one entry'],
    [{ expect: [], push: [] }, 'version_sync.expect must contain at least one entry'],
    [{ expect: [{ path: 'frontend/package.json', pattern: '"version"' }] }, 'version_sync.push must contain at least one repository'],
  ] as const)('rejects no-op runner config %# before changing files', async (invalidConfig, error) => {
    const deps = fakeDeps();
    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: invalidConfig,
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
      allowedRepos: [allowedRepo('frontend')],
    }, deps);

    expect(report).toMatchObject({ status: 'failed', errorCode: 'path-validation-failed', error });
    expect(deps.writeVersion).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });

  it('rejects a declared output not covered by exactly one push repository', async () => {
    const deps = fakeDeps();
    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config({
        set: [{ path: 'frontend/package.json', json_field: 'version' }],
        expect: [{ path: 'api/version.txt', pattern: '{version}' }],
        push: ['frontend'],
      }),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
      allowedRepos: [allowedRepo('frontend'), allowedRepo('api')],
    }, deps);

    expect(report).toMatchObject({
      status: 'failed',
      errorCode: 'path-validation-failed',
      error: 'version_sync output is not covered by a push repository: api/version.txt',
    });
    expect(deps.writeVersion).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });

  it('rejects an unsandboxed configured command before changing files', async () => {
    const deps = fakeDeps();
    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config({ command_image: undefined }),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
      allowedRepos: [allowedRepo('frontend')],
    }, deps);

    expect(report).toMatchObject({
      status: 'failed',
      errorCode: 'path-validation-failed',
      error: 'version_sync.command_image is required to sandbox the version sync command',
    });
    expect(deps.writeVersion).not.toHaveBeenCalled();
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('rejects a push path that is not one of the registered project repositories', async () => {
    const deps = fakeDeps();
    const report = await runVersionShip({
      projectRoot: PROJECT_ROOT,
      config: config({ push: ['elsewhere'] }),
      version: '1.2.3',
      batchName: 'uat/myn-ember-0731',
      allowedRepos: [allowedRepo('frontend')],
    }, deps);

    expect(report).toMatchObject({ status: 'failed', errorCode: 'path-validation-failed' });
    expect(deps.writeVersion).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });

  it('rejects a set target whose path traverses a symlink', async () => {
    const root = mkdtempSync(join(tmpdir(), 'version-ship-symlink-'));
    const outside = mkdtempSync(join(tmpdir(), 'version-ship-outside-'));
    tempDirs.push(root, outside);
    writeFileSync(join(outside, 'package.json'), '{"version":"1.0.0"}\n');
    symlinkSync(join(outside, 'package.json'), join(root, 'package.json'));

    const report = await runVersionShip({
      projectRoot: root,
      config: { set: [{ path: 'package.json', json_field: 'version' }], push: ['.'] },
      version: '1.2.3',
      batchName: 'uat/pan-ember-0731',
      allowedRepos: [allowedRepo('.')],
    }, buildVersionShipDeps());

    expect(report).toMatchObject({ status: 'failed', errorCode: 'path-validation-failed' });
    expect(readFileSync(join(outside, 'package.json'), 'utf-8')).toContain('1.0.0');
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

describe('version ship command sandbox', () => {
  it('runs the configured command without host credentials, network, hooks, or an unbounded lifetime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'version-ship-sandbox-'));
    const cwd = join(root, 'frontend');
    tempDirs.push(root);
    mkdirSync(cwd);
    writeFileSync(join(cwd, 'package.json'), '{"version":"1.2.3"}\n');
    const runDocker = vi.fn(async (args: string[]) => {
      if (args[0] === 'run') {
        const cidIndex = args.indexOf('--cidfile');
        writeFileSync(args[cidIndex + 1]!, 'sandbox-id\n');
      } else if (args[0] === 'cp') {
        const destination = args.at(-1)!;
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, '{"version":"1.2.3"}\n');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const deps = buildVersionShipDeps({ runDocker });

    await deps.runCommand(
      'pnpm vsync',
      cwd,
      root,
      'myn-version-sync:latest',
      ['frontend/package.json'],
    );

    expect(runDocker).toHaveBeenCalledTimes(5);
    const [args, dockerCwd] = runDocker.mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining([
      '--pull', 'never',
      '--network', 'none',
      '--read-only',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--env', 'CI=1',
      '--env', 'HOME=/tmp',
      'myn-version-sync:latest',
    ]));
    expect(args.some((arg: string) => /TOKEN|PASSWORD|SECRET|SSH_AUTH_SOCK/.test(arg))).toBe(false);
    expect(dockerCwd).toBe(root);
    const [commandArgs, commandCwd, commandTimeout] = runDocker.mock.calls[2]!;
    expect(commandArgs).toEqual([
      'exec', '--workdir', '/workspace/frontend', 'sandbox-id', 'pnpm', 'vsync',
    ]);
    expect(commandCwd).toBe(root);
    expect(commandTimeout).toBe(5 * 60 * 1000);
  });

  it('rejects metadata rewrites and symlink copyback before privileged Git runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'version-ship-sandbox-attack-'));
    const repo = join(root, 'repo');
    const ambient = mkdtempSync(join(tmpdir(), 'version-ship-ambient-'));
    tempDirs.push(root, ambient);
    mkdirSync(repo);
    writeFileSync(join(repo, '.git'), `gitdir: ${join(ambient, '.git')}\n`);
    writeFileSync(join(repo, 'package.json'), '{"version":"1.0.0"}\n');
    writeFileSync(join(ambient, 'package.json'), '{"version":"ambient"}\n');
    let metadataWasExported = true;
    const runDocker = vi.fn(async (args: string[]) => {
      if (args[0] === 'run') {
        const cidIndex = args.indexOf('--cidfile');
        writeFileSync(args[cidIndex + 1]!, 'sandbox-id\n');
        const mount = args.find(arg => arg.includes('dst=/input'))!;
        const inputRoot = /src=([^,]+)/.exec(mount)![1]!;
        metadataWasExported = existsSync(join(inputRoot, 'repo', '.git'));
      } else if (args[0] === 'cp') {
        const destination = args.at(-1)!;
        rmSync(dirname(destination), { recursive: true, force: true });
        symlinkSync(ambient, dirname(destination));
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const realDeps = buildVersionShipDeps({ runDocker });
    const deps = {
      ...realDeps,
      verifyRepo: vi.fn(realDeps.verifyRepo),
      hasChanges: vi.fn(realDeps.hasChanges),
      commit: vi.fn(realDeps.commit),
      push: vi.fn(realDeps.push),
    };

    const report = await runVersionShip({
      projectRoot: root,
      config: {
        set: [{ path: 'repo/package.json', json_field: 'version' }],
        command: 'node sync.js',
        command_cwd: 'repo',
        command_image: 'trusted-sync:latest',
        expect: [{ path: 'repo/package.json', pattern: '"version":"{version}"' }],
        push: ['repo'],
      },
      version: '9.9.9',
      batchName: 'uat/pan-sandbox-attack',
      allowedRepos: [allowedRepo('repo')],
    }, deps);

    expect(report).toMatchObject({ status: 'failed', errorCode: 'path-validation-failed' });
    expect(metadataWasExported).toBe(false);
    expect(readFileSync(join(repo, '.git'), 'utf-8')).toContain(ambient);
    expect(readFileSync(join(ambient, 'package.json'), 'utf-8')).toContain('ambient');
    expect(deps.verifyRepo).not.toHaveBeenCalled();
    expect(deps.hasChanges).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });
});

describe('version ship diagnostic redaction', () => {
  it('bounds attacker-controlled diagnostics before applying secret patterns', () => {
    const token = `ghp_${'A'.repeat(36)}`;
    const redacted = redactVersionShipDiagnostic(`${'X'.repeat(1024 * 1024)}${token}`);

    expect(redacted.length).toBeLessThanOrEqual(2_000);
    expect(redacted).not.toContain(token);
    expect(redacted).toContain('[REDACTED_TOKEN]');
  });

  it('redacts standalone credential formats before local logging', () => {
    const diagnostic = [
      `ghp_${'A'.repeat(36)}`,
      `glpat-${'B'.repeat(24)}`,
      `npm_${'C'.repeat(32)}`,
      `AKIA${'D'.repeat(16)}`,
      'eyJheader.payload.signature',
      '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
    ].join(' ');

    const redacted = redactVersionShipDiagnostic(diagnostic);

    expect(redacted).not.toContain('ghp_');
    expect(redacted).not.toContain('glpat-');
    expect(redacted).not.toContain('npm_');
    expect(redacted).not.toContain('AKIA');
    expect(redacted).not.toContain('eyJheader');
    expect(redacted).not.toContain('secret');
  });
});

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
