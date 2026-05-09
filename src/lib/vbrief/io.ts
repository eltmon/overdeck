/**
 * vBRIEF File I/O Utilities
 *
 * Read and write workspace vBRIEF plans from `.pan/spec.vbrief.json`.
 *
 * IMPORTANT (PAN-946): Workspace mutations MUST NEVER reach into project-level
 * lifecycle directories. `findPlan`, `readWorkspacePlan`, `updateItemStatus`,
 * and `updateSubItemStatus` resolve only the workspace-local spec file.
 * Lifecycle (proposed/active/completed/cancelled) lookups go through
 * `findVBriefByIssue` in `lifecycle-io.ts` (read-only) or
 * `findVBriefByIssueAsync` in `vbrief-index.ts` (read-only, indexed).
 *
 * Conflating the two surfaces caused a high-severity correctness bug where
 * routine workspace progress updates (item status writes, beads sync) could
 * mutate `vbrief/active`, `vbrief/completed`, or `vbrief/cancelled` files
 * after lifecycle promotion — corrupting the archived plan.
 */

import { constants, existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { lstat, mkdir, open, readdir, realpath, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import {
  PROJECT_DOCS_SUBDIR,
  PROJECT_PRDS_ACTIVE_SUBDIR,
  PROJECT_PRDS_PLANNED_SUBDIR,
  PROJECT_PRDS_SUBDIR,
} from '../paths.js';
import { PAN_DIRNAME, PAN_SPEC_FILENAME } from '../pan-dir/types.js';
import type { VBriefDocument, VBriefItemStatus } from './types.js';

/**
 * Returns the path to the workspace-local spec file if it exists, or null.
 * **Workspace-only.** Does NOT scan lifecycle directories — lifecycle/discovery
 * lookups belong in `findVBriefByIssue` / `findVBriefByIssueAsync`.
 */
export function findPlan(workspacePath: string): string | null {
  const panPlanPath = join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME);
  return existsSync(panPlanPath) ? panPlanPath : null;
}

const PRD_VBRIEF_STATUS_DIRS = [PROJECT_PRDS_ACTIVE_SUBDIR, PROJECT_PRDS_PLANNED_SUBDIR] as const;
const PRD_VBRIEF_ROOTS = [
  [PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR],
  ['api', PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR],
] as const;
const ISSUE_ID_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/i;

interface PrdVBriefCandidate {
  sourcePath: string;
  rootRealPath: string;
}

function assertValidIssueId(issueId: string): void {
  if (!ISSUE_ID_PATTERN.test(issueId)) {
    throw new Error(
      `Invalid issue ID "${issueId}": expected PREFIX-123 format with letters, numbers, and a single hyphen.`,
    );
  }
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath));
}

async function getPrdRootRealPath(root: string): Promise<string | null> {
  try {
    const stats = await lstat(root);
    if (stats.isSymbolicLink()) {
      throw new Error(`PRD vBRIEF root is a symlink and will not be scanned: ${root}`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`PRD vBRIEF root is not a directory: ${root}`);
    }
    return await realpath(root);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

async function checkedPrdVBriefFile(sourcePath: string, rootRealPath: string): Promise<string | null> {
  let stats;
  try {
    stats = await lstat(sourcePath);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to import PRD vBRIEF symlink: ${sourcePath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Refusing to import non-regular PRD vBRIEF file: ${sourcePath}`);
  }

  const sourceRealPath = await realpath(sourcePath);
  if (!isPathInside(rootRealPath, sourceRealPath)) {
    throw new Error(`Refusing to import PRD vBRIEF outside PRD root: ${sourcePath}`);
  }

  return sourcePath;
}

async function findPrdVBriefCandidate(projectRoot: string, issueId: string): Promise<PrdVBriefCandidate | null> {
  assertValidIssueId(issueId);

  const issueIdLower = issueId.toLowerCase();
  const issueIdUpper = issueId.toUpperCase();

  for (const prdRoot of PRD_VBRIEF_ROOTS) {
    for (const statusDir of PRD_VBRIEF_STATUS_DIRS) {
      const root = resolve(projectRoot, ...prdRoot, statusDir);
      const rootRealPath = await getPrdRootRealPath(root);
      if (!rootRealPath) continue;

      const exactCandidates = [
        join(root, `${issueIdUpper}-plan.vbrief.json`),
        join(root, `${issueIdLower}-plan.vbrief.json`),
        join(root, issueIdLower, 'plan.vbrief.json'),
        join(root, issueIdUpper, 'plan.vbrief.json'),
      ];

      for (const sourcePath of exactCandidates) {
        const checked = await checkedPrdVBriefFile(sourcePath, rootRealPath);
        if (checked) return { sourcePath: checked, rootRealPath };
      }

      const entries = await readdir(root, { withFileTypes: true });
      const slugPrefix = `${issueIdLower}-`;
      const slugMatches = entries
        .map(entry => entry.name)
        .filter(name => {
          const lowerName = name.toLowerCase();
          return lowerName.startsWith(slugPrefix) && lowerName.endsWith('.vbrief.json');
        })
        .sort((a, b) => a.localeCompare(b));

      for (const name of slugMatches) {
        const sourcePath = join(root, name);
        const checked = await checkedPrdVBriefFile(sourcePath, rootRealPath);
        if (checked) return { sourcePath: checked, rootRealPath };
      }
    }
  }

  return null;
}

/**
 * Returns a PRD-scoped vBRIEF path for an issue when the workspace-local
 * `.pan/spec.vbrief.json` has not been materialized yet.
 *
 * Supports both legacy flat files (`docs/prds/active/PAN-123-plan.vbrief.json`),
 * slugged flat files (`docs/prds/active/PAN-123-my-feature.vbrief.json`),
 * and canonical subdirectory files (`docs/prds/active/pan-123/plan.vbrief.json`),
 * including the historical uppercase-directory variant and the `api/docs/prds/*`
 * mirror used by some projects.
 */
export async function findVBriefInPrdDirs(projectRoot: string, issueId: string): Promise<string | null> {
  const candidate = await findPrdVBriefCandidate(projectRoot, issueId);
  return candidate?.sourcePath ?? null;
}

export interface ImportedPrdVBrief {
  sourcePath: string;
  workspacePlanPath: string;
}

async function readCheckedPrdVBrief(candidate: PrdVBriefCandidate): Promise<VBriefDocument> {
  const handle = await open(candidate.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new Error(`Refusing to import non-regular PRD vBRIEF file: ${candidate.sourcePath}`);
    }

    const sourceRealPath = await realpath(candidate.sourcePath);
    if (!isPathInside(candidate.rootRealPath, sourceRealPath)) {
      throw new Error(`Refusing to import PRD vBRIEF outside PRD root: ${candidate.sourcePath}`);
    }

    const raw = await handle.readFile({ encoding: 'utf-8' });
    return parseVBriefDocument(raw, candidate.sourcePath);
  } finally {
    await handle.close();
  }
}

/**
 * Copies a matching PRD-scoped vBRIEF into the workspace-local plan location
 * when `.pan/spec.vbrief.json` has not been materialized yet.
 *
 * Returns null when the workspace already has a plan or no PRD vBRIEF exists.
 */
export async function importVBriefFromPrdDirs(
  projectRoot: string,
  workspacePath: string,
  issueId: string,
): Promise<ImportedPrdVBrief | null> {
  if (findPlan(workspacePath)) return null;

  const candidate = await findPrdVBriefCandidate(projectRoot, issueId);
  if (!candidate) return null;

  const document = await readCheckedPrdVBrief(candidate);
  const planIssueId = typeof document.plan?.id === 'string' ? document.plan.id : null;
  if (planIssueId && planIssueId.toLowerCase() !== issueId.toLowerCase()) {
    throw new Error(
      `PRD vBRIEF ${candidate.sourcePath} is for ${planIssueId.toUpperCase()}, not ${issueId.toUpperCase()}.`,
    );
  }

  const workspacePlanPath = join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME);
  await mkdir(dirname(workspacePlanPath), { recursive: true });
  if (findPlan(workspacePath)) return null;
  await writeFile(workspacePlanPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' });

  return { sourcePath: candidate.sourcePath, workspacePlanPath };
}

/**
 * Reads and parses plan.vbrief.json from the given path.
 * Accepts the vBRIEF v0.5 document shape ({ vBRIEFInfo, plan: {...} }).
 * Throws if the file does not exist, contains invalid JSON, or does not match
 * the required top-level vBRIEF shape.
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

export function parseVBriefDocument(raw: string, planPath: string): VBriefDocument {
  if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
    throw new VBriefMergeConflictError(planPath);
  }
  const parsed = JSON.parse(raw);

  // vBRIEF v0.5 requires exactly two top-level keys: vBRIEFInfo and plan
  if (
    parsed &&
    typeof parsed === 'object' &&
    parsed.vBRIEFInfo &&
    typeof parsed.vBRIEFInfo === 'object' &&
    parsed.plan &&
    typeof parsed.plan === 'object'
  ) {
    return parsed as VBriefDocument;
  }

  // Non-spec format — reject with helpful error
  throw new Error(
    `Invalid vBRIEF format in ${planPath}: missing 'vBRIEFInfo' and/or 'plan' top-level keys. ` +
    `vBRIEF v0.5 requires exactly { "vBRIEFInfo": { "version": "0.5" }, "plan": { ... } }. ` +
    `See docs/VBRIEF.md for the correct format.`
  );
}

export function readPlan(planPath: string): VBriefDocument {
  return parseVBriefDocument(readFileSync(planPath, 'utf-8'), planPath);
}

/**
 * Reads plan.vbrief.json from a workspace directory.
 * Returns null if no plan exists.
 */
export function readWorkspacePlan(workspacePath: string): VBriefDocument | null {
  const planPath = findPlan(workspacePath);
  if (!planPath) return null;
  return readPlan(planPath);
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
 *
 * Pass either a workspace root (helper looks in `<root>/.pan/`) or a direct
 * `.pan/` directory path via `planningDir`.
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
 *
 * Pass either a workspace root (helper looks in `<root>/.pan/`) or a direct
 * `.pan/` directory path via `planningDir`.
 */
export function isPlanningComplete(workspacePath: string, planningDir?: string): boolean {
  return checkPlanStatus(workspacePath, planningDir, status => PLANNING_FINISHED_STATUSES.has(status));
}

function checkPlanStatus(
  workspacePath: string,
  planningDir: string | undefined,
  matchStatus: (status: string) => boolean,
): boolean {
  const candidatePlanPaths = planningDir
    ? [join(planningDir, PAN_SPEC_FILENAME)]
    : [join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME)];

  for (const planPath of candidatePlanPaths) {
    if (!existsSync(planPath)) continue;
    try {
      const doc = readPlan(planPath);
      const status = doc.plan?.status;
      if (status && matchStatus(status)) return true;
      if (status) return false;
    } catch {
      // Corrupt / unreadable plan — keep checking fallbacks.
    }
  }

  return false;
}


/**
 * Updates the status of a specific item in plan.vbrief.json.
 * Uses a write-to-temp-then-rename pattern to minimize race conditions.
 * No-ops gracefully if the file or item doesn't exist.
 */
export function updateItemStatus(workspacePath: string, itemId: string, status: VBriefItemStatus): void {
  const planPath = findPlan(workspacePath);
  if (!planPath) return;

  const doc = readPlan(planPath);
  const item = doc.plan.items.find(i => i.id === itemId);
  if (!item) return;

  const now = new Date().toISOString();
  item.status = status;
  if (status === 'completed') {
    item.completed = now;
  }

  // Update timestamps and increment sequence counter
  doc.vBRIEFInfo.updated = now;
  doc.plan.updated = now;
  doc.plan.sequence = (doc.plan.sequence ?? 0) + 1;

  // Atomic rename: write to .tmp then rename to avoid partial reads
  const tempPath = planPath + '.tmp';
  writeFileSync(tempPath, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tempPath, planPath);
}

/**
 * Updates the status of a specific subItem within an item in plan.vbrief.json.
 * Uses write-to-temp-then-rename pattern for atomicity.
 * No-ops gracefully if the file, item, or subItem doesn't exist.
 */
export function updateSubItemStatus(
  workspacePath: string,
  itemId: string,
  subItemId: string,
  status: VBriefItemStatus,
): void {
  const planPath = findPlan(workspacePath);
  if (!planPath) return;

  const doc = readPlan(planPath);
  const item = doc.plan.items.find(i => i.id === itemId);
  if (!item?.subItems) return;

  const subItem = item.subItems.find(s => s.id === subItemId);
  if (!subItem) return;

  const now = new Date().toISOString();
  subItem.status = status;
  if (status === 'completed') {
    subItem.completed = now;
  }

  // Update timestamps and increment sequence counter
  doc.vBRIEFInfo.updated = now;
  doc.plan.updated = now;
  doc.plan.sequence = (doc.plan.sequence ?? 0) + 1;

  const tempPath = planPath + '.tmp';
  writeFileSync(tempPath, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tempPath, planPath);
}
