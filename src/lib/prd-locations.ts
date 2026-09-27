/**
 * PRD location resolution — single source of truth.
 *
 * PRDs have historically been written in four formats due to a casing bug:
 *   1. docs/prds/<status>/<id-lower>/        — canonical subdirectory (new)
 *   2. docs/prds/<status>/<ID-UPPER>/        — buggy uppercase variant
 *   3. docs/prds/<status>/<id-lower>-plan.md — legacy flat file
 *   4. docs/prds/<status>/<ID-UPPER>-plan.md — buggy uppercase flat file
 *
 * All readers MUST go through findPrdAtStatusSync / findPrdAnywhereSync so they tolerate
 * every variant. All writers MUST use canonicalPrdSubdirSync so new artifacts only
 * land in the canonical lowercase subdirectory format.
 */

/**
 * Sync twins (PAN-3958). Each `…Sync` function below has an async twin and exists only because
 * these callers run in synchronous contexts (sync functions, sync callbacks, or dependency slots typed
 * as sync) and cannot await:
 * - `findDraftPrdSync` (async: `findDraftPrd`): src/lib/prd-locations.ts:153.
 * Do not add new synchronous callers; server-reachable code uses the async variants.
 */

import { existsSync } from 'fs';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'path';
import {
  PROJECT_DOCS_SUBDIR,
  PROJECT_PRDS_SUBDIR,
  PROJECT_PRDS_ACTIVE_SUBDIR,
  PROJECT_PRDS_PLANNED_SUBDIR,
  PROJECT_PRDS_COMPLETED_SUBDIR,
} from './paths.js';
import { getDraftPath, getIssueDraftPath } from './pan-dir/index.js';

export type PrdStatus = 'active' | 'planned' | 'completed' | 'draft';
export type PrdFormat = 'subdir' | 'flat' | 'pan-draft';

export interface PrdLocation {
  /** Absolute path to either the per-issue subdirectory or the flat .md file. */
  path: string;
  format: PrdFormat;
  status: PrdStatus;
}

/** Read Markdown from any location returned by this module's PRD resolvers. */
export async function readPrdContent(loc: PrdLocation): Promise<string | null> {
  if (loc.format === 'flat' || loc.format === 'pan-draft') {
    return readFile(loc.path, 'utf8').catch(() => null);
  }

  const files = (await readdir(loc.path).catch(() => [] as string[]))
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => {
      if (a === 'prd.md') return -1;
      if (b === 'prd.md') return 1;
      return a.localeCompare(b);
    });
  const firstMarkdown = files[0];
  if (!firstMarkdown) return null;
  return readFile(join(loc.path, firstMarkdown), 'utf8').catch(() => null);
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
export function canonicalPrdSubdir(
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
export function findPrdAtStatus(
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

/**
 * Workspace candidates first, when a `workspacePath` is given: complete-planning
 * now promotes the PRD draft onto the issue's own workspace plan home rather
 * than the primary checkout (PAN-4224), so a draft written there is the
 * freshest copy and must win over a stale or not-yet-synced primary one.
 *
 * Canonical drafts exist in both filename cases on disk (the door writes
 * UPPER.md; humans and conversations historically wrote lower.md) — accept
 * either, matching checkPrdGateSync.
 */
function draftPrdCandidates(projectPath: string, issueId: string, workspacePath?: string | null): PrdLocation[] {
  const candidatesFor = (root: string): PrdLocation[] => [
    { path: getIssueDraftPath(root, issueId), format: 'pan-draft', status: 'draft' },
    { path: getDraftPath(root, `${issueId.toLowerCase()}.md`), format: 'pan-draft', status: 'draft' },
  ];
  return [...(workspacePath ? candidatesFor(workspacePath) : []), ...candidatesFor(projectPath)];
}

export function findDraftPrdSync(projectPath: string, issueId: string, workspacePath?: string | null): PrdLocation | null {
  for (const candidate of draftPrdCandidates(projectPath, issueId, workspacePath)) {
    if (existsSync(candidate.path)) return candidate;
  }
  return null;
}

/**
 * Find an issue's draft PRD, or null. Checks the issue's workspace plan home
 * (when `workspacePath` is given) before the project's `.pan/drafts/`.
 */
export async function findDraftPrd(projectPath: string, issueId: string, workspacePath?: string | null): Promise<PrdLocation | null> {
  for (const candidate of draftPrdCandidates(projectPath, issueId, workspacePath)) {
    try {
      await access(candidate.path);
      return candidate;
    } catch {
      // Try the next candidate before reporting no draft.
    }
  }
  return null;
}

/**
 * Find a PRD across all lifecycle statuses, in priority order:
 * active → completed → planned → draft. Returns the first match or null.
 * `workspacePath`, when given, is checked before the project path within the
 * draft tier (PAN-4224).
 */
export function findPrdAnywhere(
  projectPath: string,
  issueId: string,
  workspacePath?: string | null,
): PrdLocation | null {
  for (const status of ['active', 'completed', 'planned'] as const) {
    const loc = findPrdAtStatus(projectPath, issueId, status);
    if (loc) return loc;
  }
  return findDraftPrdSync(projectPath, issueId, workspacePath)
}
