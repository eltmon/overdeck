import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateProjectState } from '../../src/cli/commands/admin/state-migrate.js';
import { manifestEntry, verifyStateMigrationManifest } from '../../src/lib/state-migration-manifest.js';
import { acquireStateMigrationLock } from '../../src/lib/state-migration-lock.js';
import { sha256File } from '../../src/lib/beads/cutover-marker.js';

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

  it('migrates untracked pipeline state and generated beads metadata without treating them as dirty code', async () => {
    mkdirSync(join(repo, '.pan', 'specs'), { recursive: true });
    mkdirSync(join(repo, '.beads'), { recursive: true });
    writeFileSync(join(repo, '.pan', 'specs', 'puz-1.vbrief.json'), '{"id":"PUZ-1"}\n');
    writeFileSync(join(repo, '.beads', 'config.yaml'), 'project_id: PUZ\n');
    writeFileSync(join(repo, '.beads', 'README'), 'generated tracker infrastructure\n');
    writeFileSync(join(repo, '.beads', '.gitignore'), 'embeddeddolt/\n');

    await migrateProjectState('fixture-untracked', {}, { name: 'Fixture', path: repo });

    const stateTree = git(repo, 'ls-tree', '-r', '--name-only', 'origin/overdeck-state');
    expect(stateTree).toContain('specs/puz-1.vbrief.json');
    expect(stateTree).toContain('.beads/config.yaml');
    expect(stateTree).toContain('.beads/README');
    expect(stateTree).toContain('.beads/.gitignore');
    // Empty legacy directories may remain, but every source payload must be
    // gone so neither Git nor an agent can discover a state straggler.
    expect(existsSync(join(repo, '.pan', 'specs', 'puz-1.vbrief.json'))).toBe(false);
    expect(existsSync(join(repo, '.beads', 'config.yaml'))).toBe(false);
    expect(existsSync(join(repo, '.beads', 'README'))).toBe(false);
    expect(existsSync(join(repo, '.beads', '.gitignore'))).toBe(false);
  });

  it('moves accidentally committed pipeline infrastructure off main with forward-only commits', async () => {
    mkdirSync(join(repo, '.pan', 'specs'), { recursive: true });
    writeFileSync(join(repo, '.pan', 'specs', 'puz-1.vbrief.json'), '{"id":"PUZ-1"}\n');
    writeFileSync(join(repo, '.beads', 'config.yaml'), 'project_id: PUZ\n');
    writeFileSync(join(repo, '.beads', 'README'), 'generated tracker infrastructure\n');
    writeFileSync(join(repo, '.beads', '.gitignore'), 'embeddeddolt/\n');
    git(repo, 'add', '.pan', '.beads');
    git(repo, 'commit', '-q', '-m', 'commit pipeline artifacts');
    git(repo, 'push', '-q', 'origin', 'main');

    await migrateProjectState('fixture-committed', {}, { name: 'Fixture', path: repo });

    const mainTree = git(repo, 'ls-tree', '-r', '--name-only', 'origin/main');
    const stateTree = git(repo, 'ls-tree', '-r', '--name-only', 'origin/overdeck-state');
    expect(mainTree).not.toContain('.pan/specs/puz-1.vbrief.json');
    expect(mainTree).not.toContain('.beads/config.yaml');
    expect(stateTree).toContain('specs/puz-1.vbrief.json');
    expect(stateTree).toContain('.beads/config.yaml');
    expect(stateTree).toContain('.beads/README');
    expect(stateTree).toContain('.beads/.gitignore');
  });

  it('hosts polyrepo state on the designated sub-repo without advancing its main branch', async () => {
    const projectRoot = join(root, 'polyrepo');
    const infra = join(projectRoot, 'infra');
    const infraRemote = join(root, 'infra-origin.git');
    mkdirSync(join(projectRoot, '.pan', 'records'), { recursive: true });
    mkdirSync(join(projectRoot, '.beads'), { recursive: true });
    mkdirSync(infra);
    writeFileSync(join(projectRoot, '.pan', 'records', 'pan-2.json'), '{"issueId":"PAN-2"}\n');
    writeFileSync(join(projectRoot, '.beads', 'issues.jsonl'), '{"id":"pan-2"}\n');
    git(infra, 'init', '-q');
    git(infra, 'config', 'user.name', 'Migration Test');
    git(infra, 'config', 'user.email', 'migration@example.com');
    git(infra, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(infra, 'README.md'), 'infra main\n');
    git(infra, 'add', 'README.md');
    git(infra, 'commit', '-q', '-m', 'infra fixture');
    git(infra, 'branch', '-M', 'main');
    git(root, 'init', '--bare', '-q', infraRemote);
    git(infra, 'remote', 'add', 'origin', infraRemote);
    git(infra, 'push', '-q', '-u', 'origin', 'main');
    const mainBefore = git(infra, 'rev-parse', 'main');

    await migrateProjectState('polyrepo-fixture', {}, {
      name: 'Polyrepo fixture',
      path: projectRoot,
      workspace: { type: 'polyrepo', repos: [{ name: 'infra', path: 'infra' }] },
      pan_records: { repo: 'infra' },
    });

    const stateTree = git(infra, 'ls-tree', '-r', '--name-only', 'origin/overdeck-state');
    expect(stateTree).toContain('records/pan-2.json');
    expect(stateTree).toContain('.beads/issues.jsonl');
    expect(stateTree).toContain('migration-complete.json');
    expect(git(infra, 'rev-parse', 'main')).toBe(mainBefore);
    expect(git(infra, 'rev-parse', 'origin/main')).toBe(mainBefore);
    expect(git(infra, 'ls-tree', '-r', '--name-only', 'main')).toBe('README.md');
    expect(() => git(projectRoot, 'status', '--porcelain')).toThrow();
    expect(existsSync(join(projectRoot, '.pan'))).toBe(false);
    expect(existsSync(join(projectRoot, '.beads'))).toBe(false);
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

  it('refuses a live Dolt layout without a reviewed cutover marker before changing git state', async () => {
    mkdirSync(join(repo, '.beads', 'embeddeddolt'), { recursive: true });
    writeFileSync(join(repo, '.beads', 'embeddeddolt', 'LOCK'), 'live');
    writeFileSync(join(repo, '.beads', 'dolt-server.pid'), '123');
    const before = git(repo, 'rev-parse', 'HEAD');

    await expect(migrateProjectState('fixture', {}, { name: 'Fixture', path: repo }))
      .rejects.toThrow(/pan admin beads reconcile fixture/);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(() => git(repo, 'rev-parse', 'overdeck-state')).toThrow();
    expect(existsSync(join(repo, '.beads', 'embeddeddolt', 'LOCK'))).toBe(true);
  });

  it('accepts a valid cutover marker and stages no Dolt runtime bytes', async () => {
    mkdirSync(join(repo, '.beads', 'embeddeddolt'), { recursive: true });
    writeFileSync(join(repo, '.beads', 'embeddeddolt', 'LOCK'), 'live');
    writeFileSync(join(repo, '.beads', 'dolt-server.pid'), '123');
    const dataHead = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'push', '-q', 'origin', `${dataHead}:refs/dolt/data`);

    const stateRoot = join(process.env.OVERDECK_HOME!, 'state', 'fixture');
    git(repo, 'switch', '--orphan', 'overdeck-state');
    mkdirSync(join(repo, 'notes'), { recursive: true });
    mkdirSync(join(repo, '.beads'), { recursive: true });
    writeFileSync(join(repo, 'notes', 'beads-reconcile.md'), '# reviewed\n');
    writeFileSync(join(repo, '.beads', 'issues.jsonl'), '{"id":"pan-1"}\n');
    writeFileSync(join(repo, 'beads-cutover.json'), `${JSON.stringify({
      remoteUrl: remote,
      remoteDoltHead: dataHead,
      localReconciledHead: dataHead,
      reconcileReport: {
        path: 'notes/beads-reconcile.md',
        sha256: sha256File(join(repo, 'notes', 'beads-reconcile.md')),
      },
      completedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    git(repo, 'add', 'notes/beads-reconcile.md', '.beads/issues.jsonl', 'beads-cutover.json');
    git(repo, 'commit', '-q', '-m', 'reviewed cutover');
    git(repo, 'push', '-q', '-u', 'origin', 'overdeck-state');
    git(repo, 'switch', 'main');
    mkdirSync(join(repo, '.beads', 'embeddeddolt'), { recursive: true });
    writeFileSync(join(repo, '.beads', 'embeddeddolt', 'LOCK'), 'live');
    writeFileSync(join(repo, '.beads', 'dolt-server.pid'), '123');
    mkdirSync(join(stateRoot, '..'), { recursive: true });
    git(repo, 'worktree', 'add', '-q', stateRoot, 'overdeck-state');

    await migrateProjectState('fixture', {}, { name: 'Fixture', path: repo });
    const stateTree = git(repo, 'ls-tree', '-r', '--name-only', 'origin/overdeck-state');
    expect(stateTree).toContain('.beads/issues.jsonl');
    expect(stateTree).not.toMatch(/embeddeddolt|dolt-server|\.dolt/);
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
