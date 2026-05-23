/**
 * vBRIEF File I/O Utilities
 *
 * Single-spec-on-main model (PAN-1124): the canonical vBRIEF spec lives at
 * `<projectRoot>/.pan/specs/<canonical>.vbrief.json` and is immutable after
 * planning writes it. The only legal spec mutation is `plan.status` via
 * `updateSpecStatus()` in `pan-dir/specs.ts`.
 *
 * Runtime item/subItem status is tracked as a flat `statusOverrides` map in
 * the workspace continue file (`<workspace>/.pan/continue.json`).
 * `readWorkspacePlan()` returns a merged view (main spec + overlay) so
 * callers never need to know about the overlay.
 *
 * `updateItemStatus` and `updateSubItemStatus` write ONLY to the workspace
 * continue file — they cannot mutate the spec on main.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { Data, Effect } from 'effect';
import { getProjectPanPaths } from '../pan-dir/specs.js';
import { readWorkspaceContinue, writeWorkspaceContinue } from '../pan-dir/continue.js';
import type { WorkspaceContinueState } from '../pan-dir/types.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME, PAN_SPEC_FILENAME } from '../pan-dir/types.js';
import { parseVBriefFilename } from './lifecycle.js';
import { FsError } from '../errors.js';
import type { VBriefDocument, VBriefItemStatus } from './types.js';

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
    const parts = parseVBriefFilename(filename);
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
    const parts = parseVBriefFilename(filename);
    if (!parts) continue;
    if (parts.issueId.toUpperCase() === upperIssueId) {
      return { path: join(specsDir, filename) };
    }
  }
  return null;
}

/** Read the workspace continue file synchronously, returning null on any error. */
export function readWorkspaceContinueSync(workspacePath: string): WorkspaceContinueState | null {
  const continuePath = join(workspacePath, PAN_DIRNAME, PAN_CONTINUE_FILENAME);
  if (!existsSync(continuePath)) return null;
  try {
    const raw = readFileSync(continuePath, 'utf-8');
    return JSON.parse(raw) as WorkspaceContinueState;
  } catch {
    return null;
  }
}

/**
 * Write the workspace continue file synchronously via temp-file + rename, matching
 * the atomic-write contract of `pan-dir/continue.ts:writeWorkspaceContinue`
 * (which is now Effect-based and async). Used by the sync `updateItemStatus` /
 * `updateSubItemStatus` CLI call sites; dashboard code should prefer the async
 * Effect API.
 */
export function writeWorkspaceContinueSync(workspacePath: string, state: WorkspaceContinueState): void {
  const panDir = join(workspacePath, PAN_DIRNAME);
  const continuePath = join(panDir, PAN_CONTINUE_FILENAME);
  mkdirSync(panDir, { recursive: true });
  const now = new Date().toISOString();
  const next: WorkspaceContinueState = {
    ...state,
    version: '1',
    created: state.created || now,
    updated: now,
  };
  const tmp = `${continuePath}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  renameSync(tmp, continuePath);
}

// ─── Effect-channel typed errors ─────────────────────────────────────────────

/** vBRIEF document on disk had unresolved git merge conflict markers. */
export class VBriefMergeConflictTaggedError extends Data.TaggedError('VBriefMergeConflictError')<{
  readonly planPath: string;
}> {}

/** vBRIEF document on disk does not match the v0.5 spec shape. */
export class VBriefInvalidFormatError extends Data.TaggedError('VBriefInvalidFormatError')<{
  readonly planPath: string;
  readonly reason: string;
}> {}

export type VBriefReadError =
  | FsError
  | VBriefMergeConflictTaggedError
  | VBriefInvalidFormatError;

/**
 * Extract issue ID from a workspace directory path.
 * Workspace paths follow `<projectRoot>/workspaces/feature-<issue-id>/`.
 */
export function issueIdFromWorkspacePath(workspacePath: string): string | null {
  const base = basename(workspacePath);
  const match = base.match(/^feature-([a-z]+-\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

/** Derive the project root from a workspace path (two levels up). */
function projectRootFromWorkspace(workspacePath: string): string {
  return resolve(workspacePath, '..', '..');
}

function workspaceDraftPath(workspacePath: string): string {
  return join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME);
}

export function findWorkspaceDraftPlanSync(workspacePath: string): string | null {
  const path = workspaceDraftPath(workspacePath);
  if (!existsSync(path)) return null;

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
 * Returns the path to this workspace's vBRIEF source. The canonical main-side
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
 * Reads and parses plan.vbrief.json from the given path.
 * Handles both standard format ({ vBRIEFInfo, plan: {...} }) and flat format
 * ({ issue, title, items, edges? }) produced by some planning prompts.
 * Throws if the file does not exist or is invalid JSON.
 */
export class VBriefMergeConflictError extends Error {
  constructor(planPath: string) {
    super(
      `plan.vbrief.json at ${planPath} contains unresolved git merge conflict markers. ` +
      `Resolve all <<<<<<</=======/>>>>>>> markers in that file and commit the result before re-requesting review.`
    );
    this.name = 'VBriefMergeConflictError';
  }
}

export function readPlanSync(planPath: string): VBriefDocument {
  const raw = readFileSync(planPath, 'utf-8');
  if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
    throw new VBriefMergeConflictError(planPath);
  }
  const parsed = JSON.parse(raw);

  // vBRIEF v0.5 requires exactly two top-level keys: vBRIEFInfo and plan
  if (parsed.vBRIEFInfo && parsed.plan) {
    return parsed as VBriefDocument;
  }

  // Non-spec format — reject with helpful error
  throw new Error(
    `Invalid vBRIEF format in ${planPath}: missing 'vBRIEFInfo' and/or 'plan' top-level keys. ` +
    `vBRIEF v0.5 requires exactly { "vBRIEFInfo": { "version": "0.5" }, "plan": { ... } }. ` +
    `See docs/VBRIEF.md for the correct format.`
  );
}


/**
 * Apply statusOverrides from workspace continue.json onto a deep-cloned spec.
 * Keys are either `"item-id"` (item status) or `"item-id.sub-id"` (subItem status).
 */
export function applyStatusOverrides(doc: VBriefDocument, overrides: Record<string, string>): VBriefDocument {
  const merged = JSON.parse(JSON.stringify(doc)) as VBriefDocument;
  for (const [key, status] of Object.entries(overrides)) {
    const dotIndex = key.indexOf('.');
    if (dotIndex === -1) {
      const item = merged.plan.items.find(i => i.id === key);
      if (item) {
        item.status = status as VBriefItemStatus;
        if (status === 'completed' && !item.completed) {
          item.completed = new Date().toISOString();
        }
      }
    } else {
      const itemId = key.slice(0, dotIndex);
      const subId = key.slice(dotIndex + 1);
      const item = merged.plan.items.find(i => i.id === itemId);
      const fullSubId = `${itemId}.${subId}`;
      const sub = item?.subItems?.find(s => s.id === subId || s.id === fullSubId || s.id === key);
      if (sub) {
        sub.status = status as VBriefItemStatus;
        if (status === 'completed' && !sub.completed) {
          sub.completed = new Date().toISOString();
        }
      }
    }
  }
  return merged;
}

/**
 * Reads the vBRIEF plan for a workspace, returning a merged view with
 * statusOverrides applied from the workspace continue file.
 * Returns null if no plan exists on main or locally.
 */
export function readWorkspacePlanSync(workspacePath: string): VBriefDocument | null {
  const planPath = findPlanSync(workspacePath);
  if (!planPath) return null;
  const doc = readPlanSync(planPath);

  const continueState = readWorkspaceContinueSync(workspacePath);
  if (continueState?.statusOverrides && Object.keys(continueState.statusOverrides).length > 0) {
    return applyStatusOverrides(doc, continueState.statusOverrides);
  }
  return doc;
}


/**
 * vBRIEF lifecycle statuses that mean "planning has finished" — i.e., the
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
 * Check whether planning has finished for this workspace — i.e., beads have
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
 * Updates the status of a specific item by writing to the workspace
 * continue file's `statusOverrides` map. Does NOT mutate the spec on main.
 * No-ops gracefully if no plan exists for this workspace.
 */
export function updateItemStatus(workspacePath: string, itemId: string, status: VBriefItemStatus): void {
  const planPath = findPlanSync(workspacePath);
  if (!planPath) return;

  const doc = readPlanSync(planPath);
  const item = doc.plan.items.find(i => i.id === itemId);
  if (!item) return;

  const continueState: WorkspaceContinueState = readWorkspaceContinueSync(workspacePath) ?? {
    version: '1' as const,
    issueId: issueIdFromWorkspacePath(workspacePath) ?? 'UNKNOWN',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    gitState: {},
    decisions: [],
    hazards: [],
    resumePoint: null,
    beadsMapping: {},
    sessionHistory: [],
  };

  const overrides = { ...continueState.statusOverrides };
  overrides[itemId] = status;
  continueState.statusOverrides = overrides;

  writeWorkspaceContinueSync(workspacePath, continueState);
}

/**
 * Updates the status of a specific subItem by writing to the workspace
 * continue file's `statusOverrides` map. Uses `itemId.subItemId` as the key.
 * Does NOT mutate the spec on main.
 * No-ops gracefully if the file, item, or subItem doesn't exist.
 */
export function updateSubItemStatus(
  workspacePath: string,
  itemId: string,
  subItemId: string,
  status: VBriefItemStatus,
): void {
  const planPath = findPlanSync(workspacePath);
  if (!planPath) return;

  const doc = readPlanSync(planPath);
  const item = doc.plan.items.find(i => i.id === itemId);
  if (!item?.subItems) return;

  // Normalize subItemId before validation — spec uses "parentId.subId" format
  const fullSubId = subItemId.includes('.') ? subItemId : `${itemId}.${subItemId}`;
  const subItem = item.subItems.find(s => s.id === subItemId || s.id === fullSubId);
  if (!subItem) return;

  const continueState: WorkspaceContinueState = readWorkspaceContinueSync(workspacePath) ?? {
    version: '1' as const,
    issueId: issueIdFromWorkspacePath(workspacePath) ?? 'UNKNOWN',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    gitState: {},
    decisions: [],
    hazards: [],
    resumePoint: null,
    beadsMapping: {},
    sessionHistory: [],
  };

  const overrides = { ...continueState.statusOverrides };
  overrides[fullSubId] = status;
  continueState.statusOverrides = overrides;

  writeWorkspaceContinueSync(workspacePath, continueState);
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// These wrap the existing async APIs in Effect with typed error channels so
// callers can compose vBRIEF reads with other Effect-native code. They do NOT
// replace the sync/Promise variants — CLI and legacy callers continue to use
// those. Migrate callers individually as they move into Effect.

/**
 * Effect variant of readPlanAsync — failures surface as typed errors in the
 * channel instead of thrown exceptions.
 */
export const readPlan = (
  planPath: string,
): Effect.Effect<VBriefDocument, VBriefReadError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(planPath, 'utf-8'),
      catch: (cause) => new FsError({ path: planPath, operation: 'readFile', cause }),
    });
    if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
      return yield* Effect.fail(new VBriefMergeConflictTaggedError({ planPath }));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      return yield* Effect.fail(
        new VBriefInvalidFormatError({ planPath, reason: `invalid JSON: ${(cause as Error).message}` }),
      );
    }
    const obj = parsed as { vBRIEFInfo?: unknown; plan?: unknown };
    if (!obj || !obj.vBRIEFInfo || !obj.plan) {
      return yield* Effect.fail(
        new VBriefInvalidFormatError({
          planPath,
          reason: `missing 'vBRIEFInfo' and/or 'plan' top-level keys`,
        }),
      );
    }
    return obj as VBriefDocument;
  });

export const findWorkspaceDraftPlan = (
  workspacePath: string,
): Effect.Effect<string | null, FsError> =>
  Effect.gen(function* () {
    const path = workspaceDraftPath(workspacePath);
    const exists = yield* Effect.tryPromise({
      try: async () => {
        try {
          await readFile(path, 'utf-8');
          return true;
        } catch (error: any) {
          if (error?.code === 'ENOENT') return false;
          throw error;
        }
      },
      catch: (cause) => new FsError({ path, operation: 'readFile', cause }),
    });
    if (!exists) return null;

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
 * applied. IO/decoding failures surface as typed errors.
 */
export const readWorkspacePlan = (
  workspacePath: string,
): Effect.Effect<VBriefDocument | null, VBriefReadError> =>
  Effect.gen(function* () {
    const planPath = yield* findPlan(workspacePath);
    if (!planPath) return null;
    const doc = yield* readPlan(planPath);

    const continueState = yield* readWorkspaceContinue(workspacePath);
    if (continueState?.statusOverrides && Object.keys(continueState.statusOverrides).length > 0) {
      return applyStatusOverrides(doc, continueState.statusOverrides);
    }
    return doc;
  });

export const isPlanningComplete = (
  workspacePath: string,
  _planningDir?: string,
): Effect.Effect<boolean, VBriefReadError> =>
  Effect.gen(function* () {
    const planPath = yield* findPlan(workspacePath);
    if (!planPath) return false;
    const doc = yield* readPlan(planPath).pipe(Effect.orElseSucceed(() => null));
    const status = doc?.plan?.status;
    if (status && PLANNING_FINISHED_STATUSES.has(status)) return true;
    if (status) return false;
    return false;
  });
