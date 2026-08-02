/**
 * xBRIEF File I/O Utilities
 *
 * Single-spec model (PAN-1124): the canonical xBRIEF spec lives in `specs/`
 * on `overdeck-state` with a `.xbrief.json` filename behind the project state
 * read/write doors. Work and task operations cannot mutate its structure; they
 * may only advance `plan.status` through
 * `updateSpecStatus()` in `pan-dir/specs.ts`. A deliberate return to planning
 * may replace the full document at the same canonical path through
 * `writeSpecDocument()`, preserving stable item IDs so existing progress still
 * applies.
 *
 * Runtime item/subItem status is tracked as a flat `statusOverrides` map in
 * the workspace continue file (`<workspace>/.overdeck/continue.json`).
 * `readWorkspacePlan()` returns a merged view (canonical spec + overlay) so
 * callers never need to know about the overlay.
 *
 * `updateItemStatus` and `updateSubItemStatus` write ONLY to the workspace
 * continue file — they cannot mutate the canonical spec.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { Data, Effect } from 'effect';
import { getLegacyWorkspacePanPaths, getWorkspacePanPaths } from '../pan-dir/continue.js';
import { getProjectPanPaths } from '../pan-dir/specs.js';
import {
  getProjectConfigFromWorkspacePath,
  readIssueRecord,
  readIssueRecordSync,
  resolveProjectForIssue,
  writeStatusOverrideSync,
} from '../pan-dir/record.js';
import type { ProjectConfig } from '../projects.js';
import { parseXBriefFilename } from './lifecycle.js';
import { FsError } from '../errors.js';
import { subItemsOf, type XBriefDifficulty, type XBriefDocument, type XBriefInfo, type XBriefItemStatus } from './types.js';
import type { TierOverridesMap } from './continue-state.js';

export type { TierOverride, TierOverridesMap, TierPromotionHistoryEntry } from './continue-state.js';

/**
 * Synchronous spec lookup that mirrors what `findSpecByIssue` did pre-PAN-1249.
 * Used by the sync `findPlan` / `readWorkspacePlan` / `updateItemStatus` /
 * `updateSubItemStatus` call sites which still exist in CLI tooling. The
 * Effect-based pan-dir `findSpecByIssue` requires async FileSystem operations
 * (`fs.readDirectory`, `fs.readFileString`) that cannot run under
 * `Effect.runSync` — so we keep a local sync mirror rather than break CLI
 * synchronous semantics. Dashboard server code uses `findPlanAsync`.
 */
function findSpecByIssueSync(projectRoot: string, issueId: string): { path: string } | null {
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

/** Derive the project root from a workspace path. */
function projectRootFromWorkspace(workspacePath: string): string {
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
  const projectRoot = projectRootFromWorkspace(workspacePath);
  const entry = findSpecByIssueSync(projectRoot, issueId);
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
 * Apply statusOverrides from workspace continue.json onto a deep-cloned spec.
 * Keys are either `"item-id"` (item status) or `"item-id.sub-id"` (subItem status).
 */
export function applyStatusOverrides(doc: XBriefDocument, overrides: Record<string, string>): XBriefDocument {
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

function resolveProjectForWorkspace(workspacePath: string): ProjectConfig | null {
  const issueId = issueIdFromWorkspacePath(workspacePath);
  if (!issueId) return null;
  return resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(workspacePath);
}

function readStatusOverridesSync(workspacePath: string): Record<string, string> | undefined {
  const issueId = issueIdFromWorkspacePath(workspacePath);
  if (!issueId) return undefined;
  const project = resolveProjectForWorkspace(workspacePath);
  if (!project) return undefined;
  return readIssueRecordSync(project, issueId)?.statusOverrides;
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

export function recordTierPromotion(
  workspacePath: string,
  itemId: string,
  from: XBriefDifficulty,
  to: XBriefDifficulty,
  reason: string,
): void {
  const path = workspaceContinuePath(workspacePath);
  const readablePath = readableWorkspaceContinuePath(workspacePath);
  let state: Record<string, unknown> = {};
  try {
    state = JSON.parse(readFileSync(readablePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    state = {};
  }

  const current = (state.tierOverrides && typeof state.tierOverrides === 'object')
    ? state.tierOverrides as TierOverridesMap
    : {};
  const existing = current[itemId];
  const nextOverrides: TierOverridesMap = {
    ...current,
    [itemId]: {
      effectiveDifficulty: to,
      promotions: (existing?.promotions ?? 0) + 1,
      history: [
        ...(existing?.history ?? []),
        { at: new Date().toISOString(), from, to, reason },
      ],
    },
  };

  mkdirSync(getWorkspacePanPaths(workspacePath).panDir, { recursive: true });
  writeFileSync(path, JSON.stringify({ ...state, tierOverrides: nextOverrides }, null, 2), 'utf-8');
}

/**
 * Reads the xBRIEF plan for a workspace, returning a merged view with
 * statusOverrides applied from the per-issue record.
 * Returns null if no plan exists on main or locally.
 */
/**
 * PAN-2401: overlay the per-issue record's statusOverrides onto an
 * already-loaded plan document. The single overlay door for read paths that
 * resolve the spec themselves (e.g. the /plan API route) — without this, a
 * merged task reads 'pending' forever in every display.
 */
export function mergeRecordStatusOverrides(doc: XBriefDocument, workspacePath: string): XBriefDocument {
  const overrides = readStatusOverridesSync(workspacePath);
  if (overrides && Object.keys(overrides).length > 0) {
    return applyStatusOverrides(doc, overrides);
  }
  return doc;
}

export function readWorkspacePlanSync(workspacePath: string): XBriefDocument | null {
  const planPath = findPlanSync(workspacePath);
  if (!planPath) return null;
  const doc = readPlanSync(planPath);

  const overrides = readStatusOverridesSync(workspacePath);
  if (overrides && Object.keys(overrides).length > 0) {
    return applyStatusOverrides(doc, overrides);
  }
  return doc;
}


/**
 * xBRIEF lifecycle statuses that mean "planning has finished" — i.e., the
 * agent can pick up work or the plan is done. Excludes 'draft' (still being
 * written) and 'cancelled' (abandoned).
 */
const PLANNING_FINISHED_STATUSES = new Set(['proposed', 'approved', 'pending', 'running', 'completed', 'blocked']);

/**
 * Check whether planning has reached the "proposed" state for this workspace.
 *
 * Returns true ONLY when `plan.status === 'proposed'`. Used to gate the
 * dashboard Done button which should hide once the user has approved the plan
 * (status moves out of 'proposed').
 */
export function isPlanningProposed(workspacePath: string, planningDir?: string): boolean {
  return checkPlanStatus(workspacePath, planningDir, status => status === 'proposed');
}


/**
 * Check whether planning has finished for this workspace — i.e., tasks have
 * been generated and the agent can (or already did) start work.
 *
 * Returns true when `plan.status` is any of: 'proposed', 'approved', 'pending',
 * 'running', 'completed', or 'blocked'.
 */
export function isPlanningCompleteSync(workspacePath: string, planningDir?: string): boolean {
  return checkPlanStatus(workspacePath, planningDir, status => PLANNING_FINISHED_STATUSES.has(status));
}


function checkPlanStatus(
  workspacePath: string,
  _planningDir: string | undefined,
  matchStatus: (status: string) => boolean,
): boolean {
  const planPath = findPlanSync(workspacePath);
  if (!planPath) return false;
  try {
    const doc = readPlanSync(planPath);
    const status = doc.plan?.status;
    if (status && matchStatus(status)) return true;
    if (status) return false;
  } catch {
    // Corrupt / unreadable plan
  }
  return false;
}


/**
 * Updates the status of a specific item by writing to the per-issue record's
 * `statusOverrides` map. Does NOT mutate the spec on main.
 * No-ops gracefully if no plan exists for this workspace.
 */
export function updateItemStatus(workspacePath: string, itemId: string, status: XBriefItemStatus): void {
  const planPath = findPlanSync(workspacePath);
  if (!planPath) return;

  const doc = readPlanSync(planPath);
  const item = doc.plan.items.find(i => i.id === itemId);
  if (!item) return;

  const issueId = issueIdFromWorkspacePath(workspacePath);
  if (!issueId) return;
  const project = resolveProjectForWorkspace(workspacePath);
  if (!project) return;

  writeStatusOverrideSync(project, issueId, itemId, status);
}

/**
 * Updates the status of a specific subItem by writing to the per-issue record's
 * `statusOverrides` map. Uses `itemId.subItemId` as the key.
 * Does NOT mutate the spec on main.
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
  const project = resolveProjectForWorkspace(workspacePath);
  if (!project) return;

  writeStatusOverrideSync(project, issueId, fullSubId, status);
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
    const projectRoot = projectRootFromWorkspace(workspacePath);
    const entry = yield* Effect.tryPromise({
      try: () => findSpecByIssueFromDisk(projectRoot, issueId),
      catch: (cause) => new FsError({ path: projectRoot, operation: 'findSpecByIssue', cause }),
    });
    return entry ? entry.path : yield* findWorkspaceDraftPlan(workspacePath);
  });

/**
 * Effect variant of readWorkspacePlanAsync. Returns null when there's no plan
 * for the workspace; otherwise returns the merged document with statusOverrides
 * applied from the per-issue record. IO/decoding failures surface as typed errors.
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
          try: async () => {
            const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(workspacePath);
            const record = await readIssueRecord(project, issueId);
            return record?.statusOverrides;
          },
          catch: (cause) => new FsError({ path: workspacePath, operation: 'readIssueRecord', cause }),
        })
      : undefined;
    if (overrides && Object.keys(overrides).length > 0) {
      return applyStatusOverrides(doc, overrides);
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
