import { execFile, type ChildProcess, type ExecFileException } from 'node:child_process';
import { copyFileSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { chmod, lstat, mkdir, readdir, rename, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Command } from 'commander';
import { Effect } from 'effect';

import { flushAutoCommits } from '../../../lib/pan-dir/auto-commit.js';
import { getProjectSync, resolveInfraRepo, type ProjectConfig } from '../../../lib/projects.js';
import { STATE_BRANCH, MIGRATION_COMPLETE_MARKER, clearStateMigrationCache, stateWorktreePath } from '../../../lib/state-home.js';
import { STATE_BRANCH_PATHS } from '../../../lib/state-plane.js';
import { acquireStateMigrationLock } from '../../../lib/state-migration-lock.js';
import { manifestEntry, verifyStateMigrationManifest, type StateMigrationManifestEntry } from '../../../lib/state-migration-manifest.js';

const GIT_COMMAND_TIMEOUT_MS = 30_000;

const execFileDetached = execFile as unknown as (
  file: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: BufferEncoding;
    maxBuffer: number;
    detached: boolean;
  },
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => ChildProcess;

function killProcessTree(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* process already exited */ }
  }
}

async function git(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  signal?.throwIfAborted();
  const command = `git ${args.join(' ')}`;
  return new Promise((resolve, reject) => {
    let child: ChildProcess | undefined;
    let termination: 'abort' | 'timeout' | undefined;
    const terminate = (kind: 'abort' | 'timeout') => {
      if (termination) return;
      termination = kind;
      killProcessTree(child);
    };
    const timeout = setTimeout(() => terminate('timeout'), GIT_COMMAND_TIMEOUT_MS);
    const onAbort = () => terminate('abort');
    signal?.addEventListener('abort', onAbort, { once: true });

    child = execFileDetached('git', args, {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      detached: process.platform !== 'win32',
    }, (error, stdout, stderr) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      if (termination === 'abort') {
        reject(signal?.reason ?? new DOMException(`${command} was cancelled`, 'AbortError'));
      } else if (termination === 'timeout') {
        reject(new Error(`${command} timed out after ${GIT_COMMAND_TIMEOUT_MS / 1_000}s`));
      } else if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve(stdout.trim());
      }
    });

    if (signal?.aborted) terminate('abort');
  });
}

function destinationForTracked(path: string): string | null {
  if (!path.startsWith('.pan/')) return null;
  const flat = path.slice('.pan/'.length);
  return STATE_BRANCH_PATHS.some((prefix) => flat.startsWith(prefix)) ? flat : null;
}

async function trackedManifest(
  repo: string,
  sourceSha: string,
  stateRoot: string,
  signal?: AbortSignal,
): Promise<StateMigrationManifestEntry[]> {
  const paths = (await git(repo, ['ls-tree', '-r', '--name-only', sourceSha, '--', '.pan'], signal))
    .split('\n').filter(Boolean);
  const manifest: StateMigrationManifestEntry[] = [];
  for (const path of paths) {
    signal?.throwIfAborted();
    const destination = destinationForTracked(path);
    if (!destination) continue;
    const source = join(repo, path);
    const target = join(stateRoot, destination);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    manifest.push(await manifestEntry(source, target, signal));
  }
  return manifest;
}

async function createOrphanStateCommit(
  repo: string,
  sourceSha: string,
  signal?: AbortSignal,
): Promise<string> {
  const index = join(tmpdir(), `overdeck-state-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    await git(repo, ['read-tree', '--empty'], signal, env);
    const rows = (await git(repo, ['ls-tree', '-r', sourceSha, '--', '.pan'], signal)).split('\n').filter(Boolean);
    for (const row of rows) {
      const match = row.match(/^(\d+)\s+\w+\s+([0-9a-f]+)\t(.+)$/);
      if (!match) continue;
      const destination = destinationForTracked(match[3]);
      if (destination) {
        await git(repo, ['update-index', '--add', '--cacheinfo', `${match[1]},${match[2]},${destination}`], signal, env);
      }
    }
    const tree = await git(repo, ['write-tree'], signal, env);
    return await git(repo, ['commit-tree', tree, '-m', 'chore(state): seed overdeck-state'], signal, env);
  } finally {
    rmSync(index, { force: true });
  }
}

type CopyFileOperation = (
  source: string,
  destination: string,
  signal?: AbortSignal,
) => Promise<void>;

let copySequence = 0;

async function copyFileAbortable(
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const stat = await lstat(source);
  const temporary = join(
    dirname(destination),
    `.overdeck-migrate-${process.pid}-${copySequence++}`,
  );
  await mkdir(dirname(destination), { recursive: true });
  try {
    await pipeline(
      createReadStream(source, { signal }),
      createWriteStream(temporary, { mode: stat.mode & 0o777 }),
      { signal },
    );
    signal?.throwIfAborted();
    await chmod(temporary, stat.mode & 0o777);
    await utimes(temporary, stat.atime, stat.mtime);
    signal?.throwIfAborted();
    await rename(temporary, destination);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

async function assertNoLegacySymlinks(
  source: string,
  signal?: AbortSignal,
  allowMissing = false,
): Promise<void> {
  signal?.throwIfAborted();
  let stat;
  try {
    stat = await lstat(source);
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(
      `Legacy state contains unsupported symbolic link: ${source}. `
      + 'Resolve it before migrating so canonical state cannot depend on the legacy tree.',
    );
  }
  if (!stat.isDirectory()) return;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await assertNoLegacySymlinks(join(source, entry.name), signal);
  }
}

async function copyLegacyState(
  sourceRoot: string,
  stateRoot: string,
  signal?: AbortSignal,
  copyFile: CopyFileOperation = copyFileAbortable,
): Promise<StateMigrationManifestEntry[]> {
  const manifest: StateMigrationManifestEntry[] = [];
  const sources = STATE_BRANCH_PATHS
    .map((sourcePath) => ({
      source: join(sourceRoot, '.pan', sourcePath),
      destination: join(stateRoot, sourcePath),
    }))
    .filter(({ source }) => existsSync(source));

  // Symlinks cannot be made durable by the regular-file manifest: absolute
  // targets can still point into the legacy tree after cleanup, and relative
  // targets can resolve differently under the state worktree. Check the whole
  // legacy tree so ignored top-level entries cannot be deleted without notice.
  await assertNoLegacySymlinks(join(sourceRoot, '.pan'), signal, true);

  const visit = async (sourceDir: string, destinationDir: string): Promise<void> => {
    await mkdir(destinationDir, { recursive: true });
    for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const sourceEntry = join(sourceDir, entry.name);
      const destinationEntry = join(destinationDir, entry.name);
      if (entry.isDirectory()) {
        await visit(sourceEntry, destinationEntry);
      } else if (entry.isFile()) {
        await copyFile(sourceEntry, destinationEntry, signal);
        signal?.throwIfAborted();
        manifest.push(await manifestEntry(sourceEntry, destinationEntry, signal));
      } else if (entry.isSymbolicLink()) {
        throw new Error(`Legacy state changed during migration: symbolic link appeared at ${sourceEntry}`);
      }
    }
  };

  for (const { source, destination } of sources) {
    signal?.throwIfAborted();
    await visit(source, destination);
  }
  return manifest;
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

function hasNonStateDirtyState(porcelain: string): boolean {
  return porcelain.split('\n').filter(Boolean).some((line) => {
    const path = line.slice(3).split(' -> ').at(-1) ?? '';
    if (path === '.pan' || path.startsWith('.pan/')) {
      return false;
    }
    return true;
  });
}

function dedupeManifest(entries: StateMigrationManifestEntry[]): StateMigrationManifestEntry[] {
  return [...new Map(entries.map((entry) => [entry.destination, entry])).values()];
}

const GITIGNORE_MANAGED_LINES = [
  '# PAN-2541: permanent state is on overdeck-state; workspace runtime stays local.',
  '.pan/',
  '.overdeck/continue.json',
  '.overdeck/spec.vbrief.json',
  '.overdeck/sessions.jsonl',
  '.overdeck/feedback/',
  '.overdeck/review/',
  '.overdeck/test/',
  '.overdeck/kickoff.md',
  '.overdeck/agent-mcp.json',
];

function rewriteGitignore(repo: string): void {
  const path = join(repo, '.gitignore');
  const prior = existsSync(path) ? readFileSync(path, 'utf8') : '';
  // Idempotent: strip every line this function manages (plus the legacy bare
  // '.overdeck/' entry) before appending the block exactly once — an
  // interrupted migration must not accrete duplicate blocks on resume.
  const managed = new Set([...GITIGNORE_MANAGED_LINES, '.overdeck/']);
  const kept = prior.split('\n').filter((line) => !managed.has(line.trim()));
  while (kept.length > 0 && kept[kept.length - 1]?.trim() === '') kept.pop();
  writeFileSync(path, [...kept, '', ...GITIGNORE_MANAGED_LINES, ''].join('\n'));
}

export async function migrateProjectState(
  projectKey: string,
  options: { dryRun?: boolean; signal?: AbortSignal } = {},
  projectOverride?: ProjectConfig,
): Promise<void> {
  const project = projectOverride ?? getProjectSync(projectKey);
  if (!project) throw new Error(`Unknown project: ${projectKey}`);
  const { repoPath: repo } = resolveInfraRepo(project);
  const legacyStateSource = project.path;
  const sourceIsHostRepo = legacyStateSource === repo;
  const stateRoot = stateWorktreePath(project, { projectKey });
  console.log(`PAN-2541 state migration plan for ${projectKey}:`);
  console.log(`  ${legacyStateSource}/.pan/{${STATE_BRANCH_PATHS.map((p) => p.slice(0, -1)).join(',')}} -> ${stateRoot}/`);
  console.log(`  ${legacyStateSource}/.pan/context -> ${legacyStateSource}/.overdeck/context`);
  if (options.dryRun) return;

  options.signal?.throwIfAborted();
  const release = acquireStateMigrationLock(projectKey);
  try {
    // A queued state commit is already inside the canonical durability boundary.
    // Await it without interrupting the Effect, then honor cancellation before
    // starting migration work so the timeout cannot detach a live commit/push.
    const flush = await Effect.runPromise(flushAutoCommits(repo));
    if (flush.errored) {
      throw new Error(`State writer did not quiesce before migration: ${flush.reason ?? 'unknown error'}`);
    }
    options.signal?.throwIfAborted();
    // This read-only preflight runs before fetches, branch creation, worktree
    // creation, or destination writes. copyLegacyState repeats it immediately
    // before copying to defend against changes outside the migration lock.
    await assertNoLegacySymlinks(join(legacyStateSource, '.pan'), options.signal, true);
    if (hasNonStateDirtyState(await git(repo, ['status', '--porcelain'], options.signal))) {
      throw new Error('Primary checkout is dirty outside legacy state paths; migration refused before mutation');
    }
    await git(repo, ['fetch', '--prune', 'origin'], options.signal);
    const sourceMainSha = await git(repo, ['rev-parse', 'main'], options.signal);
    const remoteMainSha = await git(repo, ['rev-parse', 'origin/main'], options.signal);
    if (sourceMainSha !== remoteMainSha) throw new Error('main is not exactly at origin/main; migration refused');

    const existingMarker = await git(repo, ['show', `origin/${STATE_BRANCH}:${MIGRATION_COMPLETE_MARKER}`], options.signal)
      .catch(() => {
        options.signal?.throwIfAborted();
        return '';
      });
    if (existingMarker) {
      console.log('State migration already complete on origin; nothing to do.');
      return;
    }

    let stateSha = await git(repo, ['rev-parse', STATE_BRANCH], options.signal).catch(() => {
      options.signal?.throwIfAborted();
      return '';
    });
    const remoteStateSha = await git(repo, ['rev-parse', `origin/${STATE_BRANCH}`], options.signal).catch(() => {
      options.signal?.throwIfAborted();
      return '';
    });
    if (stateSha && remoteStateSha && stateSha !== remoteStateSha) {
      throw new Error('Local and remote overdeck-state diverged; refusing non-fast-forward migration');
    }
    if (!stateSha) {
      stateSha = remoteStateSha || await createOrphanStateCommit(repo, sourceMainSha, options.signal);
      await git(repo, ['update-ref', `refs/heads/${STATE_BRANCH}`, stateSha], options.signal);
    }
    if (!remoteStateSha) await git(repo, ['push', 'origin', STATE_BRANCH], options.signal);

    if (!existsSync(stateRoot)) {
      options.signal?.throwIfAborted();
      mkdirSync(dirname(stateRoot), { recursive: true });
      await git(repo, ['worktree', 'add', stateRoot, STATE_BRANCH], options.signal);
    }

    // A pipeline may have produced state after the last code commit (the PUZ-1
    // failure mode). Seed tracked blobs for historical fidelity, then overlay
    // the current working-tree state so untracked .pan/specs enter the verified
    // manifest before legacy paths are removed. Unrelated dirty code remains a
    // hard block above. Legacy .beads data is intentionally left untouched.
    const manifest = sourceIsHostRepo
      ? dedupeManifest([
          ...await trackedManifest(repo, sourceMainSha, stateRoot, options.signal),
          ...await copyLegacyState(legacyStateSource, stateRoot, options.signal),
        ])
      : await copyLegacyState(legacyStateSource, stateRoot, options.signal);
    if (manifest.length > 0) {
      await git(stateRoot, ['add', '--all'], options.signal);
      if (await git(stateRoot, ['diff', '--cached', '--name-only'], options.signal)) {
        await git(stateRoot, ['commit', '-m', 'chore(state): seed legacy project state'], options.signal);
      }
      await git(stateRoot, ['push', 'origin', STATE_BRANCH], options.signal);
    }
    const untracked = sourceIsHostRepo
      ? (await git(repo, ['ls-files', '--others', '--', '.pan'], options.signal)).split('\n')
        .filter((path) => path.split('/').length === 2 && existsSync(join(repo, path)) && lstatSync(join(repo, path)).isFile())
      : existsSync(join(legacyStateSource, '.pan'))
        ? readdirSync(join(legacyStateSource, '.pan'), { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => `.pan/${entry.name}`)
        : [];
    for (const path of untracked) {
      options.signal?.throwIfAborted();
      if (!existsSync(join(legacyStateSource, path))) continue;
      const destination = join(stateRoot, 'notes', path.slice('.pan/'.length));
      if (existsSync(destination)) {
        // A byte-identical destination is this migration's own interrupted
        // prior copy — resume over it. Only differing content is a genuine
        // collision worth refusing.
        const identical = readFileSync(join(legacyStateSource, path)).equals(readFileSync(destination));
        if (!identical) throw new Error(`Untracked-note destination collision: ${destination}`);
        manifest.push(await manifestEntry(join(legacyStateSource, path), destination));
        continue;
      }
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(legacyStateSource, path), destination);
      manifest.push(await manifestEntry(join(legacyStateSource, path), destination));
    }
    if (untracked.length > 0) {
      await git(stateRoot, ['add', 'notes'], options.signal);
      // Resume tolerance: a prior interrupted attempt may have already
      // committed these notes — git commit exits 1 on an empty index.
      if (await git(stateRoot, ['diff', '--cached', '--name-only'], options.signal)) {
        await git(stateRoot, ['commit', '-m', 'chore(state): preserve untracked operator notes'], options.signal);
      }
      await git(stateRoot, ['push', 'origin', STATE_BRANCH], options.signal);
    }

    if (await git(repo, ['rev-parse', 'main'], options.signal) !== sourceMainSha) {
      throw new Error('main advanced during migration; refusing cleanup');
    }
    options.signal?.throwIfAborted();

    // From source cleanup through the atomic push, migration is one durability
    // boundary. Cancellation must await this resumable sequence instead of
    // leaving deleted legacy sources without a durable completion marker.
    if (sourceIsHostRepo) {
      await git(repo, ['rm', '-r', '--cached', '--ignore-unmatch', '.pan/records', '.pan/continues', '.pan/specs', '.pan/drafts', '.pan/review', '.pan/test', '.pan/feedback', '.pan/backlog', '.pan/notes']);
    }
    const oldContext = join(legacyStateSource, '.pan', 'context');
    const newContext = join(legacyStateSource, '.overdeck', 'context');
    let movedContext = false;
    if (existsSync(oldContext) && !existsSync(newContext)) {
      mkdirSync(dirname(newContext), { recursive: true });
      renameSync(oldContext, newContext);
      movedContext = true;
    }
    rewriteGitignore(legacyStateSource);
    // Resume tolerance: a prior attempt may already have committed the
    // context deletions — `git add -u` exits 128 on a pathspec with no
    // tracked entries left.
    if (sourceIsHostRepo) {
      if (await git(repo, ['ls-files', '--', '.pan/context'])) {
        await git(repo, ['add', '-u', '--', '.pan/context']);
      }
      const addPaths = ['.gitignore'];
      if (movedContext || existsSync(newContext)) addPaths.push('.overdeck/context');
      await git(repo, ['add', '--', ...addPaths]);
      // Resume tolerance: skip when a prior attempt already committed the cleanup.
      if (await git(repo, ['diff', '--cached', '--name-only'])) {
        await git(repo, ['commit', '-m', 'chore(state): move permanent state to overdeck-state']);
      }
    }

    await verifyStateMigrationManifest(manifest);
    for (const entry of manifest) rmSync(entry.source, { force: true });
    if (!sourceIsHostRepo) {
      rmSync(join(legacyStateSource, '.pan'), { recursive: true, force: true });
    }
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

export const __testInternals = { copyFileAbortable, copyLegacyState, git };

export function registerStateMigrationCommand(admin: Command): void {
  admin.command('state')
    .description('Permanent state administration')
    .command('migrate <project>')
    .description('Move permanent state to the orphan overdeck-state branch')
    .option('--dry-run', 'Print the exact migration plan without mutating anything')
    .action((project: string, options: { dryRun?: boolean }) => migrateProjectState(project, options));
}
