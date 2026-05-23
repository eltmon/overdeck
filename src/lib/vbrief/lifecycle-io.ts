/**
 * vBRIEF Lifecycle IO
 *
 * PAN-967 finished the migration: `.pan/specs/` is the canonical store for scope
 * specs and `.pan/continues/` is the canonical store for project-side continue
 * files. Legacy `vbrief/<lifecycle>/` directories remain as read-only fallback
 * for legacy spec files only (no continue files — those are at `.pan/continues/`).
 */

import { exec, spawn } from 'child_process';
import { basename, dirname, join } from 'path';
import { promisify } from 'util';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { Effect } from 'effect';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME, PAN_SPEC_FILENAME } from '../pan-dir/index.js';

import { appendFeedbackEntrySync, appendSessionEntrySync, clearFeedbackSync, continueFilename, readContinueStateSync, writeContinueStateSync, type ContinueFeedbackEntry, type ContinueSessionEntry, type ContinueState } from './continue-state.js';
import {
  VBRIEF_LIFECYCLE_DIRS,
  ensureVBriefDirsSync,
  generateVBriefFilename,
  parseVBriefFilename,
  resolveVBriefDir,
  slugify,
  type VBriefLifecycleDir,
} from './lifecycle.js';
import { readPlanSync } from './io.js';
import { invalidateVBriefIndex } from './vbrief-index.js';
import type { VBriefDocument } from './types.js';
import { findSpecByIssue, getProjectPanPaths, updateSpecStatus, writeSpecForIssue } from '../pan-dir/specs.js';
import type { PanSpecDocument, PanSpecEntry, PanSpecStatus } from '../pan-dir/types.js';
import { getContinueFilePath, getContinuesDir } from '../pan-dir/continues.js';
import { FsError } from '../errors.js';

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
    parsed = JSON.parse(raw);
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
  writeFileSync(tmp, JSON.stringify(nextDocument, null, 2), 'utf-8');
  renameSync(tmp, existing.path);
  invalidateVBriefIndex(projectRoot);
  return { ...existing, status: newStatus, document: nextDocument };
}

function writeSpecForIssueSync(
  projectRoot: string,
  doc: VBriefDocument,
  status: PanSpecStatus,
  filename?: string,
): PanSpecEntry {
  const { specsDir } = getProjectPanPaths(projectRoot);
  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
  }
  const specDocument: PanSpecDocument = { ...(doc as object), status } as PanSpecDocument;
  const nextFilename = filename ?? generateVBriefFilename(doc.plan.id, doc.plan.title);
  const path = join(specsDir, nextFilename);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(specDocument, null, 2), 'utf-8');
  renameSync(tmp, path);
  invalidateVBriefIndex(projectRoot);
  const parts = parseVBriefFilename(nextFilename);
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
    const parts = parseVBriefFilename(filename);
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

const execAsync = promisify(exec);

export interface FoundVBrief {
  path: string;
  lifecycleDir: VBriefLifecycleDir;
  document: VBriefDocument;
  issueId: string;
  slug: string;
  date: string;
}

interface EnsurePanSpecResult {
  found: FoundVBrief;
  createdPanSpec: boolean;
  removedLegacyPath: string | null;
}

function specEntryToFound(entry: PanSpecEntry): FoundVBrief {
  return {
    path: entry.path,
    lifecycleDir: entry.status,
    document: entry.document,
    issueId: entry.issueId,
    slug: entry.slug,
    date: entry.date,
  };
}

function findLegacyVBriefByIssue(projectRoot: string, issueId: string): FoundVBrief | null {
  for (const lifecycleDir of VBRIEF_LIFECYCLE_DIRS) {
    const dirPath = resolveVBriefDir(projectRoot, lifecycleDir);
    if (!existsSync(dirPath)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const parts = parseVBriefFilename(entry);
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

export function findVBriefByIssueSync(projectRoot: string, issueId: string): FoundVBrief | null {
  const spec = findSpecByIssueSync(projectRoot, issueId);
  if (spec) {
    return specEntryToFound(spec);
  }
  return findLegacyVBriefByIssue(projectRoot, issueId);
}

function ensurePanSpecForIssue(projectRoot: string, found: FoundVBrief): EnsurePanSpecResult {
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
  doc.vBRIEFInfo.updated = now;
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tmp, filePath);
}async function moveVBriefPromise(
  projectRoot: string,
  issueId: string,
  targetDir: VBriefLifecycleDir,
): Promise<{ from: FoundVBrief; toPath: string }> {
  const found = findVBriefByIssueSync(projectRoot, issueId);
  if (!found) {
    throw new Error(`No vBRIEF found for issue ${issueId} under ${projectRoot}`);
  }

  ensureVBriefDirsSync(projectRoot);
  const ensured = ensurePanSpecForIssue(projectRoot, found);
  const updatedSpec = await Effect.runPromise(updateSpecStatus(projectRoot, issueId, targetDir));
  if (!updatedSpec) {
    throw new Error(`Failed to update pan spec status for ${issueId}`);
  }

  const stagePaths = [updatedSpec.path];
  if (ensured.removedLegacyPath) stagePaths.push(ensured.removedLegacyPath);
  await runGitAdd(projectRoot, stagePaths);

  invalidateVBriefIndex(projectRoot);
  return {
    from: found,
    toPath: updatedSpec.path,
  };
}

async function runGitAdd(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const quoted = paths.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' ');
  await execAsync(`git add -A -- ${quoted}`, { cwd });
}

export function moveVBriefFilesOnly(
  projectRoot: string,
  issueId: string,
  targetDir: VBriefLifecycleDir,
): { from: FoundVBrief; toPath: string } {
  const found = findVBriefByIssueSync(projectRoot, issueId);
  if (!found) {
    throw new Error(`No vBRIEF found for issue ${issueId} under ${projectRoot}`);
  }

  ensureVBriefDirsSync(projectRoot);
  ensurePanSpecForIssue(projectRoot, found);
  const updatedSpec = updateSpecStatusSync(projectRoot, issueId, targetDir);
  if (!updatedSpec) {
    throw new Error(`Failed to update pan spec status for ${issueId}`);
  }

  invalidateVBriefIndex(projectRoot);
  return {
    from: found,
    toPath: updatedSpec.path,
  };
}

export function deleteVBrief(projectRoot: string, issueId: string): boolean {
  const found = findVBriefByIssueSync(projectRoot, issueId);
  if (!found) return false;

  const spec = findSpecByIssueSync(projectRoot, issueId);
  if (spec) {
    unlinkSync(spec.path);
  } else {
    unlinkSync(found.path);
  }

  const continuePath = getContinueFilePath(projectRoot, issueId);
  if (existsSync(continuePath)) unlinkSync(continuePath);
  invalidateVBriefIndex(projectRoot);
  return true;
}

export interface VBriefTransitionResult {
  fromDir: VBriefLifecycleDir;
  toDir: VBriefLifecycleDir;
  toPath: string;
  statusUpdated: boolean;
  committed: boolean;
  moved: boolean;
}

async function transitionVBriefOnMainPromise(
  projectRoot: string,
  issueId: string,
  targetDir: VBriefLifecycleDir,
  newStatus: string,
  commitMessage: string,
): Promise<VBriefTransitionResult> {
  const found = findVBriefByIssueSync(projectRoot, issueId);
  if (!found) {
    throw new Error(`No vBRIEF found for issue ${issueId} under ${projectRoot}`);
  }

  ensureVBriefDirsSync(projectRoot);
  const ensured = ensurePanSpecForIssue(projectRoot, found);
  const ensuredSpec = ensured.found;
  const needsMove = ensuredSpec.lifecycleDir !== targetDir;
  const needsStatus = ensuredSpec.document.plan.status !== newStatus;

  let toPath = ensuredSpec.path;
  if (needsMove) {
    const updatedSpec = await Effect.runPromise(updateSpecStatus(projectRoot, issueId, targetDir));
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
    try {
      const { stdout: branchStdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
      const currentBranch = branchStdout.trim();
      if (currentBranch === 'main') {
        const stageList: string[] = [toPath];
        if (ensured.removedLegacyPath) stageList.push(ensured.removedLegacyPath);
        await runGitAdd(projectRoot, stageList);

        const quotedAll = stageList
          .map(p => `"${p.replace(/"/g, '\\"')}"`)
          .join(' ');
        try {
          await execAsync(`git diff --cached --quiet -- ${quotedAll}`, {
            cwd: projectRoot,
            encoding: 'utf-8',
          });
        } catch {
          await execAsync(
            `git commit -m ${JSON.stringify(commitMessage)} -- ${quotedAll}`,
            { cwd: projectRoot, encoding: 'utf-8' },
          );
          committed = true;
          try {
            const { stdout: remotes } = await execAsync('git remote', {
              cwd: projectRoot,
              encoding: 'utf-8',
            });
            if (remotes.trim()) {
              const pushChild = spawn('git', ['push'], {
                cwd: projectRoot,
                detached: true,
                stdio: 'ignore',
              });
              pushChild.unref();
            }
          } catch {
            /* push setup failed — non-fatal */
          }
        }
      }
    } catch {
      /* leave on-disk state in place without surfacing git errors */
    }
  }

  if (changed) {
    invalidateVBriefIndex(projectRoot);
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

export interface PromotedVBrief {
  destVBrief: string;
  destContinue: string | null;
  canonicalFilename: string;
}

export function promoteVBriefToProposed(
  workspacePath: string,
  projectRoot: string,
  issueId: string,
): PromotedVBrief {
  const panDir = join(workspacePath, PAN_DIRNAME);
  const sourceVBrief = join(panDir, PAN_SPEC_FILENAME);
  if (!existsSync(sourceVBrief)) {
    throw new Error(`No workspace spec found at ${join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME)}`);
  }

  const planDoc = readPlanSync(sourceVBrief);
  const upperIssueId = issueId.toUpperCase();
  const existingFilename = planDoc.plan.metadata?.canonicalFilename;
  const canonicalFilename = (existingFilename && typeof existingFilename === 'string')
    ? existingFilename
    : generateVBriefFilename(upperIssueId, slugify(planDoc.plan.title || planDoc.plan.id || upperIssueId));

  const promoted = writeSpecForIssueSync(projectRoot, planDoc, 'proposed', canonicalFilename);

  const sourceContinue = join(panDir, PAN_CONTINUE_FILENAME);
  let destContinue: string | null = null;
  if (existsSync(sourceContinue)) {
    destContinue = getContinueFilePath(projectRoot, upperIssueId);
    mkdirSync(dirname(destContinue), { recursive: true });
    copyFileSync(sourceContinue, destContinue);
  }

  invalidateVBriefIndex(projectRoot);
  return { destVBrief: promoted.path, destContinue, canonicalFilename };
}

export function resolveContinueStateDir(projectRoot: string, _issueId: string): string {
  return getContinuesDir(projectRoot);
}

export function readContinueStateForIssue(
  projectRoot: string,
  issueId: string,
): ContinueState | null {
  try {
    return readContinueStateSync(projectRoot, issueId);
  } catch {
    return null;
  }
}

export function writeContinueStateForIssue(
  projectRoot: string,
  issueId: string,
  state: ContinueState,
): void {
  writeContinueStateSync(projectRoot, issueId, state);
}

export function appendContinueSessionEntryForIssue(
  projectRoot: string,
  issueId: string,
  entry: Omit<ContinueSessionEntry, 'timestamp'> & { timestamp?: string },
): ContinueState {
  return appendSessionEntrySync(projectRoot, issueId, entry);
}

export function appendFeedbackEntryForIssue(
  projectRoot: string,
  issueId: string,
  entry: ContinueFeedbackEntry,
): ContinueState {
  return appendFeedbackEntrySync(projectRoot, issueId, entry);
}

export function clearFeedbackForIssue(
  projectRoot: string,
  issueId: string,
): ContinueState | null {
  return clearFeedbackSync(projectRoot, issueId);
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Effect-channel adapters around the existing sync/Promise helpers so callers
// composing vBRIEF lifecycle ops with other Effect code can stay on the
// channel. Follows the additive-variant pattern established for io.ts /
// vbrief-index.ts / auto-synthesize.ts in commit 3783c7003.

/** Effect variant of `findVBriefByIssue` — failures surface as typed errors. */
export const findVBriefByIssue = (
  projectRoot: string,
  issueId: string,
): Effect.Effect<FoundVBrief | null, FsError> =>
  Effect.try({
    try: () => findVBriefByIssueSync(projectRoot, issueId),
    catch: (cause) => new FsError({ path: projectRoot, operation: 'findVBriefByIssue', cause }),
  });

/** Effect variant of `moveVBrief`. */
export const moveVBrief = (
  projectRoot: string,
  issueId: string,
  targetDir: VBriefLifecycleDir,
): Effect.Effect<{ from: FoundVBrief; toPath: string }, FsError> =>
  Effect.tryPromise({
    try: () => moveVBriefPromise(projectRoot, issueId, targetDir),
    catch: (cause) => new FsError({ path: projectRoot, operation: 'moveVBrief', cause }),
  });

/** Effect variant of `transitionVBriefOnMain`. */
export const transitionVBriefOnMain = (
  projectRoot: string,
  issueId: string,
  targetDir: VBriefLifecycleDir,
  newStatus: string,
  commitMessage: string,
): Effect.Effect<VBriefTransitionResult, FsError> =>
  Effect.tryPromise({
    try: () => transitionVBriefOnMainPromise(projectRoot, issueId, targetDir, newStatus, commitMessage),
    catch: (cause) => new FsError({ path: projectRoot, operation: 'transitionVBriefOnMain', cause }),
  });
