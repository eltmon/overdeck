#!/usr/bin/env tsx
/**
 * Migrate planning artifacts off the `overdeck-state` worktree into the plan
 * home's `.pan/` directory (PAN-3917, D8).
 *
 * Copies `drafts/`, `specs/`, `continues/`, `orders/`, `notes/` and
 * `backlog/sequence.md` from `~/.overdeck/state/<project>/` into
 * `<planHome>/.pan/`. Per-issue artifacts are copied for OPEN issues only —
 * closed-issue artifacts stay on the archived branch. The open-issue list is an
 * input file (one issue id per line) so this script has no tracker dependency.
 * Artifacts that are not per-issue (orders, notes, the backlog sequence) always
 * copy.
 *
 * Idempotent: a second run copies nothing and reports `0 remaining`. It commits
 * in the plan home only with `--commit`, and never touches the state worktree.
 *
 * Usage:
 *   tsx scripts/migrate-pan-home.ts --project <key> --open-issues <file> [--commit]
 *   tsx scripts/migrate-pan-home.ts --state-root <dir> --plan-home <dir> --open-issues <file>
 *
 * With `--project` the state worktree and the plan home are resolved from
 * `projects.yaml` (`pan_records.repo` when set); `--state-root` / `--plan-home`
 * override either one.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { resolvePlanHome } from '../src/lib/pan-dir/paths.js';
import { getProjectSync } from '../src/lib/projects.js';
import { CONTINUE_FILENAME_SUFFIX } from '../src/lib/xbrief/continue-state.js';
import { parseXBriefFilename } from '../src/lib/xbrief/lifecycle.js';

const execFileAsync = promisify(execFile);

export const MIGRATION_COMMIT_SUBJECT = 'chore(workspace): migrate planning artifacts from overdeck-state';

/** Per-issue directories: a file is copied only when its issue is open. */
const PER_ISSUE_DIRS = ['drafts', 'specs', 'continues'] as const;
/** Directories copied wholesale — they describe the project, not one issue. */
const WHOLE_DIRS = ['orders', 'notes'] as const;
/** Single files copied wholesale, relative to both roots. */
const WHOLE_FILES = [join('backlog', 'sequence.md')] as const;

export interface MigratePanHomeOptions {
  /** The state worktree, e.g. `~/.overdeck/state/panopticon-cli`. */
  stateRoot: string;
  /** The repo that owns `.pan/` for this project. */
  planHome: string;
  /** Issue ids that are open in the tracker. Case-insensitive. */
  openIssues: readonly string[];
  /** Commit the copied files in the plan home. Off by default. */
  commit?: boolean;
}

export interface MigratePanHomeResult {
  /** Paths written this run, relative to `<planHome>/.pan`. */
  copied: string[];
  /** Source files that were already byte-identical at the destination. */
  unchanged: number;
  /** Source files still not matching the destination after the pass (always 0 on success). */
  remaining: number;
  /** Per-issue files skipped because their issue is not open. */
  skippedClosed: number;
  committed: boolean;
}

/** The issue a per-issue artifact belongs to, or null when the name says nothing. */
export function issueIdForArtifact(dir: string, filename: string): string | null {
  if (dir === 'specs') return parseXBriefFilename(filename)?.issueId.toUpperCase() ?? null;
  if (dir === 'continues') {
    const match = filename.match(/^([a-z]+-\d+)\.(?:xbrief|vbrief)\.json$/i);
    return match ? match[1].toUpperCase() : null;
  }
  if (dir === 'drafts') {
    const match = filename.match(/^([a-z]+-\d+)\.md$/i);
    return match ? match[1].toUpperCase() : null;
  }
  return null;
}

/**
 * The name an artifact takes in `.pan/`. State-worktree continues are named
 * `pan-1014.vbrief.json`; `continueStatePath` reads `PAN-1014.xbrief.json`, so
 * they are renamed on copy or the migrated file is invisible. Drafts and specs
 * keep their names (their resolvers already accept both cases and suffixes).
 */
export function destinationName(dir: string, rel: string, issueId: string): string {
  if (dir !== 'continues') return rel;
  return `${issueId.toUpperCase()}${CONTINUE_FILENAME_SUFFIX}`;
}

function listFilesRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!existsSync(full)) continue; // dangling symlink: nothing to migrate
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  };
  walk(root);
  return out;
}

function sameBytes(source: string, dest: string): boolean {
  if (!existsSync(dest)) return false;
  return readFileSync(source).equals(readFileSync(dest));
}

function copyFile(source: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(source));
}

/**
 * Copy the open-issue planning artifacts from a state worktree into
 * `<planHome>/.pan/`. Never reads or writes the tracker, never deletes
 * anything, and never touches the state worktree.
 */
export async function migratePanHome(options: MigratePanHomeOptions): Promise<MigratePanHomeResult> {
  const { stateRoot, planHome } = options;
  const open = new Set(options.openIssues.map((id) => id.trim().toUpperCase()).filter(Boolean));
  const panDir = join(planHome, '.pan');

  const copied: string[] = [];
  let unchanged = 0;
  let skippedClosed = 0;
  const pending: { source: string; dest: string; rel: string }[] = [];

  const consider = (source: string, rel: string): void => {
    const dest = join(panDir, rel);
    if (sameBytes(source, dest)) {
      unchanged += 1;
      return;
    }
    pending.push({ source, dest, rel });
  };

  for (const dir of PER_ISSUE_DIRS) {
    for (const rel of listFilesRecursive(join(stateRoot, dir))) {
      const issueId = issueIdForArtifact(dir, rel.split('/').pop() ?? rel);
      if (!issueId || !open.has(issueId)) {
        skippedClosed += 1;
        continue;
      }
      consider(join(stateRoot, dir, rel), join(dir, destinationName(dir, rel, issueId)));
    }
  }

  for (const dir of WHOLE_DIRS) {
    for (const rel of listFilesRecursive(join(stateRoot, dir))) {
      consider(join(stateRoot, dir, rel), join(dir, rel));
    }
  }

  for (const rel of WHOLE_FILES) {
    const source = join(stateRoot, rel);
    if (existsSync(source)) consider(source, rel);
  }

  for (const entry of pending) {
    copyFile(entry.source, entry.dest);
    copied.push(entry.rel);
  }

  const remaining = pending.filter((entry) => !sameBytes(entry.source, entry.dest)).length;

  let committed = false;
  if (options.commit && copied.length > 0) {
    await execFileAsync('git', ['add', '--', ...copied.map((rel) => join('.pan', rel))], { cwd: planHome });
    const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: planHome });
    if (stdout.trim().length > 0) {
      await execFileAsync('git', ['commit', '-m', MIGRATION_COMMIT_SUBJECT], { cwd: planHome });
      committed = true;
    }
  }

  return { copied: copied.sort(), unchanged, remaining, skippedClosed, committed };
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function readOpenIssuesFile(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

async function main(argv: readonly string[]): Promise<number> {
  const openIssuesPath = argValue(argv, '--open-issues');
  if (!openIssuesPath) {
    process.stderr.write('migrate-pan-home: --open-issues <file> is required (one issue id per line)\n');
    return 2;
  }
  const project = argValue(argv, '--project');
  const stateRoot = argValue(argv, '--state-root')
    ?? (project ? join(process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck'), 'state', project) : undefined);
  if (!stateRoot) {
    process.stderr.write('migrate-pan-home: pass --project <key> or --state-root <dir>\n');
    return 2;
  }
  const configured = project ? getProjectSync(project) : null;
  const planHome = argValue(argv, '--plan-home')
    ?? (configured ? resolvePlanHome(configured.path) : undefined);
  if (!planHome) {
    process.stderr.write('migrate-pan-home: --plan-home <dir> is required for an unregistered project\n');
    return 2;
  }

  const result = await migratePanHome({
    stateRoot,
    planHome,
    openIssues: readOpenIssuesFile(openIssuesPath),
    commit: argv.includes('--commit'),
  });

  process.stdout.write(
    `copied ${result.copied.length}, unchanged ${result.unchanged}, `
    + `skipped ${result.skippedClosed} closed-issue file(s), ${result.remaining} remaining`
    + `${result.committed ? ', committed' : ''}\n`,
  );
  return result.remaining === 0 ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('migrate-pan-home.ts')) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
