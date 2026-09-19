/**
 * Migrate planning artifacts off the `overdeck-state` worktree into the plan
 * home's `.pan/` directory (PAN-3917, D8, W1 `w1-plan-home`).
 *
 * Copies `drafts/`, `specs/`, `continues/`, `orders/`, `notes/` and
 * `backlog/sequence.md` from `~/.overdeck/state/<project>/` into
 * `<planHome>/.pan/`. Per-issue artifacts are copied for OPEN issues only —
 * closed-issue artifacts stay on the archived branch. Artifacts that are not
 * per-issue (orders, notes, the backlog sequence) always copy.
 *
 * Idempotent: a second run copies nothing and reports `0 remaining`. It
 * commits in the plan home only with `commit: true`, and never touches the
 * state worktree.
 *
 * This is the ONE place left under `src/` allowed to read the legacy
 * `records/<issue>.json` shape (`tasks.statusOverrides` / `statusOverrides`)
 * — it is a one-time bridge that carries item progress into the new
 * `.pan/continues/<ISSUE>.xbrief.json` home before the record plane is
 * deleted (PRD FR-16). It is excluded from `scripts/guard-no-state-layer.sh`'s
 * default `src/` scan by naming its own file below; see the migration worker's
 * final report for the exemption this needs.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { getProjectSync } from '../projects.js';
import {
  CONTINUE_FILENAME_SUFFIX,
  updateContinueState,
  type ContinueItemState,
  type ContinueItemsMap,
  type ContinueState,
} from '../xbrief/continue-state.js';
import { parseXBriefFilename } from '../xbrief/lifecycle.js';
import { resolvePlanHome } from './paths.js';

const execFileAsync = promisify(execFile);

export const MIGRATION_COMMIT_SUBJECT = 'chore(workspace): migrate planning artifacts from overdeck-state';

/** Per-issue directories copied byte-for-byte: a file is copied only when its issue is open. */
const PER_ISSUE_COPY_DIRS = ['drafts', 'specs'] as const;
/** Directories copied wholesale — they describe the project, not one issue. */
const WHOLE_DIRS = ['orders', 'notes'] as const;
/** Single files copied wholesale, relative to both roots. */
const WHOLE_FILES = [join('backlog', 'sequence.md')] as const;

/** Legacy status values mapped onto their `.pan/continues` item-status equivalent. */
const STATUS_VALUE_MAP: Record<string, string> = { completed: 'done' };

/** An item's migrated state carries where it came from, alongside the shared shape. */
type MigratedItemState = ContinueItemState & { migratedFrom?: string };

export interface MigratePanHomeOptions {
  /** The state worktree, e.g. `~/.overdeck/state/panopticon-cli`. */
  stateRoot: string;
  /** The repo that owns `.pan/` for this project. */
  planHome: string;
  /** Issue ids that are open in the tracker. Case-insensitive. */
  openIssues: readonly string[];
  /** Commit the copied files in the plan home. Off by default. */
  commit?: boolean;
  /** Preview only: compute what would change but write nothing. */
  dryRun?: boolean;
}

export interface MigratePanHomeResult {
  /** Paths written this run (or, under `dryRun`, that would be written), relative to `<planHome>/.pan`. */
  copied: string[];
  /** Source files that were already byte-identical (or content-identical, for continues) at the destination. */
  unchanged: number;
  /** Source files still not matching the destination after the pass (always 0 on a successful non-dry run). */
  remaining: number;
  /** Per-issue files skipped because their issue is not open. */
  skippedClosed: number;
  committed: boolean;
  /** Open issues whose `.pan/continues/<ISSUE>.xbrief.json` item statuses were created or updated from `records/` overrides. */
  progressUpdated: string[];
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

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `tasks.statusOverrides`, falling back to the top-level `statusOverrides`. */
function readRecordStatusOverrides(stateRoot: string, issueId: string): Record<string, string> | null {
  const record = readJson(join(stateRoot, 'records', `${issueId.toLowerCase()}.json`));
  if (!record) return null;
  const tasks = record.tasks && typeof record.tasks === 'object' ? (record.tasks as Record<string, unknown>) : undefined;
  const overrides = (tasks?.statusOverrides ?? record.statusOverrides) as unknown;
  if (!overrides || typeof overrides !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function mapOverrideStatus(status: string): string {
  return STATUS_VALUE_MAP[status] ?? status;
}

/** Deep structural equality for plain JSON values (objects/arrays/primitives). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(b, key)
      && deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}

/** `obj` without its `updated` key, so timestamp-only churn doesn't register as a change. */
function withoutUpdated(obj: Record<string, unknown> | null): Record<string, unknown> {
  if (!obj) return {};
  const { updated: _updated, ...rest } = obj;
  return rest;
}

function mergeItems(
  base: ContinueItemsMap | undefined,
  overrides: Record<string, string>,
): Record<string, MigratedItemState> {
  const next: Record<string, MigratedItemState> = { ...(base ?? {}) };
  for (const [key, rawStatus] of Object.entries(overrides)) {
    next[key] = {
      ...(base?.[key] ?? {}),
      status: mapOverrideStatus(rawStatus),
      migratedFrom: 'records.statusOverrides',
    };
  }
  return next;
}

/**
 * Copy the open-issue planning artifacts from a state worktree into
 * `<planHome>/.pan/`, and carry each open issue's `records/` item-status
 * overrides into its continue file's `items` map. Never reads or writes the
 * tracker, never deletes anything, and never touches the state worktree.
 */
export async function migratePanHome(options: MigratePanHomeOptions): Promise<MigratePanHomeResult> {
  const { stateRoot, planHome, dryRun = false } = options;
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

  // Byte-copied per-issue artifacts (drafts, specs).
  for (const dir of PER_ISSUE_COPY_DIRS) {
    for (const rel of listFilesRecursive(join(stateRoot, dir))) {
      const issueId = issueIdForArtifact(dir, rel.split('/').pop() ?? rel);
      if (!issueId || !open.has(issueId)) {
        skippedClosed += 1;
        continue;
      }
      consider(join(stateRoot, dir, rel), join(dir, destinationName(dir, rel, issueId)));
    }
  }

  // Project-wide artifacts.
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
    if (!dryRun) copyFile(entry.source, entry.dest);
    copied.push(entry.rel);
  }

  // Continues: a merge target, not a byte copy — item progress from
  // `records/` and the legacy continue file's own fields land in the same
  // destination, so they are computed and compared together per issue.
  const continueSourceByIssue = new Map<string, string>();
  for (const rel of listFilesRecursive(join(stateRoot, 'continues'))) {
    const issueId = issueIdForArtifact('continues', rel.split('/').pop() ?? rel);
    if (!issueId) continue;
    if (!open.has(issueId)) {
      skippedClosed += 1;
      continue;
    }
    continueSourceByIssue.set(issueId, join(stateRoot, 'continues', rel));
  }

  const progressUpdated: string[] = [];
  for (const issueId of open) {
    const sourcePath = continueSourceByIssue.get(issueId) ?? null;
    const overrides = readRecordStatusOverrides(stateRoot, issueId);
    if (!sourcePath && !overrides) continue;

    const destRel = join('continues', `${issueId}${CONTINUE_FILENAME_SUFFIX}`);
    const destPath = join(panDir, destRel);
    const currentDest = readJson(destPath);
    const sourceJson = sourcePath ? readJson(sourcePath) : null;

    const base: Record<string, unknown> = currentDest ?? sourceJson ?? {
      version: '1',
      issueId,
      created: new Date().toISOString(),
    };
    const mergedItems = overrides
      ? mergeItems(base.items as ContinueItemsMap | undefined, overrides)
      : (base.items as ContinueItemsMap | undefined);
    const desired: Record<string, unknown> = mergedItems ? { ...base, items: mergedItems } : { ...base };

    if (deepEqual(withoutUpdated(desired), withoutUpdated(currentDest))) {
      unchanged += 1;
      continue;
    }

    copied.push(destRel);
    if (overrides) progressUpdated.push(issueId);
    if (!dryRun) {
      updateContinueState(planHome, issueId, () => desired as unknown as ContinueState);
    }
  }

  const remaining = dryRun
    ? copied.length
    : pending.filter((entry) => !sameBytes(entry.source, entry.dest)).length;

  let committed = false;
  if (options.commit && !dryRun && copied.length > 0) {
    const addPaths = copied.map((rel) => join('.pan', rel));
    await execFileAsync('git', ['add', '--', ...addPaths], { cwd: planHome });
    const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: planHome });
    if (stdout.trim().length > 0) {
      await execFileAsync('git', ['commit', '-m', MIGRATION_COMMIT_SUBJECT], { cwd: planHome });
      committed = true;
    }
  }

  return { copied: copied.sort(), unchanged, remaining, skippedClosed, committed, progressUpdated: progressUpdated.sort() };
}

export function readOpenIssuesFile(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export interface ResolveMigrationTargetsOptions {
  /** Registered project key, e.g. `lexerra`. */
  project?: string;
  /** Override for the state worktree root. */
  stateRoot?: string;
  /** Override for the plan home (the repo that owns `.pan/`). */
  planHome?: string;
}

/**
 * Resolve `{ stateRoot, planHome }` from a project key (honoring
 * `OVERDECK_HOME` and `pan_records.repo` via `resolvePlanHome`), with
 * `stateRoot` / `planHome` overrides for tests and odd setups.
 */
export function resolveMigrationTargets(options: ResolveMigrationTargetsOptions): { stateRoot: string; planHome: string } {
  const { project } = options;
  const stateRoot = options.stateRoot
    ?? (project ? join(process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck'), 'state', project) : undefined);
  if (!stateRoot) {
    throw new Error('migrate-plan-home: pass --project <key> or --state-root <dir>');
  }
  const configured = project ? getProjectSync(project) : null;
  const planHome = options.planHome ?? (configured ? resolvePlanHome(configured.path) : undefined);
  if (!planHome) {
    throw new Error('migrate-plan-home: --plan-home <dir> is required for an unregistered project');
  }
  return { stateRoot, planHome };
}
