/**
 * vBRIEF Lifecycle IO
 *
 * Phase 2 of PAN-967 makes `.pan/specs/` the canonical store for scope specs.
 * Legacy `vbrief/<lifecycle>/` directories remain as read fallbacks during the
 * transition, and continue files still live beside the legacy lifecycle state
 * until the later continue-state migration phase.
 */

import { exec, spawn } from 'child_process';
import { basename, join } from 'path';
import { promisify } from 'util';
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME, PAN_SPEC_FILENAME } from '../pan-dir/index.js';

import { appendFeedbackEntry, appendSessionEntry, clearFeedback, continueFilePath, continueFilename, readContinueState, writeContinueState, type ContinueFeedbackEntry, type ContinueSessionEntry, type ContinueState } from './continue-state.js';
import {
  VBRIEF_LIFECYCLE_DIRS,
  ensureVBriefDirs,
  generateVBriefFilename,
  parseVBriefFilename,
  resolveVBriefDir,
  slugify,
  type VBriefLifecycleDir,
} from './lifecycle.js';
import { readPlan } from './io.js';
import { invalidateVBriefIndex } from './vbrief-index.js';
import type { VBriefDocument } from './types.js';
import { findSpecByIssue, getProjectPanPaths, updateSpecStatus, writeSpecForIssue } from '../pan-dir/specs.js';

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

function specEntryToFound(entry: ReturnType<typeof findSpecByIssue> extends infer T ? Exclude<T, null> : never): FoundVBrief {
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
        const document = readPlan(path);
        return { path, lifecycleDir, document, ...parts };
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function findVBriefByIssue(projectRoot: string, issueId: string): FoundVBrief | null {
  const spec = findSpecByIssue(projectRoot, issueId);
  if (spec) {
    return specEntryToFound(spec);
  }
  return findLegacyVBriefByIssue(projectRoot, issueId);
}

function ensurePanSpecForIssue(projectRoot: string, found: FoundVBrief): EnsurePanSpecResult {
  const existingSpec = findSpecByIssue(projectRoot, found.issueId);
  if (existingSpec) {
    return {
      found: specEntryToFound(existingSpec),
      createdPanSpec: false,
      removedLegacyPath: null,
    };
  }

  const migrated = writeSpecForIssue(
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

function moveContinueFile(
  projectRoot: string,
  issueId: string,
  fromDir: VBriefLifecycleDir,
  toDir: VBriefLifecycleDir,
): { movedContinue: boolean; fromPath: string | null; toPath: string | null } {
  const fromContinuePath = continueFilePath(resolveVBriefDir(projectRoot, fromDir), issueId);
  const toContinuePath = continueFilePath(resolveVBriefDir(projectRoot, toDir), issueId);

  if (fromContinuePath === toContinuePath) {
    return {
      movedContinue: existsSync(toContinuePath),
      fromPath: null,
      toPath: existsSync(toContinuePath) ? toContinuePath : null,
    };
  }

  if (!existsSync(fromContinuePath)) {
    return { movedContinue: false, fromPath: null, toPath: null };
  }

  renameSync(fromContinuePath, toContinuePath);
  return {
    movedContinue: true,
    fromPath: fromContinuePath,
    toPath: toContinuePath,
  };
}

export function updatePlanStatus(filePath: string, newStatus: string): void {
  const doc = readPlan(filePath);
  const now = new Date().toISOString();
  doc.plan.status = newStatus;
  doc.plan.sequence = (doc.plan.sequence ?? 0) + 1;
  doc.plan.updated = now;
  doc.vBRIEFInfo.updated = now;
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tmp, filePath);
}

export async function moveVBrief(
  projectRoot: string,
  issueId: string,
  targetDir: VBriefLifecycleDir,
): Promise<{ from: FoundVBrief; toPath: string; movedContinue: boolean }> {
  const found = findVBriefByIssue(projectRoot, issueId);
  if (!found) {
    throw new Error(`No vBRIEF found for issue ${issueId} under ${projectRoot}`);
  }

  ensureVBriefDirs(projectRoot);
  const ensured = ensurePanSpecForIssue(projectRoot, found);
  const updatedSpec = updateSpecStatus(projectRoot, issueId, targetDir);
  if (!updatedSpec) {
    throw new Error(`Failed to update pan spec status for ${issueId}`);
  }

  const continueMove = moveContinueFile(projectRoot, issueId, found.lifecycleDir, targetDir);
  const stagePaths = [updatedSpec.path];
  if (ensured.removedLegacyPath) stagePaths.push(ensured.removedLegacyPath);
  if (continueMove.fromPath) stagePaths.push(continueMove.fromPath);
  if (continueMove.toPath) stagePaths.push(continueMove.toPath);
  await runGitAdd(projectRoot, stagePaths);

  invalidateVBriefIndex(projectRoot);
  return {
    from: found,
    toPath: updatedSpec.path,
    movedContinue: continueMove.movedContinue,
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
): { from: FoundVBrief; toPath: string; movedContinue: boolean } {
  const found = findVBriefByIssue(projectRoot, issueId);
  if (!found) {
    throw new Error(`No vBRIEF found for issue ${issueId} under ${projectRoot}`);
  }

  ensureVBriefDirs(projectRoot);
  ensurePanSpecForIssue(projectRoot, found);
  const updatedSpec = updateSpecStatus(projectRoot, issueId, targetDir);
  if (!updatedSpec) {
    throw new Error(`Failed to update pan spec status for ${issueId}`);
  }

  const continueMove = moveContinueFile(projectRoot, issueId, found.lifecycleDir, targetDir);
  invalidateVBriefIndex(projectRoot);
  return {
    from: found,
    toPath: updatedSpec.path,
    movedContinue: continueMove.movedContinue,
  };
}

export function deleteVBrief(projectRoot: string, issueId: string): boolean {
  const found = findVBriefByIssue(projectRoot, issueId);
  if (!found) return false;

  const spec = findSpecByIssue(projectRoot, issueId);
  if (spec) {
    unlinkSync(spec.path);
  } else {
    unlinkSync(found.path);
  }

  const continuePath = continueFilePath(resolveVBriefDir(projectRoot, found.lifecycleDir), issueId);
  if (existsSync(continuePath)) unlinkSync(continuePath);
  invalidateVBriefIndex(projectRoot);
  return true;
}

export interface VBriefTransitionResult {
  fromDir: VBriefLifecycleDir;
  toDir: VBriefLifecycleDir;
  toPath: string;
  movedContinue: boolean;
  statusUpdated: boolean;
  committed: boolean;
  moved: boolean;
}

export async function transitionVBriefOnMain(
  projectRoot: string,
  issueId: string,
  targetDir: VBriefLifecycleDir,
  newStatus: string,
  commitMessage: string,
): Promise<VBriefTransitionResult> {
  const found = findVBriefByIssue(projectRoot, issueId);
  if (!found) {
    throw new Error(`No vBRIEF found for issue ${issueId} under ${projectRoot}`);
  }

  ensureVBriefDirs(projectRoot);
  const ensured = ensurePanSpecForIssue(projectRoot, found);
  const ensuredSpec = ensured.found;
  const needsMove = ensuredSpec.lifecycleDir !== targetDir;
  const needsStatus = ensuredSpec.document.plan.status !== newStatus;

  let toPath = ensuredSpec.path;
  if (needsMove) {
    const updatedSpec = updateSpecStatus(projectRoot, issueId, targetDir);
    if (!updatedSpec) {
      throw new Error(`Failed to update pan spec lifecycle status for ${issueId}`);
    }
    toPath = updatedSpec.path;
  }

  if (needsStatus) {
    updatePlanStatus(toPath, newStatus);
  }

  const continueMove = moveContinueFile(projectRoot, issueId, found.lifecycleDir, targetDir);
  const changed = ensured.createdPanSpec || needsMove || needsStatus || continueMove.movedContinue;

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
        if (continueMove.toPath) stageList.push(continueMove.toPath);
        if (continueMove.fromPath) stageList.push(continueMove.fromPath);
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
    movedContinue: continueMove.movedContinue,
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

  const planDoc = readPlan(sourceVBrief);
  const upperIssueId = issueId.toUpperCase();
  const existingFilename = planDoc.plan.metadata?.canonicalFilename;
  const canonicalFilename = (existingFilename && typeof existingFilename === 'string')
    ? existingFilename
    : generateVBriefFilename(upperIssueId, slugify(planDoc.plan.title || planDoc.plan.id || upperIssueId));

  const promoted = writeSpecForIssue(projectRoot, planDoc, 'proposed', canonicalFilename);

  const continueName = continueFilename(upperIssueId);
  const sourceContinue = join(panDir, PAN_CONTINUE_FILENAME);
  let destContinue: string | null = null;
  if (existsSync(sourceContinue)) {
    ensureVBriefDirs(projectRoot);
    destContinue = join(resolveVBriefDir(projectRoot, 'proposed'), continueName);
    copyFileSync(sourceContinue, destContinue);
  }

  invalidateVBriefIndex(projectRoot);
  return { destVBrief: promoted.path, destContinue, canonicalFilename };
}

export function resolveContinueStateDir(projectRoot: string, issueId: string): string {
  const found = findVBriefByIssue(projectRoot, issueId);
  if (found) {
    return resolveVBriefDir(projectRoot, found.lifecycleDir);
  }
  return resolveVBriefDir(projectRoot, 'active');
}

export function readContinueStateForIssue(
  projectRoot: string,
  issueId: string,
): ContinueState | null {
  try {
    const dir = resolveContinueStateDir(projectRoot, issueId);
    return readContinueState(dir, issueId);
  } catch {
    return null;
  }
}

export function writeContinueStateForIssue(
  projectRoot: string,
  issueId: string,
  state: ContinueState,
): void {
  const dir = resolveContinueStateDir(projectRoot, issueId);
  writeContinueState(dir, issueId, state);
}

export function appendContinueSessionEntryForIssue(
  projectRoot: string,
  issueId: string,
  entry: Omit<ContinueSessionEntry, 'timestamp'> & { timestamp?: string },
): ContinueState {
  const dir = resolveContinueStateDir(projectRoot, issueId);
  return appendSessionEntry(dir, issueId, entry);
}

export function appendFeedbackEntryForIssue(
  projectRoot: string,
  issueId: string,
  entry: ContinueFeedbackEntry,
): ContinueState {
  const dir = resolveContinueStateDir(projectRoot, issueId);
  return appendFeedbackEntry(dir, issueId, entry);
}

export function clearFeedbackForIssue(
  projectRoot: string,
  issueId: string,
): ContinueState | null {
  const dir = resolveContinueStateDir(projectRoot, issueId);
  return clearFeedback(dir, issueId);
}
