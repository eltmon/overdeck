/**
 * xBRIEF File I/O Utilities
 *
 * Single-spec model (PAN-1124): the canonical xBRIEF spec lives in
 * `<planHome>/.pan/specs/` with a `.xbrief.json` filename. Work and task
 * operations cannot mutate its structure; they may only advance `plan.status`
 * through `updateSpecStatus()` in `pan-dir/specs.ts`. A deliberate return to
 * planning may replace the full document at the same canonical path through
 * `writeSpecDocument()`, preserving stable item IDs so existing progress still
 * applies.
 *
 * Runtime item/subItem status lives in the per-issue continue file
 * (`<planHome>/.pan/continues/<ISSUE>.xbrief.json`, PAN-3917) under `items`.
 * `readWorkspacePlan()` returns a merged view (canonical spec + overlay) so
 * callers never need to know about the overlay, and `updateItemStatus` /
 * `updateSubItemStatus` write ONLY to the continue file.
 */

/**
 * Sync twins (PAN-3958). Each `…Sync` function below has an async twin and exists only because
 * these callers run in synchronous contexts (sync functions, sync callbacks, or dependency slots typed
 * as sync) and cannot await:
 * - `findPlanSync` (async: `findPlan`): 8 sites in cli/commands/plan-finalize.ts, cli/commands/scope.ts,
 *   cli/commands/start-status.ts, cli/commands/start.ts, lib/xbrief/io.ts.
 * - `findWorkspaceDraftPlanSync` (async: `findWorkspaceDraftPlan`): src/lib/xbrief/io.ts:229.
 * - `readPlanSync` (async: `readPlan`): 10 sites in cli/commands/plan-finalize.ts, cli/commands/scope.ts,
 *   lib/xbrief/io.ts, lib/xbrief/lifecycle-io.ts.
 * - `readWorkspacePlanSync` (async: `readWorkspacePlan`): 9 sites in cli/commands/task.ts,
 *   lib/agents/registered-slot-spawn.ts, lib/agents/spawn-prep.ts, lib/cloister/handoff-context.ts,
 *   lib/cloister/swarm-slot-lifecycle.ts, lib/work/done-preflight.ts, lib/xbrief/acceptance-criteria.ts.
 * Long lists name files under src/; `node scripts/audit-effect-boundary.mjs --json --usage` has the lines.
 * Do not add new synchronous callers; server-reachable code uses the async variants.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { Data, Effect } from 'effect';
import { getLegacyWorkspacePanPaths, getWorkspacePanPaths } from '../pan-dir/continue.js';
import { getProjectPanPaths } from '../pan-dir/specs.js';
import { resolvePlanHome } from '../pan-dir/paths.js';
import { parseXBriefFilename } from './lifecycle.js';
import { FsError } from '../errors.js';
import { subItemsOf, type XBriefDocument, type XBriefInfo, type XBriefItemStatus } from './types.js';
import {
  readItemStatuses,
  readItemStatusesAsync,
  setItemStatus,
  type TierOverridesMap,
  type TierRetriesMap,
} from './continue-state.js';

export type { TierOverride, TierOverridesMap, TierPromotionHistoryEntry, TierRetriesMap, TierRetryEntry } from './continue-state.js';

/**
 * Synchronous spec lookup that mirrors what `findSpecByIssue` did pre-PAN-1249.
 * Used by the sync `findPlan` / `readWorkspacePlan` / `updateItemStatus` /
 * `updateSubItemStatus` call sites which still exist in CLI tooling. The
 * Effect-based pan-dir `findSpecByIssue` requires async FileSystem operations
 * (`fs.readDirectory`, `fs.readFileString`) that cannot run under
 * `Effect.runSync` — so we keep a local sync mirror rather than break CLI
 * synchronous semantics. Dashboard server code uses `findPlanAsync`.
 */
export function findSpecByIssueSync(projectRoot: string, issueId: string): { path: string } | null {
  const upperIssueId = issueId.toUpperCase();
  const { specsDir } = getProjectPanPaths(projectRoot);
  if (!existsSync(specsDir)) return null;
  let filenames: string[];
  try {
    filenames = readdirSync(specsDir);
  } catch {
    return null;
  }
  filenames.sort();
  for (const filename of filenames) {
    const parts = parseXBriefFilename(filename);
    if (!parts) continue;
    if (parts.issueId.toUpperCase() === upperIssueId) {
      return { path: join(specsDir, filename) };
    }
  }
  return null;
}

async function findSpecByIssueFromDisk(projectRoot: string, issueId: string): Promise<{ path: string } | null> {
  const upperIssueId = issueId.toUpperCase();
  const { specsDir } = getProjectPanPaths(projectRoot);
  if (!existsSync(specsDir)) return null;
  let filenames: string[];
  try {
    filenames = await readdir(specsDir);
  } catch {
    return null;
  }
  filenames.sort();
  for (const filename of filenames) {
    const parts = parseXBriefFilename(filename);
    if (!parts) continue;
    if (parts.issueId.toUpperCase() === upperIssueId) {
      return { path: join(specsDir, filename) };
    }
  }
  return null;
}


// ─── Effect-channel typed errors ─────────────────────────────────────────────

/** xBRIEF document on disk had unresolved git merge conflict markers. */
export class XBriefMergeConflictTaggedError extends Data.TaggedError('XBriefMergeConflictError')<{
  readonly planPath: string;
}> {}

/** xBRIEF document on disk does not match the supported spec shape. */
export class XBriefInvalidFormatError extends Data.TaggedError('XBriefInvalidFormatError')<{
  readonly planPath: string;
  readonly reason: string;
}> {}

export type XBriefReadError =
  | FsError
  | XBriefMergeConflictTaggedError
  | XBriefInvalidFormatError;

/**
 * Extract issue ID from a workspace directory path.
 * Workspace paths follow `<projectRoot>/workspaces/feature-<issue-id>/`.
 */
export function issueIdFromWorkspacePath(workspacePath: string): string | null {
  const base = basename(workspacePath);
  const match = base.match(/^feature-([a-z]+-\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * The checkout that OWNS this workspace's plan artifacts (PAN-3917 W9).
 *
 * Planning artifacts for an issue live in the issue workspace's own `.pan/`,
 * on the feature branch, committed by the verb that wrote them. The workspace
 * is a git worktree, so it is its own checkout; `resolvePlanHome` maps it to
 * the `pan_records.repo` sub-repo inside the same worktree for polyrepo
 * projects.
 */
function planCheckoutFromWorkspace(workspacePath: string): string {
  return workspacePath;
}

/**
 * The main checkout the workspace was cut from. Read-only fallback: a spec
 * that has already merged lives in `<main>/.pan/specs/` and not in the
 * workspace that produced it.
 */
function mainCheckoutFromWorkspace(workspacePath: string): string {
  return resolve(workspacePath, '..', '..');
}

function workspaceDraftPath(workspacePath: string): string {
  return getWorkspacePanPaths(workspacePath).specPath;
}

// Runtime reads prefer `.overdeck/`, but planning finalization must prefer the
// `.pan/` path that the planning and write-xbrief contracts tell agents to author.
type WorkspaceDraftOrder = 'runtime-first' | 'authored-first';

function workspaceDraftPaths(workspacePath: string, order: WorkspaceDraftOrder): string[] {
  const runtimePath = workspaceDraftPath(workspacePath);
  const authoredPath = getLegacyWorkspacePanPaths(workspacePath).specPath;
  return order === 'authored-first'
    ? [authoredPath, runtimePath]
    : [runtimePath, authoredPath];
}

function readableWorkspaceDraftPath(
  workspacePath: string,
  order: WorkspaceDraftOrder = 'runtime-first',
): string | null {
  return workspaceDraftPaths(workspacePath, order).find(existsSync) ?? null;
}

function workspaceContinuePath(workspacePath: string): string {
  return getWorkspacePanPaths(workspacePath).continuePath;
}

function readableWorkspaceContinuePath(workspacePath: string): string {
  const canonicalPath = workspaceContinuePath(workspacePath);
  if (existsSync(canonicalPath)) return canonicalPath;
  const legacyPath = getLegacyWorkspacePanPaths(workspacePath).continuePath;
  return existsSync(legacyPath) ? legacyPath : canonicalPath;
}

export function findWorkspaceDraftPlanSync(
  workspacePath: string,
  order: WorkspaceDraftOrder = 'runtime-first',
): string | null {
  const path = readableWorkspaceDraftPath(workspacePath, order);
  if (!path) return null;

  const issueId = issueIdFromWorkspacePath(workspacePath);
  if (!issueId) return path;

  try {
    const doc = readPlanSync(path);
    const planIssueId = doc.plan?.id;
    if (planIssueId && planIssueId.toLowerCase() !== issueId.toLowerCase()) return null;
  } catch {
    return path;
  }

  return path;
}


/**
 * Returns the path to this workspace's xBRIEF source. The canonical main-side
 * spec wins after promotion; before first promotion, the workspace draft is the
 * only valid source.
 *
 * NOTE (PAN-1249): Now runs the underlying pan-dir spec resolution via
 * `Effect.runSync` since findSpecByIssue is Effect-based. The Effect uses
 * NodeFileSystem under the hood which means this synchronous call path
 * actually blocks on async I/O. Kept sync to preserve the CLI call sites.
 */
export function findPlanSync(workspacePath: string): string | null {
  const issueId = issueIdFromWorkspacePath(workspacePath);
  if (!issueId) return null;
  const entry =
    findSpecByIssueSync(planCheckoutFromWorkspace(workspacePath), issueId)
    ?? findSpecByIssueSync(mainCheckoutFromWorkspace(workspacePath), issueId);
  return entry ? entry.path : findWorkspaceDraftPlanSync(workspacePath);
}


/**
 * Reads and parses an xBRIEF document from the given path.
 * Handles both standard format ({ xBRIEFInfo, plan: {...} }) and legacy
 * envelope format ({ vBRIEFInfo, plan: {...} }). Flat format
 * ({ issue, title, items, edges? }) produced by some planning prompts.
 * Throws if the file does not exist or is invalid JSON.
 */
export class XBriefMergeConflictError extends Error {
  constructor(planPath: string) {
    super(
      `xBRIEF document at ${planPath} contains unresolved git merge conflict markers. ` +
      `Resolve all <<<<<<</=======/>>>>>>> markers in that file and commit the result before re-requesting review.`
    );
    this.name = 'XBriefMergeConflictError';
  }
}

export function normalizeXBriefEnvelope<T>(parsed: T): T {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const candidate = parsed as Record<string, unknown>;
  if ('vBRIEFInfo' in candidate && !('xBRIEFInfo' in candidate)) {
    const { vBRIEFInfo, ...rest } = candidate;
    return { xBRIEFInfo: vBRIEFInfo, ...rest } as T;
  }
  return parsed;
}

type XBriefEnvelopeInput =
  | { xBRIEFInfo: XBriefInfo; vBRIEFInfo?: XBriefInfo }
  | { xBRIEFInfo?: XBriefInfo; vBRIEFInfo: XBriefInfo };

export function serializeXBriefDocument<T extends XBriefEnvelopeInput>(doc: T): string {
  const { xBRIEFInfo, vBRIEFInfo, ...rest } = doc;
  return JSON.stringify({ xBRIEFInfo: xBRIEFInfo ?? vBRIEFInfo, ...rest }, null, 2);
}

export function readPlanSync(planPath: string): XBriefDocument {
  const raw = readFileSync(planPath, 'utf-8');
  if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
    throw new XBriefMergeConflictError(planPath);
  }
  const parsed = normalizeXBriefEnvelope(JSON.parse(raw));

  // xBRIEF requires an info envelope and plan top-level key.
  if (parsed.xBRIEFInfo && parsed.plan) {
    return parsed as XBriefDocument;
  }

  // Non-spec format — reject with helpful error
  throw new Error(
    `Invalid xBRIEF format in ${planPath}: missing 'xBRIEFInfo' or legacy 'vBRIEFInfo' and/or 'plan' top-level keys. ` +
    `xBRIEF v0.5-v0.8 requires { "xBRIEFInfo" or legacy "vBRIEFInfo": { "version": "0.5" through "0.8" }, "plan": { ... } }. ` +
    `See docs/XBRIEF.md for the correct format.`
  );
}


/**
 * Overlay per-item statuses from the continue file onto a deep-cloned spec.
 * Keys are either `"item-id"` (item status) or `"item-id.sub-id"` (subItem status).
 */
export function applyItemStatuses(doc: XBriefDocument, overrides: Record<string, string>): XBriefDocument {
  const merged = JSON.parse(JSON.stringify(doc)) as XBriefDocument;
  for (const [key, status] of Object.entries(overrides)) {
    const dotIndex = key.indexOf('.');
    if (dotIndex === -1) {
      const item = merged.plan.items.find(i => i.id === key);
      if (item) {
        item.status = status as XBriefItemStatus;
        if (status === 'completed' && !item.completed) {
          item.completed = new Date().toISOString();
        }
      }
    } else {
      const itemId = key.slice(0, dotIndex);
      const subId = key.slice(dotIndex + 1);
      const item = merged.plan.items.find(i => i.id === itemId);
      const fullSubId = `${itemId}.${subId}`;
      const sub = item ? subItemsOf(item).find(s => s.id === subId || s.id === fullSubId || s.id === key) : undefined;
      if (sub) {
        sub.status = status as XBriefItemStatus;
        if (status === 'completed' && !sub.completed) {
          sub.completed = new Date().toISOString();
        }
      }
    }
  }
  return merged;
}

/** The plan home that owns this workspace's `.pan/` artifacts. */
function planHomeForWorkspace(workspacePath: string): string {
  return resolvePlanHome(planCheckoutFromWorkspace(workspacePath));
}

function readItemStatusesSync(workspacePath: string): Record<string, string> | undefined {
  const issueId = issueIdFromWorkspacePath(workspacePath);
  if (!issueId) return undefined;
  return readItemStatuses(planHomeForWorkspace(workspacePath), issueId);
}

export function readTierOverrides(workspacePath: string): TierOverridesMap {
  const path = readableWorkspaceContinuePath(workspacePath);
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as { tierOverrides?: TierOverridesMap };
    return parsed.tierOverrides ?? {};
  } catch {
    return {};
  }
}

/**
 * PAN-2401: overlay the continue file's item statuses onto an already-loaded
 * plan document. The single overlay door for read paths that resolve the spec
 * themselves (e.g. the /plan API route) — without this, a completed task reads
 * 'pending' forever in every display.
 */
export function mergeContinueItemStatuses(doc: XBriefDocument, workspacePath: string): XBriefDocument {
  const overrides = readItemStatusesSync(workspacePath);
  if (overrides && Object.keys(overrides).length > 0) {
    return applyItemStatuses(doc, overrides);
  }
  return doc;
}

/**
 * Reads the xBRIEF plan for a workspace, returning a merged view with item
 * statuses applied from the continue file.
 * Returns null if no plan exists.
 */
export function readWorkspacePlanSync(workspacePath: string): XBriefDocument | null {
  const planPath = findPlanSync(workspacePath);
  if (!planPath) return null;
  return mergeContinueItemStatuses(readPlanSync(planPath), workspacePath);
}


/**
 * xBRIEF lifecycle statuses that mean "planning has finished" — i.e., the
 * agent can pick up work or the plan is done. Excludes 'draft' (still being
 * written) and 'cancelled' (abandoned).
 */
const PLANNING_FINISHED_STATUSES = new Set(['proposed', 'approved', 'pending', 'running', 'completed', 'blocked']);


/**
 * Updates the status of a specific item in the continue file. Does NOT mutate
 * the canonical spec. No-ops gracefully if no plan exists for this workspace.
 */
export function updateItemStatus(workspacePath: string, itemId: string, status: XBriefItemStatus): void {
  const planPath = findPlanSync(workspacePath);
  if (!planPath) return;

  const doc = readPlanSync(planPath);
  const item = doc.plan.items.find(i => i.id === itemId);
  if (!item) return;

  const issueId = issueIdFromWorkspacePath(workspacePath);
  if (!issueId) return;

  setItemStatus(planHomeForWorkspace(workspacePath), issueId, itemId, status);
}

/**
 * Updates the status of a specific subItem in the continue file, keyed
 * `itemId.subItemId`. Does NOT mutate the canonical spec.
 * No-ops gracefully if the file, item, or subItem doesn't exist.
 */
export function updateSubItemStatus(
  workspacePath: string,
  itemId: string,
  subItemId: string,
  status: XBriefItemStatus,
): void {
  const planPath = findPlanSync(workspacePath);
  if (!planPath) return;

  const doc = readPlanSync(planPath);
  const item = doc.plan.items.find(i => i.id === itemId);
  if (!item) return;

  // Normalize subItemId before validation — spec uses "parentId.subId" format
  const fullSubId = subItemId.includes('.') ? subItemId : `${itemId}.${subItemId}`;
  const subItem = subItemsOf(item).find(s => s.id === subItemId || s.id === fullSubId);
  if (!subItem) return;

  const issueId = issueIdFromWorkspacePath(workspacePath);
  if (!issueId) return;

  setItemStatus(planHomeForWorkspace(workspacePath), issueId, fullSubId, status);
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// These wrap the existing async APIs in Effect with typed error channels so
// callers can compose xBRIEF reads with other Effect-native code. They do NOT
// replace the sync/Promise variants — CLI and legacy callers continue to use
// those. Migrate callers individually as they move into Effect.

/**
 * Effect variant of readPlanAsync — failures surface as typed errors in the
 * channel instead of thrown exceptions.
 */
export const readPlan = (
  planPath: string,
): Effect.Effect<XBriefDocument, XBriefReadError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(planPath, 'utf-8'),
      catch: (cause) => new FsError({ path: planPath, operation: 'readFile', cause }),
    });
    if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
      return yield* Effect.fail(new XBriefMergeConflictTaggedError({ planPath }));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      return yield* Effect.fail(
        new XBriefInvalidFormatError({ planPath, reason: `invalid JSON: ${(cause as Error).message}` }),
      );
    }
    const obj = normalizeXBriefEnvelope(parsed) as { xBRIEFInfo?: unknown; plan?: unknown };
    if (!obj || !obj.xBRIEFInfo || !obj.plan) {
      return yield* Effect.fail(
        new XBriefInvalidFormatError({
          planPath,
          reason: `missing 'xBRIEFInfo' or 'vBRIEFInfo' and/or 'plan' top-level keys`,
        }),
      );
    }
    return obj as XBriefDocument;
  });

export const findWorkspaceDraftPlan = (
  workspacePath: string,
  order: WorkspaceDraftOrder = 'runtime-first',
): Effect.Effect<string | null, FsError> =>
  Effect.gen(function* () {
    const paths = workspaceDraftPaths(workspacePath, order);
    let path: string | null = null;
    for (const candidate of paths) {
      const exists = yield* Effect.tryPromise({
        try: async () => {
          try {
            await readFile(candidate, 'utf-8');
            return true;
          } catch (error: unknown) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
            throw error;
          }
        },
        catch: (cause) => new FsError({ path: candidate, operation: 'readFile', cause }),
      });
      if (exists) {
        path = candidate;
        break;
      }
    }
    if (!path) return null;

    const issueId = issueIdFromWorkspacePath(workspacePath);
    if (!issueId) return path;

    const doc = yield* readPlan(path).pipe(Effect.orElseSucceed(() => null));
    const planIssueId = doc?.plan?.id;
    return planIssueId && planIssueId.toLowerCase() !== issueId.toLowerCase() ? null : path;
  });

/**
 * Effect variant of findPlanAsync. Returns null when the workspace has no
 * resolvable plan — only IO/decoding failures surface as errors.
 */
export const findPlan = (
  workspacePath: string,
): Effect.Effect<string | null, FsError> =>
  Effect.gen(function* () {
    const issueId = issueIdFromWorkspacePath(workspacePath);
    if (!issueId) return null;
    const lookIn = (root: string) =>
      Effect.tryPromise({
        try: () => findSpecByIssueFromDisk(root, issueId),
        catch: (cause) => new FsError({ path: root, operation: 'findSpecByIssue', cause }),
      });
    const entry =
      (yield* lookIn(planCheckoutFromWorkspace(workspacePath)))
      ?? (yield* lookIn(mainCheckoutFromWorkspace(workspacePath)));
    return entry ? entry.path : yield* findWorkspaceDraftPlan(workspacePath);
  });

/**
 * Effect variant of readWorkspacePlanAsync. Returns null when there's no plan
 * for the workspace; otherwise returns the merged document with item statuses
 * applied from the continue file. IO/decoding failures surface as typed errors.
 */
export const readWorkspacePlan = (
  workspacePath: string,
): Effect.Effect<XBriefDocument | null, XBriefReadError> =>
  Effect.gen(function* () {
    const planPath = yield* findPlan(workspacePath);
    if (!planPath) return null;
    const doc = yield* readPlan(planPath);

    const issueId = issueIdFromWorkspacePath(workspacePath);
    const overrides = issueId
      ? yield* Effect.tryPromise({
          try: () => readItemStatusesAsync(planHomeForWorkspace(workspacePath), issueId),
          catch: (cause) => new FsError({ path: workspacePath, operation: 'readItemStatuses', cause }),
        })
      : undefined;
    if (overrides && Object.keys(overrides).length > 0) {
      return applyItemStatuses(doc, overrides);
    }
    return doc;
  });

export const isPlanningComplete = (
  workspacePath: string,
  _planningDir?: string,
): Effect.Effect<boolean, XBriefReadError> =>
  Effect.gen(function* () {
    const planPath = yield* findPlan(workspacePath);
    if (!planPath) return false;
    const doc = yield* readPlan(planPath).pipe(Effect.orElseSucceed(() => null));
    const status = doc?.plan?.status;
    if (status && PLANNING_FINISHED_STATUSES.has(status)) return true;
    if (status) return false;
    return false;
  });
