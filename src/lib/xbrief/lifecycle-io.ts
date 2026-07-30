/**
 * xBRIEF Lifecycle IO
 *
 * Canonical scope specs and project-side continue files live in `specs/` and
 * `continues/` on `overdeck-state`. Legacy `vbrief/<lifecycle>/` directories
 * remain a read-only fallback for legacy spec files.
 */

import { basename, join } from 'path';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { Effect } from 'effect';
import { PAN_DIRNAME, PAN_SPEC_FILENAME } from '../pan-dir/index.js';

import type { ContinueFeedbackEntry, ContinueSessionEntry, ContinueState } from './continue-state.js';
import {
  LEGACY_VBRIEF_FILENAME_SUFFIX,
  LEGACY_VBRIEF_LIFECYCLE_DIRS,
  XBRIEF_FILENAME_SUFFIX,
  ensureXBriefDirsSync,
  generateXBriefFilename,
  parseXBriefFilename,
  resolveXBriefDir,
  slugify,
  type XBriefLifecycleDir,
} from './lifecycle.js';
import { normalizeXBriefEnvelope, readPlanSync, serializeXBriefDocument } from './io.js';
import { invalidateXBriefIndex } from './xbrief-index.js';
import type { XBriefDocument } from './types.js';
import { getProjectPanPaths, updateSpecStatus } from '../pan-dir/specs.js';
import type { PanSpecDocument, PanSpecEntry, PanSpecStatus } from '../pan-dir/types.js';
import {
  appendFeedbackEntrySync as appendFeedbackEntryToRecord,
  appendSessionEntrySync as appendSessionEntryToRecord,
  clearRecordFeedbackSync,
  readRecordContinueViewSync,
} from '../pan-dir/record.js';
import type { ProjectConfig } from '../projects.js';
import { FsError } from '../errors.js';
import { flushAutoCommits, queueAutoCommit } from '../pan-dir/auto-commit.js';

// PAN-1249: pan-dir/specs.ts migrated `findSpecByIssue`, `writeSpecForIssue`,
// and `updateSpecStatus` to return Effects. The sync surface in this module
// (CLI scope.ts, cloister review-context.ts) cannot easily move to Effect, so
// we provide local synchronous mirrors that read/write the same on-disk
// `.pan/specs/` files via sync FS. Async lifecycle entry points unwrap the
// Effect-based pan-dir API via Effect.runPromise.

function readSpecFileSync(path: string): PanSpecDocument | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = normalizeXBriefEnvelope(JSON.parse(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed as PanSpecDocument;
}

function updateSpecStatusSync(
  projectRoot: string,
  issueId: string,
  newStatus: PanSpecStatus,
): PanSpecEntry | null {
  const existing = findSpecByIssueSync(projectRoot, issueId);
  if (!existing) return null;
  if (existing.status === newStatus) return existing;
  const nextDocument: PanSpecDocument = { ...existing.document, status: newStatus };
  const tmp = `${existing.path}.tmp`;
  writeFileSync(tmp, serializeXBriefDocument(nextDocument), 'utf-8');
  renameSync(tmp, existing.path);
  invalidateXBriefIndex(projectRoot);
  return { ...existing, status: newStatus, document: nextDocument };
}

function writeSpecForIssueSync(
  projectRoot: string,
  doc: XBriefDocument,
  status: PanSpecStatus,
  filename?: string,
): PanSpecEntry {
  const { specsDir } = getProjectPanPaths(projectRoot);
  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
  }
  const specDocument: PanSpecDocument = { ...(doc as object), status } as PanSpecDocument;
  const nextFilename = filename ?? generateXBriefFilename(doc.plan.id, doc.plan.title);
  const path = join(specsDir, nextFilename);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, serializeXBriefDocument(specDocument), 'utf-8');
  renameSync(tmp, path);
  invalidateXBriefIndex(projectRoot);
  const parts = parseXBriefFilename(nextFilename);
  return {
    path,
    filename: nextFilename,
    issueId: doc.plan.id,
    slug: parts?.slug ?? slugify(doc.plan.title),
    date: parts?.date ?? new Date().toISOString().slice(0, 10),
    status,
    document: specDocument,
  };
}

function findSpecByIssueSync(projectRoot: string, issueId: string): PanSpecEntry | null {
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
    if (parts.issueId.toUpperCase() !== upperIssueId) continue;
    const path = join(specsDir, filename);
    const document = readSpecFileSync(path);
    if (!document) continue;
    const status = (document.status ?? 'proposed') as PanSpecStatus;
    return {
      path,
      filename,
      issueId: parts.issueId,
      slug: parts.slug,
      date: parts.date,
      status,
      document: { ...document, status } as PanSpecDocument,
    };
  }
  return null;
}

export interface FoundXBrief {
  path: string;
  lifecycleDir: XBriefLifecycleDir;
  document: XBriefDocument;
  issueId: string;
  slug: string;
  date: string;
}

interface EnsurePanSpecResult {
  found: FoundXBrief;
  createdPanSpec: boolean;
  removedLegacyPath: string | null;
}

function specEntryToFound(entry: PanSpecEntry): FoundXBrief {
  return {
    path: entry.path,
    lifecycleDir: entry.status,
    document: entry.document,
    issueId: entry.issueId,
    slug: entry.slug,
    date: entry.date,
  };
}

function findLegacyXBriefByIssue(projectRoot: string, issueId: string): FoundXBrief | null {
  for (const lifecycleDir of LEGACY_VBRIEF_LIFECYCLE_DIRS) {
    const dirPath = resolveXBriefDir(projectRoot, lifecycleDir);
    if (!existsSync(dirPath)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const parts = parseXBriefFilename(entry);
      if (!parts || parts.issueId !== issueId) continue;
      const path = join(dirPath, entry);
      try {
        const document = readPlanSync(path);
        return { path, lifecycleDir, document, ...parts };
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function findXBriefByIssueSync(projectRoot: string, issueId: string): FoundXBrief | null {
  const spec = findSpecByIssueSync(projectRoot, issueId);
  if (spec) {
    return specEntryToFound(spec);
  }
  return findLegacyXBriefByIssue(projectRoot, issueId);
}

function ensurePanSpecForIssue(projectRoot: string, found: FoundXBrief): EnsurePanSpecResult {
  const existingSpec = findSpecByIssueSync(projectRoot, found.issueId);
  if (existingSpec) {
    return {
      found: specEntryToFound(existingSpec),
      createdPanSpec: false,
      removedLegacyPath: null,
    };
  }

  const migrated = writeSpecForIssueSync(
    projectRoot,
    found.document,
    found.lifecycleDir,
    basename(found.path),
  );

  unlinkSync(found.path);

  return {
    found: specEntryToFound(migrated),
    createdPanSpec: true,
    removedLegacyPath: found.path,
  };
}

export function updatePlanStatus(filePath: string, newStatus: string): void {
  const doc = readPlanSync(filePath);
  const now = new Date().toISOString();
  doc.plan.status = newStatus;
  doc.plan.sequence = (doc.plan.sequence ?? 0) + 1;
  doc.plan.updated = now;
  doc.xBRIEFInfo.updated = now;
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, serializeXBriefDocument(doc), 'utf-8');
  renameSync(tmp, filePath);
}

async function moveXBriefPromise(
  projectRoot: string,
  issueId: string,
  targetDir: XBriefLifecycleDir,
): Promise<{ from: FoundXBrief; toPath: string }> {
  const found = findXBriefByIssueSync(projectRoot, issueId);
  if (!found) {
    throw new Error(`No xBRIEF found for issue ${issueId} under ${projectRoot}`);
  }

  ensureXBriefDirsSync(projectRoot);
  const ensured = ensurePanSpecForIssue(projectRoot, found);
  const updatedSpec = updateSpecStatusSync(projectRoot, issueId, targetDir);
  if (!updatedSpec) {
    throw new Error(`Failed to update pan spec status for ${issueId}`);
  }

  const stagePaths = [updatedSpec.path];
  if (ensured.removedLegacyPath) stagePaths.push(ensured.removedLegacyPath);
  queueAutoCommit({
    projectRoot,
    paths: stagePaths,
    subject: `chore(state): move ${issueId.toUpperCase()} spec to ${targetDir}`,
  });
  const flushed = await Effect.runPromise(flushAutoCommits(projectRoot));
  if (flushed.pushed === false) {
    throw new Error(flushed.reason ?? `Spec move for ${issueId} was committed but not pushed`);
  }

  invalidateXBriefIndex(projectRoot);
  return {
    from: found,
    toPath: updatedSpec.path,
  };
}

export interface XBriefTransitionResult {
  fromDir: XBriefLifecycleDir;
  toDir: XBriefLifecycleDir;
  toPath: string;
  statusUpdated: boolean;
  committed: boolean;
  moved: boolean;
}

async function transitionXBriefOnMainPromise(
  projectRoot: string,
  issueId: string,
  targetDir: XBriefLifecycleDir,
  newStatus: string,
  commitMessage: string,
): Promise<XBriefTransitionResult> {
  const found = findXBriefByIssueSync(projectRoot, issueId);
  if (!found) {
    throw new Error(`No xBRIEF found for issue ${issueId} under ${projectRoot}`);
  }

  ensureXBriefDirsSync(projectRoot);
  const ensured = ensurePanSpecForIssue(projectRoot, found);
  const ensuredSpec = ensured.found;
  const needsMove = ensuredSpec.lifecycleDir !== targetDir;
  const needsStatus = ensuredSpec.document.plan.status !== newStatus;

  let toPath = ensuredSpec.path;
  if (needsMove) {
    const updatedSpec = updateSpecStatusSync(projectRoot, issueId, targetDir);
    if (!updatedSpec) {
      throw new Error(`Failed to update pan spec lifecycle status for ${issueId}`);
    }
    toPath = updatedSpec.path;
  }

  if (needsStatus) {
    updatePlanStatus(toPath, newStatus);
  }

  const changed = ensured.createdPanSpec || needsMove || needsStatus;

  let committed = false;
  if (changed) {
    const stageList: string[] = [toPath];
    if (ensured.removedLegacyPath) stageList.push(ensured.removedLegacyPath);
    queueAutoCommit({ projectRoot, paths: stageList, subject: commitMessage });
    const flushed = await Effect.runPromise(flushAutoCommits(projectRoot));
    committed = flushed.committed;
    if (flushed.pushed === false) {
      throw new Error(flushed.reason ?? `Spec transition for ${issueId} was committed but not pushed`);
    }
  }

  if (changed) {
    invalidateXBriefIndex(projectRoot);
  }

  return {
    fromDir: found.lifecycleDir,
    toDir: targetDir,
    toPath,
    statusUpdated: needsStatus,
    committed,
    moved: needsMove,
  };
}

export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export interface PromotedXBrief {
  destXBrief: string;
  destContinue: string | null;
  canonicalFilename: string;
}

export function promoteXBriefToProposed(
  workspacePath: string,
  projectRoot: string,
  issueId: string,
): PromotedXBrief {
  const panDir = join(workspacePath, PAN_DIRNAME);
  const sourceXBrief = join(panDir, PAN_SPEC_FILENAME);
  if (!existsSync(sourceXBrief)) {
    throw new Error(`No workspace spec found at ${join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME)}`);
  }

  const planDoc = readPlanSync(sourceXBrief);
  const upperIssueId = issueId.toUpperCase();
  const existingFilename = planDoc.plan.metadata?.canonicalFilename;
  const canonicalFilename = (existingFilename && typeof existingFilename === 'string')
    ? existingFilename.endsWith(LEGACY_VBRIEF_FILENAME_SUFFIX)
      ? `${existingFilename.slice(0, -LEGACY_VBRIEF_FILENAME_SUFFIX.length)}${XBRIEF_FILENAME_SUFFIX}`
      : existingFilename
    : generateXBriefFilename(upperIssueId, slugify(planDoc.plan.title || planDoc.plan.id || upperIssueId));

  const promoted = writeSpecForIssueSync(projectRoot, planDoc, 'proposed', canonicalFilename);

  invalidateXBriefIndex(projectRoot);
  return { destXBrief: promoted.path, destContinue: null, canonicalFilename };
}

export function readContinueStateForIssue(
  projectRoot: string,
  issueId: string,
): ContinueState | null {
  const project: ProjectConfig = { name: 'inferred', path: projectRoot };
  // Cast: RecordContinueView is a structural subset of ContinueState — callers only access feedback/decisions/etc.
  return readRecordContinueViewSync(project, issueId) as unknown as ContinueState | null;
}

export function writeContinueStateForIssue(
  _projectRoot: string,
  _issueId: string,
  _state: ContinueState,
): void {
  // PAN-1919: continue writes go to the per-issue record. No direct continue writes.
}

export function appendContinueSessionEntryForIssue(
  projectRoot: string,
  issueId: string,
  entry: Omit<ContinueSessionEntry, 'timestamp'> & { timestamp?: string },
): void {
  const project: ProjectConfig = { name: 'inferred', path: projectRoot };
  appendSessionEntryToRecord(project, issueId, {
    ...entry,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  });
}

export function appendFeedbackEntryForIssue(
  projectRoot: string,
  issueId: string,
  entry: ContinueFeedbackEntry,
): void {
  const project: ProjectConfig = { name: 'inferred', path: projectRoot };
  appendFeedbackEntryToRecord(project, issueId, entry);
}

export function clearFeedbackForIssue(
  projectRoot: string,
  issueId: string,
): void {
  const project: ProjectConfig = { name: 'inferred', path: projectRoot };
  clearRecordFeedbackSync(project, issueId);
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Effect-channel adapters around the existing sync/Promise helpers so callers
// composing xBRIEF lifecycle ops with other Effect code can stay on the
// channel. Follows the additive-variant pattern established for io.ts /
// xbrief-index.ts / auto-synthesize.ts in commit 3783c7003.

/** Effect variant of `findXBriefByIssue` — failures surface as typed errors. */
export const findXBriefByIssue = (
  projectRoot: string,
  issueId: string,
): Effect.Effect<FoundXBrief | null, FsError> =>
  Effect.try({
    try: () => findXBriefByIssueSync(projectRoot, issueId),
    catch: (cause) => new FsError({ path: projectRoot, operation: 'findXBriefByIssue', cause }),
  });

/** Effect variant of `moveXBrief`. */
export const moveXBrief = (
  projectRoot: string,
  issueId: string,
  targetDir: XBriefLifecycleDir,
): Effect.Effect<{ from: FoundXBrief; toPath: string }, FsError> =>
  Effect.tryPromise({
    try: () => moveXBriefPromise(projectRoot, issueId, targetDir),
    catch: (cause) => new FsError({ path: projectRoot, operation: 'moveXBrief', cause }),
  });

/** Effect variant of `transitionXBriefOnMain`. */
export const transitionXBriefOnMain = (
  projectRoot: string,
  issueId: string,
  targetDir: XBriefLifecycleDir,
  newStatus: string,
  commitMessage: string,
): Effect.Effect<XBriefTransitionResult, FsError> =>
  Effect.tryPromise({
    try: () => transitionXBriefOnMainPromise(projectRoot, issueId, targetDir, newStatus, commitMessage),
    catch: (cause) => new FsError({ path: projectRoot, operation: 'transitionXBriefOnMain', cause }),
  });
