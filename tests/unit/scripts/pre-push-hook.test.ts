import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HOOK_SOURCE = new URL('../../../.husky/pre-push', import.meta.url);

function makeHookFixture(): { root: string; hook: string } {
  const root = mkdtempSync(join(tmpdir(), 'pre-push-hook-'));
  const hook = join(root, '.husky', 'pre-push');
  mkdirSync(join(root, '.husky'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(hook, readFileSync(HOOK_SOURCE, 'utf-8'), { mode: 0o755 });
  writeFileSync(join(root, 'scripts', 'lint-file-size.sh'), '#!/usr/bin/env bash\nexit 0\n', {
    mode: 0o755,
  });
  writeFileSync(join(root, 'scripts', 'lint-ratchet-audit.sh'), '#!/usr/bin/env bash\nexit 0\n', {
    mode: 0o755,
  });
  writeFileSync(join(root, 'scripts', 'guard-state-plane-branches.sh'), '#!/usr/bin/env bash\nexit 0\n', {
    mode: 0o755,
  });
  writeFileSync(join(root, 'scripts', 'guard-hook-bundle-freshness.sh'), '#!/usr/bin/env bash\nexit 0\n', {
    mode: 0o755,
  });
  return { root, hook };
}

function runHook(root: string, hook: string, input: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync('sh', [hook], { cwd: root, input, encoding: 'utf-8' });
    return { ok: true, output };
  } catch (err: any) {
    return { ok: false, output: [err.stdout ?? '', err.stderr ?? ''].join('\n') };
  }
}

describe('.husky/pre-push', () => {
  it('runs the main-push guard when HEAD is pushed to refs/heads/main', () => {
    const { root, hook } = makeHookFixture();
    writeFileSync(
      join(root, 'scripts', 'guard-agent-main-push.sh'),
      '#!/usr/bin/env bash\necho guard-agent-main-push.sh invoked >&2\necho "$*" > guard-args.txt\nexit 42\n',
      { mode: 0o755 },
    );

    const localSha = '1111111111111111111111111111111111111111';
    const remoteSha = '2222222222222222222222222222222222222222';
    const result = runHook(root, hook, `HEAD ${localSha} refs/heads/main ${remoteSha}\n`);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('guard-agent-main-push.sh');
    expect(readFileSync(join(root, 'guard-args.txt'), 'utf-8').trim()).toBe(
      `--range ${remoteSha}..${localSha}`,
    );
  });

  it('does not run the main-push guard when HEAD is pushed to a feature branch', () => {
    const { root, hook } = makeHookFixture();
    writeFileSync(
      join(root, 'scripts', 'guard-agent-main-push.sh'),
      '#!/usr/bin/env bash\necho unexpected > guard-args.txt\nexit 42\n',
      { mode: 0o755 },
    );

    const result = runHook(
      root,
      hook,
      'HEAD 1111111111111111111111111111111111111111 refs/heads/feature 2222222222222222222222222222222222222222\n',
    );

    expect(result.ok).toBe(true);
    expect(existsSync(join(root, 'guard-args.txt'))).toBe(false);
  });

  it('audits feature branch ratchets from origin/main merge-base, not the remote feature sha', () => {
    const { root, hook } = makeHookFixture();
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
    writeFileSync(join(root, 'tracked.txt'), 'base\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'chore: base'], { cwd: root });
    const mainSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', mainSha], { cwd: root });

    writeFileSync(join(root, 'tracked.txt'), 'feature\n');
    execFileSync('git', ['commit', '-am', 'fix: feature change'], { cwd: root });
    const localSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
    const staleFeatureSha = '2222222222222222222222222222222222222222';
    writeFileSync(
      join(root, 'scripts', 'lint-ratchet-audit.sh'),
      '#!/usr/bin/env bash\necho "$*" > ratchet-args.txt\nexit 0\n',
      { mode: 0o755 },
    );

    const result = runHook(root, hook, `HEAD ${localSha} refs/heads/feature ${staleFeatureSha}\n`);

    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, 'ratchet-args.txt'), 'utf-8').trim()).toBe(
      `--range ${mainSha}..${localSha}`,
    );
  });

  it('skips the release guard for deleted release tags', () => {
    const { root, hook } = makeHookFixture();
    const zeroSha = '0000000000000000000000000000000000000000';
    const remoteSha = '2222222222222222222222222222222222222222';

    const result = runHook(root, hook, `${zeroSha} ${zeroSha} refs/tags/v1.2.3 ${remoteSha}\n`);

    expect(result.ok).toBe(true);
    expect(result.output).not.toContain('Refusing to push v1.2.3');
    expect(result.output).not.toContain('Release guard passed for v1.2.3');
  });
});
