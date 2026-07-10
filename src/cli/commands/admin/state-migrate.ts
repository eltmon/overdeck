import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { Effect } from 'effect';

import { ensureWorkspaceBeadsRedirect } from '../workspace-beads.js';
import { flushAutoCommits } from '../../../lib/pan-dir/auto-commit.js';
import { getProjectSync, type ProjectConfig } from '../../../lib/projects.js';
import { STATE_BRANCH, MIGRATION_COMPLETE_MARKER, clearStateMigrationCache, stateWorktreePath } from '../../../lib/state-home.js';
import { STATE_BRANCH_PATHS } from '../../../lib/state-plane.js';
import { acquireStateMigrationLock } from '../../../lib/state-migration-lock.js';
import { manifestEntry, verifyStateMigrationManifest, type StateMigrationManifestEntry } from '../../../lib/state-migration-manifest.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

function destinationForTracked(path: string): string | null {
  if (path.startsWith('.beads/')) return path;
  if (!path.startsWith('.pan/')) return null;
  const flat = path.slice('.pan/'.length);
  return STATE_BRANCH_PATHS.some((prefix) => prefix !== '.beads/' && flat.startsWith(prefix)) ? flat : null;
}

async function trackedManifest(repo: string, sourceSha: string, stateRoot: string): Promise<StateMigrationManifestEntry[]> {
  const paths = (await git(repo, ['ls-tree', '-r', '--name-only', sourceSha, '--', '.pan', '.beads']))
    .split('\n').filter(Boolean);
  return paths.flatMap((path) => {
    const destination = destinationForTracked(path);
    return destination ? [manifestEntry(join(repo, path), join(stateRoot, destination))] : [];
  });
}

async function createOrphanStateCommit(repo: string, sourceSha: string): Promise<string> {
  const index = join(tmpdir(), `overdeck-state-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    await git(repo, ['read-tree', '--empty'], env);
    const rows = (await git(repo, ['ls-tree', '-r', sourceSha, '--', '.pan', '.beads'])).split('\n').filter(Boolean);
    for (const row of rows) {
      const match = row.match(/^(\d+)\s+\w+\s+([0-9a-f]+)\t(.+)$/);
      if (!match) continue;
      const destination = destinationForTracked(match[3]);
      if (destination) await git(repo, ['update-index', '--add', '--cacheinfo', `${match[1]},${match[2]},${destination}`], env);
    }
    const tree = await git(repo, ['write-tree'], env);
    return await git(repo, ['commit-tree', tree, '-m', 'chore(state): seed overdeck-state']);
  } finally {
    rmSync(index, { force: true });
  }
}

function workspacePaths(repo: string): string[] {
  const root = join(repo, 'workspaces');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    // Only real git worktrees are workspaces. workspaces/ can contain stray
    // non-worktree directories (e.g. a root-owned node_modules left by a
    // container) that must not be touched — writing into them EACCES-aborts
    // the migration mid-flight.
    .filter((path) => existsSync(join(path, '.git')));
}

function rewriteGitignore(repo: string): void {
  const path = join(repo, '.gitignore');
  const prior = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const kept = prior.split('\n').filter((line) => line.trim() !== '.overdeck/' && line.trim() !== '.pan/' && line.trim() !== '.beads/');
  kept.push(
    '# PAN-2541: permanent state is on overdeck-state; workspace runtime stays local.',
    '.pan/',
    '.beads/',
    '.overdeck/continue.json',
    '.overdeck/spec.vbrief.json',
    '.overdeck/sessions.jsonl',
    '.overdeck/feedback/',
    '.overdeck/review/',
    '.overdeck/test/',
    '.overdeck/kickoff.md',
    '.overdeck/agent-mcp.json',
    '',
  );
  writeFileSync(path, kept.join('\n'));
}

export async function migrateProjectState(
  projectKey: string,
  options: { dryRun?: boolean } = {},
  projectOverride?: ProjectConfig,
): Promise<void> {
  const project = projectOverride ?? getProjectSync(projectKey);
  if (!project) throw new Error(`Unknown project: ${projectKey}`);
  const repo = project.path;
  const stateRoot = stateWorktreePath(project, { projectKey });
  console.log(`PAN-2541 state migration plan for ${projectKey}:`);
  console.log(`  ${repo}/.pan/{${STATE_BRANCH_PATHS.filter((p) => p !== '.beads/').map((p) => p.slice(0, -1)).join(',')}} -> ${stateRoot}/`);
  console.log(`  ${repo}/.beads -> ${stateRoot}/.beads`);
  console.log(`  ${repo}/.pan/context -> ${repo}/.overdeck/context`);
  if (options.dryRun) return;

  const release = acquireStateMigrationLock(projectKey);
  try {
    await Effect.runPromise(flushAutoCommits(repo));
    if (await git(repo, ['status', '--porcelain'])) throw new Error('Primary checkout is dirty; migration refused before mutation');
    await git(repo, ['fetch', '--prune', 'origin']);
    const sourceMainSha = await git(repo, ['rev-parse', 'main']);
    const remoteMainSha = await git(repo, ['rev-parse', 'origin/main']);
    if (sourceMainSha !== remoteMainSha) throw new Error('main is not exactly at origin/main; migration refused');

    const existingMarker = await git(repo, ['show', `origin/${STATE_BRANCH}:${MIGRATION_COMPLETE_MARKER}`]).catch(() => '');
    if (existingMarker) {
      console.log('State migration already complete on origin; nothing to do.');
      return;
    }

    let stateSha = await git(repo, ['rev-parse', STATE_BRANCH]).catch(() => '');
    const remoteStateSha = await git(repo, ['rev-parse', `origin/${STATE_BRANCH}`]).catch(() => '');
    if (stateSha && remoteStateSha && stateSha !== remoteStateSha) {
      throw new Error('Local and remote overdeck-state diverged; refusing non-fast-forward migration');
    }
    if (!stateSha) {
      stateSha = remoteStateSha || await createOrphanStateCommit(repo, sourceMainSha);
      await git(repo, ['update-ref', `refs/heads/${STATE_BRANCH}`, stateSha]);
    }
    if (!remoteStateSha) await git(repo, ['push', 'origin', STATE_BRANCH]);

    if (!existsSync(stateRoot)) {
      mkdirSync(dirname(stateRoot), { recursive: true });
      await git(repo, ['worktree', 'add', stateRoot, STATE_BRANCH]);
    }

    const manifest = await trackedManifest(repo, sourceMainSha, stateRoot);
    const untracked = (await git(repo, ['ls-files', '--others', '--', '.pan'])).split('\n')
      .filter((path) => path.split('/').length === 2 && existsSync(join(repo, path)) && lstatSync(join(repo, path)).isFile());
    for (const path of untracked) {
      if (!existsSync(join(repo, path))) continue;
      const destination = join(stateRoot, 'notes', path.slice('.pan/'.length));
      if (existsSync(destination)) throw new Error(`Untracked-note destination collision: ${destination}`);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(repo, path), destination);
      manifest.push(manifestEntry(join(repo, path), destination));
    }
    if (untracked.length > 0) {
      await git(stateRoot, ['add', 'notes']);
      await git(stateRoot, ['commit', '-m', 'chore(state): preserve untracked operator notes']);
      await git(stateRoot, ['push', 'origin', STATE_BRANCH]);
    }

    for (const workspace of workspacePaths(repo)) await ensureWorkspaceBeadsRedirect(workspace, project);
    if (await git(repo, ['rev-parse', 'main']) !== sourceMainSha) throw new Error('main advanced during migration; refusing cleanup');

    await git(repo, ['rm', '-r', '--cached', '--ignore-unmatch', '.pan/records', '.pan/continues', '.pan/specs', '.pan/drafts', '.pan/review', '.pan/test', '.pan/feedback', '.pan/backlog', '.pan/notes', '.beads']);
    const oldContext = join(repo, '.pan', 'context');
    const newContext = join(repo, '.overdeck', 'context');
    if (existsSync(oldContext) && !existsSync(newContext)) {
      mkdirSync(dirname(newContext), { recursive: true });
      renameSync(oldContext, newContext);
    }
    rewriteGitignore(repo);
    await git(repo, ['add', '-u', '--', '.pan/context']);
    await git(repo, ['add', '--', '.gitignore', '.overdeck/context']);
    await git(repo, ['commit', '-m', 'chore(state): move permanent state to overdeck-state']);

    verifyStateMigrationManifest(manifest);
    for (const entry of manifest) rmSync(entry.source, { force: true });
    stateSha = await git(stateRoot, ['rev-parse', 'HEAD']);
    writeFileSync(join(stateRoot, MIGRATION_COMPLETE_MARKER), `${JSON.stringify({
      sourceMainSha,
      stateBranchSha: stateSha,
      completedAt: new Date().toISOString(),
      version: 1,
    }, null, 2)}\n`);
    await git(stateRoot, ['add', MIGRATION_COMPLETE_MARKER]);
    await git(stateRoot, ['commit', '-m', 'chore(state): complete state migration']);

    await git(repo, ['push', '--atomic', '--dry-run', 'origin', 'main', STATE_BRANCH]);
    await git(repo, ['push', '--atomic', 'origin', 'main', STATE_BRANCH]);
    clearStateMigrationCache();
  } finally {
    release();
  }
}

export function registerStateMigrationCommand(admin: Command): void {
  admin.command('state')
    .description('Permanent state administration')
    .command('migrate <project>')
    .description('Move permanent state to the orphan overdeck-state branch')
    .option('--dry-run', 'Print the exact migration plan without mutating anything')
    .action((project: string, options: { dryRun?: boolean }) => migrateProjectState(project, options));
}
