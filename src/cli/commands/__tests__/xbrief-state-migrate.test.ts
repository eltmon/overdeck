import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { Command } from 'commander';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerStateMigrationCommand } from '../admin/state-migrate.js';
import { migrateProjectXBriefState } from '../admin/xbrief-state-migrate.js';
import { findSpecByIssue } from '../../../lib/pan-dir/specs.js';
import { resolveContinuePath } from '../../../lib/pan-dir/records.js';
import type { ProjectConfig } from '../../../lib/projects.js';

const CREATED = '2026-07-17T00:00:00.000Z';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) snapshot[relative(root, path)] = readFileSync(path, 'utf8');
    }
  };
  visit(root);
  return snapshot;
}

describe('xBRIEF state migration', () => {
  let home: string;
  let projectRoot: string;
  let stateRoot: string;
  let project: ProjectConfig;
  let originalHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'overdeck-xbrief-home-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'overdeck-xbrief-project-'));
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
    stateRoot = join(home, 'state', basename(projectRoot));
    mkdirSync(join(stateRoot, 'specs'), { recursive: true });
    mkdirSync(join(stateRoot, 'continues'), { recursive: true });

    project = { name: 'Fixture', path: projectRoot };
    git(stateRoot, 'init', '-q', '-b', 'overdeck-state');
    git(stateRoot, 'config', 'user.email', 'test@example.com');
    git(stateRoot, 'config', 'user.name', 'Test');
    git(stateRoot, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(stateRoot, 'migration-complete.json'), `${JSON.stringify({
      sourceMainSha: '1'.repeat(40),
      stateBranchSha: '2'.repeat(40),
      completedAt: CREATED,
      version: 1,
    }, null, 2)}\n`);
    writeFileSync(join(stateRoot, 'specs', '2026-07-17-PAN-1-legacy.vbrief.json'), `${JSON.stringify({
      vBRIEFInfo: {
        version: '0.8',
        created: CREATED,
        author: 'test',
        description: 'legacy envelope',
      },
      plan: {
        id: 'pan-1',
        title: 'Legacy plan',
        status: 'proposed',
        uid: '11111111-1111-4111-8111-111111111111',
        author: 'test',
        sequence: 1,
        created: CREATED,
        updated: CREATED,
        items: [],
      },
    }, null, 2)}\n`);
    writeFileSync(join(stateRoot, 'continues', 'pan-1.vbrief.json'), `${JSON.stringify({
      issueId: 'PAN-1',
      decisions: [{ id: 'D1', summary: 'keep me', recordedAt: CREATED }],
    }, null, 2)}\n`);
    git(stateRoot, 'add', '--all');
    git(stateRoot, 'commit', '-q', '-m', 'seed legacy xbrief state');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
  });

  it('renames and rewrites once, then remains idempotent and readable', async () => {
    const beforeCommits = Number(git(stateRoot, 'rev-list', '--count', 'HEAD'));

    const first = await migrateProjectXBriefState(basename(projectRoot), {}, project);

    expect(first).toEqual({ dryRun: false, filesMigrated: 2, committed: true });
    expect(Number(git(stateRoot, 'rev-list', '--count', 'HEAD'))).toBe(beforeCommits + 1);
    const specPath = join(stateRoot, 'specs', '2026-07-17-PAN-1-legacy.xbrief.json');
    const continuePath = join(stateRoot, 'continues', 'pan-1.xbrief.json');
    expect(existsSync(specPath)).toBe(true);
    expect(existsSync(continuePath)).toBe(true);
    expect(existsSync(join(stateRoot, 'specs', '2026-07-17-PAN-1-legacy.vbrief.json'))).toBe(false);
    expect(existsSync(join(stateRoot, 'continues', 'pan-1.vbrief.json'))).toBe(false);
    const migrated = JSON.parse(readFileSync(specPath, 'utf8')) as Record<string, unknown>;
    expect(migrated).toHaveProperty('xBRIEFInfo');
    expect(migrated).not.toHaveProperty('vBRIEFInfo');
    expect((migrated.xBRIEFInfo as { version: string }).version).toBe('0.8');

    const found = await Effect.runPromise(findSpecByIssue(projectRoot, 'PAN-1'));
    expect(found?.path).toBe(specPath);
    expect(resolveContinuePath(projectRoot, 'PAN-1')).toBe(continuePath);

    const second = await migrateProjectXBriefState(basename(projectRoot), {}, project);
    expect(second).toEqual({ dryRun: false, filesMigrated: 0, committed: false });
    expect(Number(git(stateRoot, 'rev-list', '--count', 'HEAD'))).toBe(beforeCommits + 1);
  });

  it('prints a dry-run plan without changing fixture bytes', async () => {
    const before = snapshotTree(stateRoot);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await migrateProjectXBriefState(basename(projectRoot), { dryRun: true }, project);

    expect(result).toEqual({ dryRun: true, filesMigrated: 2, committed: false });
    expect(snapshotTree(stateRoot)).toEqual(before);
    expect(git(stateRoot, 'status', '--porcelain')).toBe('');
    expect(log.mock.calls.flat().join('\n')).toContain('vBRIEFInfo -> xBRIEFInfo');
    expect(log.mock.calls.flat().join('\n')).toContain('.vbrief.json ->');
  });

  it('keeps both state migration subcommands registered', () => {
    const program = new Command();
    registerStateMigrationCommand(program);

    const state = program.commands.find((command) => command.name() === 'state');
    expect(state?.commands.map((command) => command.name())).toEqual(['migrate', 'migrate-xbrief']);
  });
});
