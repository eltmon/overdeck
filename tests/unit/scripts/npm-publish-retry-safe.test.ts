import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// PAN-5595: npm-publish-retry-safe.sh skips a publish when the version is
// already visible, treats an E409 "previously staged version" as staged
// rather than a failure, polls npm view for visibility, and times out with
// maintainer approval instructions when the version never becomes visible.
const SCRIPT_SOURCE = new URL('../../../scripts/npm-publish-retry-safe.sh', import.meta.url);
const tempRoots: string[] = [];

const NPM_STUB = `#!/usr/bin/env bash
set -euo pipefail
root="\${STUB_ROOT:?}"
echo "$*" >> "$root/calls.log"

case "$1" in
  view)
    counter_file="$root/view-count"
    count=0
    if [ -f "$counter_file" ]; then
      count=$(cat "$counter_file")
    fi
    count=$((count + 1))
    echo "$count" > "$counter_file"
    threshold="\${FAKE_NPM_VISIBLE_FROM_VIEW:-0}"
    if [ "$threshold" -gt 0 ] && [ "$count" -ge "$threshold" ]; then
      echo "\${FAKE_NPM_VERSION}"
    fi
    exit 0
    ;;
  publish)
    mode="\${FAKE_NPM_PUBLISH:-ok}"
    case "$mode" in
      ok)
        echo "+ \${FAKE_NPM_VERSION}"
        exit 0
        ;;
      staged)
        echo 'npm error code E409' >&2
        echo 'npm error 409 Conflict - PUT https://registry.npmjs.org/@overdeck%2fcore - Cannot publish over previously staged version "0.90.0".' >&2
        exit 1
        ;;
      fail)
        echo 'npm error code E403' >&2
        echo 'npm error 403 Forbidden - PUT https://registry.npmjs.org/@overdeck%2fcore - You do not have permission to publish' >&2
        exit 1
        ;;
    esac
    ;;
esac
`;

function runScript(
  cwd: string,
  args: string[],
  env: Record<string, string>,
): { ok: boolean; status: number; output: string } {
  try {
    const output = execFileSync('bash', [SCRIPT_SOURCE.pathname, ...args], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    });
    return { ok: true, status: 0, output };
  } catch (error: any) {
    return {
      ok: false,
      status: typeof error.status === 'number' ? error.status : 1,
      output: [error.stdout ?? '', error.stderr ?? ''].join('\n'),
    };
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'npm-publish-retry-safe-'));
  tempRoots.push(root);
  return root;
}

function installStubNpm(root: string): void {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'npm'), NPM_STUB);
  chmodSync(join(bin, 'npm'), 0o755);
}

function buildPkgDir(root: string): string {
  const dir = join(root, 'pkg');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@overdeck/core', version: '0.90.0' }));
  return dir;
}

function buildTarball(root: string): string {
  const srcDir = join(root, 'tgz-src');
  mkdirSync(join(srcDir, 'package'), { recursive: true });
  writeFileSync(
    join(srcDir, 'package', 'package.json'),
    JSON.stringify({ name: '@overdeck/core', version: '0.90.0' }),
  );
  const tarball = join(root, 'core.tgz');
  execFileSync('tar', ['-czf', tarball, 'package'], { cwd: srcDir });
  return tarball;
}

function buildMalformedPkgDir(root: string): string {
  const dir = join(root, 'pkg-malformed');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{ not valid json');
  return dir;
}

function buildMalformedTarball(root: string): string {
  const srcDir = join(root, 'tgz-malformed-src');
  mkdirSync(join(srcDir, 'package'), { recursive: true });
  writeFileSync(join(srcDir, 'package', 'package.json'), '{ not valid json');
  const tarball = join(root, 'core-malformed.tgz');
  execFileSync('tar', ['-czf', tarball, 'package'], { cwd: srcDir });
  return tarball;
}

function baseEnv(root: string): Record<string, string> {
  return {
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    STUB_ROOT: root,
    FAKE_NPM_VERSION: '0.90.0',
    NPM_VISIBILITY_POLL_INTERVAL_SECONDS: '0',
    NPM_VISIBILITY_POLL_ATTEMPTS: '3',
  };
}

function readCallsLog(root: string): string[] {
  try {
    return execFileSync('cat', [join(root, 'calls.log')], { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('npm-publish-retry-safe.sh', () => {
  it('skips the publish when the version is already visible', () => {
    const root = makeRoot();
    installStubNpm(root);
    const dir = buildPkgDir(root);

    const result = runScript(root, ['--tag', 'latest', dir], { ...baseEnv(root), FAKE_NPM_VISIBLE_FROM_VIEW: '1' });

    expect(result.status).toBe(0);
    expect(result.output).toContain('already visible');
    const calls = readCallsLog(root);
    expect(calls.some((line) => line.startsWith('publish'))).toBe(false);
  });

  it('publishes then exits 0 once the version becomes visible', () => {
    const root = makeRoot();
    installStubNpm(root);
    const dir = buildPkgDir(root);

    const result = runScript(root, ['--tag', 'latest', dir], {
      ...baseEnv(root),
      FAKE_NPM_PUBLISH: 'ok',
      FAKE_NPM_VISIBLE_FROM_VIEW: '3',
    });

    expect(result.status).toBe(0);
    const calls = readCallsLog(root);
    const publishCalls = calls.filter((line) => line.startsWith('publish'));
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]).toContain('--ignore-scripts --provenance --access public --tag latest');
  });

  it('treats an E409 previously staged version as staged and polls', () => {
    const root = makeRoot();
    installStubNpm(root);
    const dir = buildPkgDir(root);

    const result = runScript(root, ['--tag', 'latest', dir], {
      ...baseEnv(root),
      FAKE_NPM_PUBLISH: 'staged',
      FAKE_NPM_VISIBLE_FROM_VIEW: '2',
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain('already staged');
    const calls = readCallsLog(root);
    const publishCalls = calls.filter((line) => line.startsWith('publish'));
    expect(publishCalls).toHaveLength(1);
  });

  it('fails with exit 3 and the approval steps when the poll times out', () => {
    const root = makeRoot();
    installStubNpm(root);
    const dir = buildPkgDir(root);

    const result = runScript(root, ['--tag', 'latest', dir], {
      ...baseEnv(root),
      FAKE_NPM_PUBLISH: 'staged',
    });

    expect(result.status).toBe(3);
    expect(result.output).toContain('::error::@overdeck/core@0.90.0 is not visible on npm after 3 checks');
    expect(result.output).toContain('npx --yes npm@11 stage list @overdeck/core');
    expect(result.output).toContain('npx --yes npm@11 stage view <stage-id>');
    expect(result.output).toContain('shows @overdeck/core and version 0.90.0');
    expect(result.output).toContain('npx --yes npm@11 stage approve <stage-id>');
    expect(result.output).toContain('Staged Packages in your npmjs.com account settings');
    expect(result.output).toContain('If stage list shows no staged 0.90.0');
    expect(result.output).toContain('Do not publish @overdeck/core@0.90.0 again');
    expect(result.output).not.toContain('https://www.npmjs.com/package/');
    const calls = readCallsLog(root);
    const viewCalls = calls.filter((line) => line.startsWith('view'));
    expect(viewCalls).toHaveLength(1 + 3);
  });

  it('propagates a real publish error without polling', () => {
    const root = makeRoot();
    installStubNpm(root);
    const dir = buildPkgDir(root);

    const result = runScript(root, ['--tag', 'latest', dir], { ...baseEnv(root), FAKE_NPM_PUBLISH: 'fail' });

    expect(result.status).toBe(1);
    expect(result.output).toContain('E403');
    const calls = readCallsLog(root);
    const viewCalls = calls.filter((line) => line.startsWith('view'));
    expect(viewCalls).toHaveLength(1);
  });

  it('publishes a tarball with the canary dist-tag', () => {
    const root = makeRoot();
    installStubNpm(root);
    const tarball = buildTarball(root);

    const result = runScript(root, ['--tag', 'canary', tarball], {
      ...baseEnv(root),
      FAKE_NPM_PUBLISH: 'ok',
      FAKE_NPM_VISIBLE_FROM_VIEW: '2',
    });

    expect(result.status).toBe(0);
    const calls = readCallsLog(root);
    const publishCalls = calls.filter((line) => line.startsWith('publish'));
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]).toContain(tarball);
    expect(publishCalls[0]).toContain('--tag canary');
  });

  it('exits non-zero and does not skip when the tarball package.json is malformed', () => {
    const root = makeRoot();
    installStubNpm(root);
    const tarball = buildMalformedTarball(root);

    const result = runScript(root, ['--tag', 'latest', tarball], { ...baseEnv(root), FAKE_NPM_VISIBLE_FROM_VIEW: '1' });

    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain('already visible');
    const calls = readCallsLog(root);
    expect(calls).toHaveLength(0);
  });

  it('exits non-zero and does not skip when the directory package.json is malformed', () => {
    const root = makeRoot();
    installStubNpm(root);
    const dir = buildMalformedPkgDir(root);

    const result = runScript(root, ['--tag', 'latest', dir], { ...baseEnv(root), FAKE_NPM_VISIBLE_FROM_VIEW: '1' });

    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain('already visible');
    const calls = readCallsLog(root);
    expect(calls).toHaveLength(0);
  });

  it('exits 2 with usage on bad arguments', () => {
    const root = makeRoot();
    installStubNpm(root);
    const dir = buildPkgDir(root);
    const env = baseEnv(root);

    const noArgs = runScript(root, [], env);
    expect(noArgs.status).toBe(2);
    expect(noArgs.output).toContain('usage:');

    const missingTag = runScript(root, [dir], env);
    expect(missingTag.status).toBe(2);
    expect(missingTag.output).toContain('usage:');

    const notAPackage = runScript(root, ['--tag', 'latest', join(root, 'nope')], env);
    expect(notAPackage.status).toBe(2);
    expect(notAPackage.output).toContain('usage:');
  });
});
