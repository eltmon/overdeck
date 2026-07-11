import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateProjectState } from '../../src/cli/commands/admin/state-migrate.js';
import { manifestEntry, verifyStateMigrationManifest } from '../../src/lib/state-migration-manifest.js';
import { acquireStateMigrationLock } from '../../src/lib/state-migration-lock.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('state branch migration no-loss gate', () => {
  let root: string;
  let repo: string;
  let remote: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'state-migrate-'));
    repo = join(root, 'repo');
    remote = join(root, 'origin.git');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'Migration Test');
    git(repo, 'config', 'user.email', 'migration@example.com');
    git(repo, 'config', 'commit.gpgsign', 'false');
    mkdirSync(join(repo, '.pan', 'records'), { recursive: true });
    mkdirSync(join(repo, '.pan', 'specs'), { recursive: true });
    mkdirSync(join(repo, '.pan', 'context'), { recursive: true });
    mkdirSync(join(repo, '.beads'), { recursive: true });
    writeFileSync(join(repo, '.pan', 'records', 'pan-1.json'), '{"issueId":"PAN-1"}\n');
    writeFileSync(join(repo, '.pan', 'specs', 'pan-1.json'), '{"plan":{"id":"PAN-1"}}\n');
    writeFileSync(join(repo, '.pan', 'context', 'project.md'), '# project\n');
    writeFileSync(join(repo, '.beads', 'issues.jsonl'), '{"id":"pan-1"}\n');
    writeFileSync(join(repo, '.gitignore'), '.overdeck/\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'fixture');
    git(repo, 'branch', '-M', 'main');
    git(root, 'init', '--bare', '-q', remote);
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', '-u', 'origin', 'main');
    process.env.OVERDECK_HOME = join(root, 'home');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('dry-runs without refs, then atomically publishes no-loss main/state trees', async () => {
    const before = git(repo, 'rev-parse', 'HEAD');
    await migrateProjectState('fixture', { dryRun: true }, { name: 'Fixture', path: repo });
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(() => git(repo, 'rev-parse', 'overdeck-state')).toThrow();

    await migrateProjectState('fixture', {}, { name: 'Fixture', path: repo });
    expect(git(repo, 'ls-tree', '-r', '--name-only', 'origin/overdeck-state')).toEqual(expect.stringContaining('records/pan-1.json'));
    expect(git(repo, 'ls-tree', '-r', '--name-only', 'origin/overdeck-state')).toEqual(expect.stringContaining('.beads/issues.jsonl'));
    expect(git(repo, 'ls-tree', '-r', '--name-only', 'origin/main')).not.toContain('.pan/records');
    const marker = JSON.parse(git(repo, 'show', 'origin/overdeck-state:migration-complete.json'));
    expect(marker.sourceMainSha).toBe(before);
    expect(marker.version).toBe(1);
    await expect(migrateProjectState('fixture', {}, { name: 'Fixture', path: repo })).resolves.toBeUndefined();
  });

  it('refuses dirty primary state and lock contention before creating refs', async () => {
    writeFileSync(join(repo, 'dirty.txt'), 'dirty\n');
    await expect(migrateProjectState('fixture', {}, { name: 'Fixture', path: repo })).rejects.toThrow(/dirty/);
    expect(() => git(repo, 'rev-parse', 'overdeck-state')).toThrow();
    rmSync(join(repo, 'dirty.txt'));

    const release = acquireStateMigrationLock('fixture');
    try {
      await expect(migrateProjectState('fixture', {}, { name: 'Fixture', path: repo })).rejects.toThrow(/already running/);
    } finally {
      release();
    }
    expect(() => git(repo, 'rev-parse', 'overdeck-state')).toThrow();
  });

  it('verifies mode, size, and hash before source removal', () => {
    const source = join(root, 'source');
    const destination = join(root, 'destination');
    writeFileSync(source, 'same\n', { mode: 0o640 });
    writeFileSync(destination, 'same\n', { mode: 0o640 });
    expect(() => verifyStateMigrationManifest([manifestEntry(source, destination)])).not.toThrow();
    writeFileSync(destination, 'different\n', { mode: 0o640 });
    expect(() => verifyStateMigrationManifest([manifestEntry(source, destination)])).toThrow(/no-loss mismatch/);
    expect(readFileSync(source, 'utf8')).toBe('same\n');
  });
});
