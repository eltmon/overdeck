import { afterEach, beforeEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { execSync } from 'child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { vi } from 'vitest';
import { deriveProjectRoot, flushAllPendingAutoCommits, flushAutoCommits, queueAutoCommit, reconcileStatePlaneDrift } from '../auto-commit.js';

function exec(root: string, command: string): string {
  return execSync(command, { cwd: root, encoding: 'utf-8' }).trim();
}

function configureGit(root: string): void {
  execSync('git config user.email t@e.t', { cwd: root });
  execSync('git config user.name "Test"', { cwd: root });
  execSync('git config commit.gpgsign false', { cwd: root });
}

function setBareOrigin(root: string): string {
  const remoteTmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-bare-'));
  execSync('git init --bare -q', { cwd: remoteTmp });
  execSync(`git remote set-url origin ${remoteTmp}`, { cwd: root });
  execSync('git push -q -u origin main', { cwd: root });
  return remoteTmp;
}

function makeOtherClone(remoteTmp: string): string {
  const otherTmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-other-'));
  execSync(`git clone -q -b main ${remoteTmp} ${otherTmp}`);
  configureGit(otherTmp);
  return otherTmp;
}

describe('auto-commit', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-'));
    execSync('git init -q', { cwd: tmp });
    configureGit(tmp);
    // Seed an initial commit so HEAD has a valid ref before any auto-commit
    // attempts to add files to the index.
    writeFileSync(join(tmp, 'README.md'), 'seed');
    execSync('git add README.md', { cwd: tmp });
    execSync('git commit -q -m "init"', { cwd: tmp });
    // Rename whatever the default branch is to `main` so the gate fires.
    execSync('git branch -M main', { cwd: tmp });
    // Add a self-referencing origin so the auto-commit fetch has a remote.
    execSync('git remote add origin .', { cwd: tmp });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it.effect('commits a queued .pan file change on main', () =>
    Effect.gen(function* () {
      mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
      const path = join(tmp, '.pan', 'continues', 'pan-1.vbrief.json');
      writeFileSync(path, '{"issue":"PAN-1"}');

      queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): update continue for PAN-1' });
      const result = yield* flushAutoCommits(tmp);

      expect(result.committed).toBe(true);
      const log = execSync('git log --oneline -1', { cwd: tmp, encoding: 'utf-8' });
      expect(log).toContain('chore(state): update continue for PAN-1');
    }),
  );

  it.effect('does not commit when on a non-main branch', () =>
    Effect.gen(function* () {
      execSync('git checkout -q -b feature/foo', { cwd: tmp });
      mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
      const path = join(tmp, '.pan', 'continues', 'pan-2.vbrief.json');
      writeFileSync(path, '{"issue":"PAN-2"}');

      queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): noop branch test' });
      const result = yield* flushAutoCommits(tmp);

      expect(result.committed).toBe(false);
      expect(result.reason).toMatch(/not on main/);
    }),
  );

  it.effect('coalesces a burst of writes into a single commit', () =>
    Effect.gen(function* () {
      mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
      const p1 = join(tmp, '.pan', 'continues', 'pan-3.vbrief.json');
      const p2 = join(tmp, '.pan', 'continues', 'pan-4.vbrief.json');
      writeFileSync(p1, '{"issue":"PAN-3"}');
      writeFileSync(p2, '{"issue":"PAN-4"}');

      queueAutoCommit({ projectRoot: tmp, paths: [p1], subject: 'chore(state): a' });
      queueAutoCommit({ projectRoot: tmp, paths: [p2], subject: 'chore(state): b' });
      const result = yield* flushAutoCommits(tmp);
      expect(result.committed).toBe(true);

      const log = execSync('git log --oneline', { cwd: tmp, encoding: 'utf-8' });
      // Two seed lines + exactly one auto-commit
      expect(log.split('\n').filter(Boolean).length).toBe(2);
    }),
  );

  it('flushes queued state on the next timer turn by default', async () => {
    vi.useFakeTimers();
    try {
      mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
      const p1 = join(tmp, '.pan', 'continues', 'pan-2375-a.vbrief.json');
      writeFileSync(p1, '{"issue":"PAN-2375-A"}');

      queueAutoCommit({ projectRoot: tmp, paths: [p1], subject: 'chore(state): immediate write-through' });
      expect(execSync('git log --oneline', { cwd: tmp, encoding: 'utf-8' })).not.toContain('immediate write-through');
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const log = execSync('git log --oneline', { cwd: tmp, encoding: 'utf-8' });
        if (log.includes('chore(state): immediate write-through')) {
          expect(log.split('\n').filter(Boolean).length).toBe(2);
          return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      const log = execSync('git log --oneline', { cwd: tmp, encoding: 'utf-8' });
      expect(log).toContain('chore(state): immediate write-through');
    } finally {
      vi.useRealTimers();
    }
  });

  it.effect('is a no-op when the staged diff is empty', () =>
    Effect.gen(function* () {
      mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
      const path = join(tmp, '.pan', 'continues', 'pan-5.vbrief.json');
      writeFileSync(path, '{"issue":"PAN-5"}');
      execSync('git add .pan/', { cwd: tmp });
      execSync('git commit -q -m "pre-commit"', { cwd: tmp });

      queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): nothing changed' });
      const result = yield* flushAutoCommits(tmp);

      expect(result.committed).toBe(false);
      expect(result.reason).toBe('no diff');
    }),
  );

  it.effect('pushes a flush commit to origin/main when the push fast-forwards', () =>
    Effect.gen(function* () {
      const remoteTmp = setBareOrigin(tmp);
      try {
        mkdirSync(join(tmp, '.pan', 'records'), { recursive: true });
        const path = join(tmp, '.pan', 'records', 'pan-2375.json');
        writeFileSync(path, '{"issue":"PAN-2375"}');

        queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): push state commit' });
        const result = yield* flushAutoCommits(tmp);

        expect(result.committed).toBe(true);
        const remoteLog = execSync('git log --oneline origin/main -1', { cwd: tmp, encoding: 'utf-8' });
        expect(remoteLog).toContain('chore(state): push state commit');
      } finally {
        rmSync(remoteTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('rebases state-only local commits after a rejected push and retries once', () =>
    Effect.gen(function* () {
      const remoteTmp = setBareOrigin(tmp);
      const otherTmp = makeOtherClone(remoteTmp);
      try {
        mkdirSync(join(otherTmp, '.pan', 'records'), { recursive: true });
        writeFileSync(join(otherTmp, '.pan', 'records', 'pan-remote.json'), '{"remote":true}\n');
        execSync('git add .pan/records/pan-remote.json', { cwd: otherTmp });
        execSync('git commit -q -m "chore(state): remote state"', { cwd: otherTmp });
        execSync('git push -q origin main', { cwd: otherTmp });

        mkdirSync(join(tmp, '.pan', 'records'), { recursive: true });
        const path = join(tmp, '.pan', 'records', 'pan-local.json');
        writeFileSync(path, '{"local":true}\n');

        queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): local state' });
        const result = yield* flushAutoCommits(tmp);

        expect(result.committed).toBe(true);
        expect(exec(tmp, 'git rev-parse HEAD')).toBe(exec(tmp, 'git rev-parse origin/main'));
        const remoteLog = execSync('git log --oneline origin/main -2', { cwd: tmp, encoding: 'utf-8' });
        expect(remoteLog).toContain('chore(state): local state');
        expect(remoteLog).toContain('chore(state): remote state');
      } finally {
        rmSync(remoteTmp, { recursive: true, force: true });
        rmSync(otherTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('does not rebase a rejected push when the working tree is dirty', () =>
    Effect.gen(function* () {
      const remoteTmp = setBareOrigin(tmp);
      const otherTmp = makeOtherClone(remoteTmp);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        mkdirSync(join(otherTmp, '.pan', 'records'), { recursive: true });
        writeFileSync(join(otherTmp, '.pan', 'records', 'pan-remote.json'), '{"remote":true}\n');
        execSync('git add .pan/records/pan-remote.json', { cwd: otherTmp });
        execSync('git commit -q -m "chore(state): remote state"', { cwd: otherTmp });
        execSync('git push -q origin main', { cwd: otherTmp });

        writeFileSync(join(tmp, 'README.md'), 'dirty\n');
        mkdirSync(join(tmp, '.pan', 'records'), { recursive: true });
        const path = join(tmp, '.pan', 'records', 'pan-local.json');
        writeFileSync(path, '{"local":true}\n');

        queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): local state' });
        const result = yield* flushAutoCommits(tmp);

        expect(result.committed).toBe(true);
        expect(exec(tmp, 'git rev-parse HEAD')).not.toBe(exec(tmp, 'git rev-parse origin/main'));
        expect(warn.mock.calls.some((call) => String(call[0]).includes('working tree is dirty'))).toBe(true);
      } finally {
        warn.mockRestore();
        rmSync(remoteTmp, { recursive: true, force: true });
        rmSync(otherTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('does not rebase a rejected push when local ahead commits include source changes', () =>
    Effect.gen(function* () {
      const remoteTmp = setBareOrigin(tmp);
      const otherTmp = makeOtherClone(remoteTmp);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(join(tmp, 'src', 'local.ts'), 'export const local = true;\n');
        execSync('git add src/local.ts', { cwd: tmp });
        execSync('git commit -q -m "feat: local source"', { cwd: tmp });

        mkdirSync(join(otherTmp, '.pan', 'records'), { recursive: true });
        writeFileSync(join(otherTmp, '.pan', 'records', 'pan-remote.json'), '{"remote":true}\n');
        execSync('git add .pan/records/pan-remote.json', { cwd: otherTmp });
        execSync('git commit -q -m "chore(state): remote state"', { cwd: otherTmp });
        execSync('git push -q origin main', { cwd: otherTmp });

        mkdirSync(join(tmp, '.pan', 'records'), { recursive: true });
        const path = join(tmp, '.pan', 'records', 'pan-local.json');
        writeFileSync(path, '{"local":true}\n');

        queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): local state' });
        const result = yield* flushAutoCommits(tmp);

        expect(result.committed).toBe(true);
        expect(exec(tmp, 'git rev-parse HEAD')).not.toBe(exec(tmp, 'git rev-parse origin/main'));
        expect(warn.mock.calls.some((call) => String(call[0]).includes('not state-plane-only'))).toBe(true);
      } finally {
        warn.mockRestore();
        rmSync(remoteTmp, { recursive: true, force: true });
        rmSync(otherTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('does not rebase when local source commits cancel out to a state-only net diff', () =>
    Effect.gen(function* () {
      const remoteTmp = setBareOrigin(tmp);
      const otherTmp = makeOtherClone(remoteTmp);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        mkdirSync(join(tmp, 'src'), { recursive: true });
        writeFileSync(join(tmp, 'src', 'transient.ts'), 'export const transient = true;\n');
        execSync('git add src/transient.ts', { cwd: tmp });
        execSync('git commit -q -m "feat: transient source"', { cwd: tmp });
        rmSync(join(tmp, 'src', 'transient.ts'));
        execSync('git add src/transient.ts', { cwd: tmp });
        execSync('git commit -q -m "revert: transient source"', { cwd: tmp });

        mkdirSync(join(otherTmp, '.pan', 'records'), { recursive: true });
        writeFileSync(join(otherTmp, '.pan', 'records', 'pan-remote.json'), '{"remote":true}\n');
        execSync('git add .pan/records/pan-remote.json', { cwd: otherTmp });
        execSync('git commit -q -m "chore(state): remote state"', { cwd: otherTmp });
        execSync('git push -q origin main', { cwd: otherTmp });

        mkdirSync(join(tmp, '.pan', 'records'), { recursive: true });
        const path = join(tmp, '.pan', 'records', 'pan-local.json');
        writeFileSync(path, '{"local":true}\n');

        queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): local state' });
        const result = yield* flushAutoCommits(tmp);

        expect(result.committed).toBe(true);
        expect(exec(tmp, 'git rev-parse HEAD')).not.toBe(exec(tmp, 'git rev-parse origin/main'));
        expect(warn.mock.calls.some((call) => String(call[0]).includes('not state-plane-only'))).toBe(true);
      } finally {
        warn.mockRestore();
        rmSync(remoteTmp, { recursive: true, force: true });
        rmSync(otherTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('does not rebase when local-ahead commit listing fails', () =>
    Effect.gen(function* () {
      const remoteTmp = setBareOrigin(tmp);
      const otherTmp = makeOtherClone(remoteTmp);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const previousPath = process.env.PATH;
      const realGit = execSync('command -v git', { encoding: 'utf-8' }).trim();
      const wrapperDir = mkdtempSync(join(tmpdir(), 'pan-autocommit-git-wrapper-'));
      try {
        mkdirSync(join(otherTmp, '.pan', 'records'), { recursive: true });
        writeFileSync(join(otherTmp, '.pan', 'records', 'pan-remote.json'), '{"remote":true}\n');
        execSync('git add .pan/records/pan-remote.json', { cwd: otherTmp });
        execSync('git commit -q -m "chore(state): remote state"', { cwd: otherTmp });
        execSync('git push -q origin main', { cwd: otherTmp });

        const wrapperPath = join(wrapperDir, 'git');
        writeFileSync(wrapperPath, [
          '#!/bin/sh',
          'if [ "$1" = "rev-list" ] && [ "$2" = "--reverse" ]; then',
          '  echo "simulated rev-list failure" >&2',
          '  exit 128',
          'fi',
          `exec ${realGit} "$@"`,
          '',
        ].join('\n'));
        chmodSync(wrapperPath, 0o755);
        process.env.PATH = `${wrapperDir}:${previousPath ?? ''}`;

        mkdirSync(join(tmp, '.pan', 'records'), { recursive: true });
        const path = join(tmp, '.pan', 'records', 'pan-local.json');
        writeFileSync(path, '{"local":true}\n');

        queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): local state' });
        const result = yield* flushAutoCommits(tmp);

        expect(result.committed).toBe(true);
        expect(exec(tmp, 'git rev-parse HEAD')).not.toBe(exec(tmp, 'git rev-parse origin/main'));
        expect(warn.mock.calls.some((call) => String(call[0]).includes('local-ahead commit list failed'))).toBe(true);
        expect(warn.mock.calls.some((call) => String(call[0]).includes('not state-plane-only'))).toBe(true);
      } finally {
        process.env.PATH = previousPath;
        warn.mockRestore();
        rmSync(wrapperDir, { recursive: true, force: true });
        rmSync(remoteTmp, { recursive: true, force: true });
        rmSync(otherTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('skips push when OVERDECK_STATE_AUTOPUSH is disabled', () =>
    Effect.gen(function* () {
      const remoteTmp = setBareOrigin(tmp);
      const previous = process.env.OVERDECK_STATE_AUTOPUSH;
      try {
        process.env.OVERDECK_STATE_AUTOPUSH = '0';
        mkdirSync(join(tmp, '.pan', 'records'), { recursive: true });
        const path = join(tmp, '.pan', 'records', 'pan-2375.json');
        writeFileSync(path, '{"issue":"PAN-2375"}');
        const beforeRemote = exec(tmp, 'git rev-parse origin/main');

        queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): local only' });
        const result = yield* flushAutoCommits(tmp);

        expect(result.committed).toBe(true);
        expect(exec(tmp, 'git rev-parse origin/main')).toBe(beforeRemote);
        expect(exec(tmp, 'git rev-parse HEAD')).not.toBe(beforeRemote);
      } finally {
        if (previous === undefined) {
          delete process.env.OVERDECK_STATE_AUTOPUSH;
        } else {
          process.env.OVERDECK_STATE_AUTOPUSH = previous;
        }
        rmSync(remoteTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('catches and logs push failures without failing the writer', () =>
    Effect.gen(function* () {
      const remoteTmp = setBareOrigin(tmp);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        execSync('git remote set-url origin /tmp/overdeck-missing-auto-push-remote', { cwd: tmp });
        mkdirSync(join(tmp, '.pan', 'records'), { recursive: true });
        const path = join(tmp, '.pan', 'records', 'pan-2375.json');
        writeFileSync(path, '{"issue":"PAN-2375"}');

        queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): push failure' });
        const result = yield* flushAutoCommits(tmp);

        expect(result).toMatchObject({ committed: true, pushed: false });
        expect(result.reason).toContain('push failed');
        expect(warn.mock.calls.some((call) => String(call[0]).includes('push failed'))).toBe(true);
      } finally {
        warn.mockRestore();
        rmSync(remoteTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('rebases local state-only commits even when origin/main contains source commits', () =>
    Effect.gen(function* () {
      const remoteTmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-remote-'));
      const otherTmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-other-'));
      try {
        execSync('git init --bare -q', { cwd: remoteTmp });
        execSync(`git remote set-url origin ${remoteTmp}`, { cwd: tmp });
        execSync('git push -q -u origin main', { cwd: tmp });

        execSync(`git clone -q -b main ${remoteTmp} ${otherTmp}`);
        execSync('git config user.email t@e.t', { cwd: otherTmp });
        execSync('git config user.name "Test"', { cwd: otherTmp });
        execSync('git config commit.gpgsign false', { cwd: otherTmp });
        writeFileSync(join(otherTmp, 'UPSTREAM.md'), 'remote change');
        execSync('git add UPSTREAM.md', { cwd: otherTmp });
        execSync('git commit -q -m "upstream change"', { cwd: otherTmp });
        execSync('git push -q origin main', { cwd: otherTmp });
        const upstreamHead = execSync('git rev-parse HEAD', { cwd: otherTmp, encoding: 'utf-8' }).trim();

        const localBase = execSync('git rev-parse HEAD', { cwd: tmp, encoding: 'utf-8' }).trim();
        mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
        const path = join(tmp, '.pan', 'continues', 'pan-2375.vbrief.json');
        writeFileSync(path, '{"issue":"PAN-2375"}');

        queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): update continue for PAN-2375' });
        const result = yield* flushAutoCommits(tmp);

        expect(result.committed).toBe(true);
        const commitParent = execSync('git rev-parse HEAD^', { cwd: tmp, encoding: 'utf-8' }).trim();
        const remoteHead = execSync('git rev-parse origin/main', { cwd: tmp, encoding: 'utf-8' }).trim();

        expect(commitParent).toBe(upstreamHead);
        expect(remoteHead).not.toBe(localBase);
        expect(exec(tmp, 'git rev-parse HEAD')).toBe(remoteHead);
        const pushedLog = execSync('git log --oneline origin/main -2', { cwd: tmp, encoding: 'utf-8' });
        expect(pushedLog).toContain('chore(state): update continue for PAN-2375');
        expect(pushedLog).toContain('upstream change');
      } finally {
        rmSync(remoteTmp, { recursive: true, force: true });
        rmSync(otherTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('commits to repoRoot when provided (PAN-1908 infra repo)', () =>
    Effect.gen(function* () {
      const infraTmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-infra-'));
      try {
        execSync('git init -q', { cwd: infraTmp });
        execSync('git config user.email t@e.t', { cwd: infraTmp });
        execSync('git config user.name "Test"', { cwd: infraTmp });
        execSync('git config commit.gpgsign false', { cwd: infraTmp });
        writeFileSync(join(infraTmp, 'README.md'), 'seed');
        execSync('git add README.md', { cwd: infraTmp });
        execSync('git commit -q -m "init"', { cwd: infraTmp });
        execSync('git branch -M main', { cwd: infraTmp });
        execSync('git remote add origin .', { cwd: infraTmp });

        mkdirSync(join(infraTmp, '.pan', 'records'), { recursive: true });
        const path = join(infraTmp, '.pan', 'records', 'pan-1908.json');
        writeFileSync(path, '{}');

        queueAutoCommit({
          projectRoot: tmp,
          repoRoot: infraTmp,
          paths: [path],
          subject: 'chore(records): update PAN-1908',
        });
        const result = yield* flushAutoCommits(tmp);

        expect(result.committed).toBe(true);
        const log = execSync('git log --oneline -1', { cwd: infraTmp, encoding: 'utf-8' });
        expect(log).toContain('chore(records): update PAN-1908');
      } finally {
        rmSync(infraTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('commits migrated state only on overdeck-state and asserts the branch', () =>
    Effect.gen(function* () {
      const stateTmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-state-'));
      try {
        execSync('git init -q', { cwd: stateTmp });
        configureGit(stateTmp);
        writeFileSync(join(stateTmp, 'migration-complete.json'), '{}\n');
        execSync('git add migration-complete.json', { cwd: stateTmp });
        execSync('git commit -q -m "state marker"', { cwd: stateTmp });
        execSync('git branch -M overdeck-state', { cwd: stateTmp });
        execSync('git remote add origin .', { cwd: stateTmp });
        mkdirSync(join(stateTmp, 'records'));
        const path = join(stateTmp, 'records', 'pan-2541.json');
        writeFileSync(path, '{}\n');

        queueAutoCommit({ projectRoot: tmp, repoRoot: stateTmp, paths: [path], subject: 'chore(state): state branch' });
        expect(yield* flushAutoCommits(tmp)).toEqual({ committed: true, pushed: true });
        expect(exec(stateTmp, 'git branch --show-current')).toBe('overdeck-state');

        execSync('git branch -M wrong-state', { cwd: stateTmp });
        writeFileSync(path, '{"changed":true}\n');
        queueAutoCommit({ projectRoot: tmp, repoRoot: stateTmp, paths: [path], subject: 'chore(state): reject wrong branch' });
        expect((yield* flushAutoCommits(tmp)).reason).toContain('expected overdeck-state');
      } finally {
        rmSync(stateTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('is a no-op outside a git repo', () =>
    Effect.gen(function* () {
      const noGitTmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-nogit-'));
      try {
        queueAutoCommit({ projectRoot: noGitTmp, paths: [join(noGitTmp, 'x')], subject: 'chore(state): no repo' });
        const result = yield* flushAutoCommits(noGitTmp);
        expect(result.committed).toBe(false);
        expect(result.reason).toBe('not a git repo');
      } finally {
        rmSync(noGitTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('flushes every pending project root for shutdown', () =>
    Effect.gen(function* () {
      const otherTmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-other-root-'));
      try {
        execSync('git init -q', { cwd: otherTmp });
        execSync('git config user.email t@e.t', { cwd: otherTmp });
        execSync('git config user.name "Test"', { cwd: otherTmp });
        execSync('git config commit.gpgsign false', { cwd: otherTmp });
        writeFileSync(join(otherTmp, 'README.md'), 'seed');
        execSync('git add README.md', { cwd: otherTmp });
        execSync('git commit -q -m "init"', { cwd: otherTmp });
        execSync('git branch -M main', { cwd: otherTmp });
        execSync('git remote add origin .', { cwd: otherTmp });

        mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
        mkdirSync(join(otherTmp, '.pan', 'continues'), { recursive: true });
        const firstPath = join(tmp, '.pan', 'continues', 'pan-2375-first.vbrief.json');
        const secondPath = join(otherTmp, '.pan', 'continues', 'pan-2375-second.vbrief.json');
        writeFileSync(firstPath, '{"issue":"PAN-2375-FIRST"}');
        writeFileSync(secondPath, '{"issue":"PAN-2375-SECOND"}');

        queueAutoCommit({ projectRoot: tmp, paths: [firstPath], subject: 'chore(state): first root' });
        queueAutoCommit({ projectRoot: otherTmp, paths: [secondPath], subject: 'chore(state): second root' });

        const results = yield* flushAllPendingAutoCommits();
        expect(results).toEqual([
          { committed: true, pushed: true },
          { committed: true, pushed: true },
        ]);

        const firstLog = execSync('git log --oneline -1', { cwd: tmp, encoding: 'utf-8' });
        const secondLog = execSync('git log --oneline -1', { cwd: otherTmp, encoding: 'utf-8' });
        expect(firstLog).toContain('chore(state): first root');
        expect(secondLog).toContain('chore(state): second root');
      } finally {
        rmSync(otherTmp, { recursive: true, force: true });
      }
    }),
  );

  it.effect('reconciles only pending spec and record drift from the primary worktree', () =>
    Effect.gen(function* () {
      const spec = join(tmp, '.pan', 'specs', 'PAN-2516.vbrief.json');
      const record = join(tmp, '.pan', 'records', 'pan-2516.json');
      const source = join(tmp, 'src', 'operator-change.ts');
      mkdirSync(dirname(spec), { recursive: true });
      mkdirSync(dirname(record), { recursive: true });
      mkdirSync(dirname(source), { recursive: true });
      writeFileSync(spec, '{"status":"completed"}\n');
      writeFileSync(record, '{"issueId":"PAN-2516"}\n');
      writeFileSync(source, 'leave me alone\n');

      const result = yield* reconcileStatePlaneDrift(tmp);
      expect(result.committed).toBe(true);
      const committed = execSync('git show --name-only --format= HEAD', { cwd: tmp, encoding: 'utf-8' });
      expect(committed).toContain('.pan/specs/PAN-2516.vbrief.json');
      expect(committed).toContain('.pan/records/pan-2516.json');
      expect(committed).not.toContain('src/operator-change.ts');
      expect(execSync('git status --short -- .pan/specs .pan/records', { cwd: tmp, encoding: 'utf-8' })).toBe('');
      expect(execSync('git status --short -- src/operator-change.ts', { cwd: tmp, encoding: 'utf-8' })).toContain('??');
    }),
  );
});


describe('deriveProjectRoot', () => {
  it('extracts project root from a .pan/specs/ path', () => {
    expect(deriveProjectRoot('/work/myproj/.pan/specs/foo.vbrief.json')).toBe('/work/myproj');
  });

  it('extracts project root from a .pan/continues/ path', () => {
    expect(deriveProjectRoot('/work/myproj/.pan/continues/pan-1.vbrief.json')).toBe('/work/myproj');
  });


  it('returns null for unrelated paths', () => {
    expect(deriveProjectRoot('/work/myproj/src/lib/foo.ts')).toBeNull();
  });
});
