/**
 * PRD location resolution — single source of truth.
 *
 * PRDs have historically been written in four formats due to a casing bug:
 *   1. docs/prds/<status>/<id-lower>/        — canonical subdirectory (new)
 *   2. docs/prds/<status>/<ID-UPPER>/        — buggy uppercase variant
 *   3. docs/prds/<status>/<id-lower>-plan.md — legacy flat file
 *   4. docs/prds/<status>/<ID-UPPER>-plan.md — buggy uppercase flat file
 *
 * All readers MUST go through findPrdAtStatus / findPrdAnywhere so they tolerate
 * every variant. All writers MUST use canonicalPrdSubdir so new artifacts only
 * land in the canonical lowercase subdirectory format.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import {
  PROJECT_DOCS_SUBDIR,
  PROJECT_PRDS_SUBDIR,
  PROJECT_PRDS_ACTIVE_SUBDIR,
  PROJECT_PRDS_PLANNED_SUBDIR,
  PROJECT_PRDS_COMPLETED_SUBDIR,
} from './paths.js';
import { getIssueDraftPath } from './pan-dir/index.js';

export type PrdStatus = 'active' | 'planned' | 'completed' | 'draft';
export type PrdFormat = 'subdir' | 'flat' | 'pan-draft';

export interface PrdLocation {
  /** Absolute path to either the per-issue subdirectory or the flat .md file. */
  path: string;
  format: PrdFormat;
  status: PrdStatus;
}

const STATUS_DIRS: Record<Exclude<PrdStatus, 'draft'>, string> = {
  active: PROJECT_PRDS_ACTIVE_SUBDIR,
  planned: PROJECT_PRDS_PLANNED_SUBDIR,
  completed: PROJECT_PRDS_COMPLETED_SUBDIR,
};

function statusRoot(projectPath: string, status: Exclude<PrdStatus, 'draft'>): string {
  return join(projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR, STATUS_DIRS[status]);
}

/**
 * Canonical lowercase subdirectory path. Always use this for NEW writes.
 * Does not check existence — callers create the directory as needed.
 */
export function canonicalPrdSubdirSync(
  projectPath: string,
  issueId: string,
  status: Exclude<PrdStatus, 'draft'>,
): string {
  return join(statusRoot(projectPath, status), issueId.toLowerCase());
}

/**
 * Find an existing PRD for an issue under a single lifecycle status.
 * Checks all four legacy/buggy formats, preferring canonical.
 */
export function findPrdAtStatusSync(
  projectPath: string,
  issueId: string,
  status: Exclude<PrdStatus, 'draft'>,
): PrdLocation | null {
  const root = statusRoot(projectPath, status);
  const lower = issueId.toLowerCase();
  const upper = issueId.toUpperCase();

  const candidates: PrdLocation[] = [
    { path: join(root, lower),              format: 'subdir', status },
    { path: join(root, upper),              format: 'subdir', status },
    { path: join(root, `${lower}-plan.md`), format: 'flat',   status },
    { path: join(root, `${upper}-plan.md`), format: 'flat',   status },
  ];

  for (const c of candidates) {
    if (existsSync(c.path)) return c;
  }
  return null;
}

export function findDraftPrdSync(projectPath: string, issueId: string): PrdLocation | null {
  const path = getIssueDraftPath(projectPath, issueId)
  if (!existsSync(path)) return null
  return {
    path,
    format: 'pan-draft',
    status: 'draft',
  }
}

/**
 * Find a PRD across all lifecycle statuses, in priority order:
 * active → completed → planned → draft. Returns the first match or null.
 */
export function findPrdAnywhereSync(
  projectPath: string,
  issueId: string,
): PrdLocation | null {
  for (const status of ['active', 'completed', 'planned'] as const) {
    const loc = findPrdAtStatusSync(projectPath, issueId, status);
    if (loc) return loc;
  }
  return findDraftPrdSync(projectPath, issueId)
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// All helpers in this module are pure path computation + existsSync stat — no
// real I/O failure modes. Effect.sync wrappers preserve the synchronous nature.

/** Effect variant of {@link canonicalPrdSubdirSync}. */
export const canonicalPrdSubdir = (
  projectPath: string,
  issueId: string,
  status: Exclude<PrdStatus, 'draft'>,
): Effect.Effect<string, never> =>
  Effect.sync(() => canonicalPrdSubdirSync(projectPath, issueId, status));

/** Effect variant of {@link findPrdAtStatusSync}. */
export const findPrdAtStatus = (
  projectPath: string,
  issueId: string,
  status: Exclude<PrdStatus, 'draft'>,
): Effect.Effect<PrdLocation | null, never> =>
  Effect.sync(() => findPrdAtStatusSync(projectPath, issueId, status));

/** Effect variant of {@link findDraftPrdSync}. */
export const findDraftPrd = (
  projectPath: string,
  issueId: string,
): Effect.Effect<PrdLocation | null, never> =>
  Effect.sync(() => findDraftPrdSync(projectPath, issueId));

/** Effect variant of {@link findPrdAnywhereSync}. */
export const findPrdAnywhere = (
  projectPath: string,
  issueId: string,
): Effect.Effect<PrdLocation | null, never> =>
  Effect.sync(() => findPrdAnywhereSync(projectPath, issueId));
