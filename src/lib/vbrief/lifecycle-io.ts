/**
 * vBRIEF Lifecycle IO
 *
 * PAN-967 finished the migration: `.pan/specs/` is the canonical store for scope
 * specs and `.pan/continues/` is the canonical store for project-side continue
 * files. Legacy `vbrief/<lifecycle>/` directories remain as read-only fallback
 * for legacy spec files only (no continue files — those are at `.pan/continues/`).
 */

import { exec, spawn } from 'child_process';
import { basename, join } from 'path';
import { promisify } from 'util';
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME, PAN_SPEC_FILENAME } from '../pan-dir/index.js';

import { appendFeedbackEntry, appendSessionEntry, clearFeedback, continueFilename, readContinueState, writeContinueState, type ContinueFeedbackEntry, type ContinueSessionEntry, type ContinueState } from './continue-state.js';
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
import { getContinueFilePath, getContinuesDir } from '../pan-dir/continues.js';

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
): Promise<{ from: FoundVBrief; toPath: string }> {
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

  invalidateVBriefIndex(projectRoot);
  return {
    from: found,
    toPath: updatedSpec.path,
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

  const planDoc = readPlan(sourceVBrief);
  const upperIssueId = issueId.toUpperCase();
  const existingFilename = planDoc.plan.metadata?.canonicalFilename;
  const canonicalFilename = (existingFilename && typeof existingFilename === 'string')
    ? existingFilename
    : generateVBriefFilename(upperIssueId, slugify(planDoc.plan.title || planDoc.plan.id || upperIssueId));

  const promoted = writeSpecForIssue(projectRoot, planDoc, 'proposed', canonicalFilename);

  const sourceContinue = join(panDir, PAN_CONTINUE_FILENAME);
  let destContinue: string | null = null;
  if (existsSync(sourceContinue)) {
    destContinue = getContinueFilePath(projectRoot, upperIssueId);
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
    return readContinueState(projectRoot, issueId);
  } catch {
    return null;
  }
}

export function writeContinueStateForIssue(
  projectRoot: string,
  issueId: string,
  state: ContinueState,
): void {
  writeContinueState(projectRoot, issueId, state);
}

export function appendContinueSessionEntryForIssue(
  projectRoot: string,
  issueId: string,
  entry: Omit<ContinueSessionEntry, 'timestamp'> & { timestamp?: string },
): ContinueState {
  return appendSessionEntry(projectRoot, issueId, entry);
}

export function appendFeedbackEntryForIssue(
  projectRoot: string,
  issueId: string,
  entry: ContinueFeedbackEntry,
): ContinueState {
  return appendFeedbackEntry(projectRoot, issueId, entry);
}

export function clearFeedbackForIssue(
  projectRoot: string,
  issueId: string,
): ContinueState | null {
  return clearFeedback(projectRoot, issueId);
}
