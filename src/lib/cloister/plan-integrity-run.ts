/**
 * Running the plan-integrity gate against a workspace's plan home (PAN-1728).
 *
 * The canonical spec is immutable after planning except for its lifecycle
 * status fields. This module derives, from git alone, the reference copy of
 * the spec a work agent must leave unchanged, then diffs the HEAD spec
 * against it with `diffPlanDocuments`. Nothing is stored: the reference is
 * resolved on every run.
 *
 * Reference chain, newest first within `mergeBase..HEAD`:
 *   1. `trailer` — a commit whose `Plan-Finalized` trailer equals the SHA-256
 *      of one of the issue's spec blobs at that commit. A mismatched trailer
 *      is ignored and recorded as evidence.
 *   2. `legacy-finalize` — a `chore(plan): complete planning for <ISSUE>`
 *      commit that touches the issue's spec (written before the trailer).
 *   3. `merge-base` — the spec as it exists at the merge base.
 *   4. `first-add` — the first branch commit that added a spec for the issue
 *      (`pan start --auto` specs, which never get a finalize commit).
 *
 * Fail-closed boundary (mirrors test-skip, PR #3872 finding 4): a git command
 * that fails inside a valid plan-home work tree fails the gate. It passes with
 * evidence only when the plan home is not a git work-tree root, when no spec
 * exists for the issue, or when the HEAD spec carries merge-conflict markers
 * (the `vbrief-conflicts` check owns those).
 */
import { execFile } from 'child_process';
import { realpathSync } from 'fs';
import { promisify } from 'util';

import { resolvePlanHome } from '../pan-dir/paths.js';
import { parseXBriefFilename } from '../xbrief/lifecycle.js';
import { PLAN_FINALIZED_TRAILER, isLegacyFinalizeSubject, planFinalizedHash } from '../xbrief/plan-finalized.js';
import { diffPlanDocuments, type PlanIntegrityViolation } from './plan-integrity-gate.js';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const SPECS_DIR = '.pan/specs/';

export interface PlanReference {
  kind: 'trailer' | 'legacy-finalize' | 'merge-base' | 'first-add';
  sha: string;
  /** Spec paths (relative to the plan home) for the issue at `sha`. */
  specPaths: string[];
  /** Evidence lines, e.g. an ignored mismatched trailer. */
  notes: string[];
}

export interface PlanIntegrityEvaluation {
  /** True when the gate must fail: a git error, or any change beyond the allowed fields. */
  failed: boolean;
  /** Gate output: the reference, notes, every violation, and the remediation when failed. */
  evidence: string;
  /** The git diagnostic when the gate could not inspect the plan home. */
  error?: string;
}

/** The subset of a resolved workspace repo root the gate needs. */
export interface PlanIntegrityRepoRoot {
  repoKey: string;
  dir: string;
  targetBranch: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf-8',
    maxBuffer: GIT_MAX_BUFFER,
  });
  return stdout;
}

async function gitBytes(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'buffer', maxBuffer: GIT_MAX_BUFFER });
  return stdout;
}

function lines(output: string): string[] {
  return output.split('\n').map(line => line.trim()).filter(Boolean);
}

function isIssueSpecPath(path: string, issueId: string): boolean {
  if (!path.startsWith(SPECS_DIR)) return false;
  const parsed = parseXBriefFilename(path.slice(SPECS_DIR.length));
  return parsed !== null && parsed.issueId.toUpperCase() === issueId.toUpperCase();
}

/** Spec paths for the issue at a commit, relative to the plan home. */
async function issueSpecPathsAt(planHome: string, sha: string, issueId: string): Promise<string[]> {
  const output = await git(planHome, ['ls-tree', '--name-only', '--full-name', sha, '--', SPECS_DIR]);
  return lines(output).filter(path => isIssueSpecPath(path, issueId)).sort();
}

function specBlob(planHome: string, sha: string, path: string): Promise<Buffer> {
  return gitBytes(planHome, ['show', `${sha}:${path}`]);
}

function short(sha: string): string {
  return sha.slice(0, 8);
}

/**
 * Resolve the reference spec for an issue in a plan home by the PAN-1728
 * chain. Returns null when no commit on the branch or at the merge base holds
 * a spec for the issue. Throws when a git command fails. Reused by #4348.
 */
export async function resolvePlanReference(planHome: string, issueId: string, baseRef: string): Promise<PlanReference | null> {
  const mergeBase = (await git(planHome, ['merge-base', 'HEAD', baseRef])).trim();
  const range = `${mergeBase}..HEAD`;
  const notes: string[] = [];

  const log = await git(planHome, [
    'log',
    `--format=%H%x1f%s%x1f%(trailers:key=${PLAN_FINALIZED_TRAILER},valueonly,separator=%x2c)%x1e`,
    range,
  ]);
  const commits = log.split('\x1e').map(record => record.trim()).filter(Boolean).map((record) => {
    const [sha = '', subject = '', trailers = ''] = record.split('\x1f');
    return { sha, subject, trailers: trailers.split(',').map(value => value.trim()).filter(Boolean) };
  });

  // 1. Newest commit whose trailer matches one of its issue spec blobs.
  for (const commit of commits) {
    if (commit.trailers.length === 0) continue;
    const specPaths = await issueSpecPathsAt(planHome, commit.sha, issueId);
    const hashes = new Set<string>();
    for (const path of specPaths) hashes.add(planFinalizedHash(await specBlob(planHome, commit.sha, path)));
    if (commit.trailers.some(value => hashes.has(value))) {
      return { kind: 'trailer', sha: commit.sha, specPaths, notes };
    }
    notes.push(`ignored ${PLAN_FINALIZED_TRAILER} trailer on ${short(commit.sha)}: hash mismatch`);
  }

  // 2. Newest legacy finalize commit that touches the issue's spec.
  for (const commit of commits) {
    if (!isLegacyFinalizeSubject(commit.subject, issueId)) continue;
    const touched = await git(planHome, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', commit.sha, '--', SPECS_DIR]);
    if (lines(touched).some(path => isIssueSpecPath(path, issueId))) {
      return { kind: 'legacy-finalize', sha: commit.sha, specPaths: await issueSpecPathsAt(planHome, commit.sha, issueId), notes };
    }
  }

  // 3. The spec as it exists at the merge base.
  const baseSpecs = await issueSpecPathsAt(planHome, mergeBase, issueId);
  if (baseSpecs.length > 0) return { kind: 'merge-base', sha: mergeBase, specPaths: baseSpecs, notes };

  // 4. The first branch commit that added a spec for the issue.
  const added = await git(planHome, ['log', '--diff-filter=A', '--reverse', '--format=%x1e%H', '--name-only', range, '--', SPECS_DIR]);
  for (const record of added.split('\x1e')) {
    const [sha, ...paths] = lines(record);
    if (sha && paths.some(path => isIssueSpecPath(path, issueId))) {
      return { kind: 'first-add', sha, specPaths: await issueSpecPathsAt(planHome, sha, issueId), notes };
    }
  }
  return null;
}

function hasConflictMarkers(bytes: Buffer): boolean {
  const text = bytes.toString('utf-8');
  return text.includes('<<<<<<<') && text.includes('=======') && text.includes('>>>>>>>');
}

function describeViolation(violation: PlanIntegrityViolation): string {
  switch (violation.kind) {
    case 'item-added': return `item ${violation.subject}: added`;
    case 'item-removed': return `item ${violation.subject}: removed`;
    case 'item-changed': return `item ${violation.subject}: changed${violation.keys?.length ? ` ${violation.keys.join(', ')}` : ''}`;
    case 'field-changed': return `${violation.subject}: changed`;
  }
}

function remediation(planHome: string, workspacePath: string, issueId: string, reference: PlanReference, paths: string[]): string[] {
  const where = realpathOrSelf(planHome) === realpathOrSelf(workspacePath) ? '' : ` in ${planHome}`;
  return [
    '',
    `The spec is immutable after planning; only its lifecycle status fields may change. To fix${where}:`,
    `  git restore --source=${reference.sha} --staged --worktree -- ${paths.join(' ')}`,
    '  then commit, and record item and AC completion with `pan task done` (the continue file), never in the spec.',
    `If the plan itself is wrong, stop and ask for re-planning (\`pan plan ${issueId}\`).`,
  ];
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function errorMessage(error: unknown): string {
  const stderr = (error as { stderr?: unknown })?.stderr;
  const detail = typeof stderr === 'string' ? stderr.trim() : Buffer.isBuffer(stderr) ? stderr.toString('utf-8').trim() : '';
  return detail || (error instanceof Error ? error.message : String(error));
}

/**
 * Evaluate the plan-integrity gate for an issue (PAN-1728 FR-4). The runner
 * calls this once, after test-skip and before the quality gates.
 */
export async function evaluatePlanIntegrityGate(
  issueId: string,
  workspacePath: string,
  roots: readonly PlanIntegrityRepoRoot[],
): Promise<PlanIntegrityEvaluation> {
  const planHome = resolvePlanHome(workspacePath);

  let topLevel: string;
  try {
    topLevel = (await git(planHome, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return { failed: false, evidence: `plan home ${planHome} is not a git work tree; plan-integrity skipped` };
  }
  // A directory nested inside another checkout (a non-repo polyrepo wrapper
  // under the primary checkout) resolves to that outer repo; it is not ours.
  if (realpathOrSelf(topLevel) !== realpathOrSelf(planHome)) {
    return { failed: false, evidence: `plan home ${planHome} is not a git work-tree root (${topLevel}); plan-integrity skipped` };
  }

  const planHomeReal = realpathOrSelf(planHome);
  const targetBranch = roots.find(root => realpathOrSelf(root.dir) === planHomeReal)?.targetBranch
    ?? roots[0]?.targetBranch
    ?? 'main';

  try {
    const reference = await resolvePlanReference(planHome, issueId, `origin/${targetBranch}`);
    const headPaths = await issueSpecPathsAt(planHome, 'HEAD', issueId);
    if (!reference) {
      return {
        failed: false,
        evidence: headPaths.length === 0
          ? `no spec for ${issueId}`
          : `no reference spec for ${issueId} on this branch; plan-integrity skipped`,
      };
    }

    const headBlobs = new Map<string, Buffer>();
    for (const path of headPaths) headBlobs.set(path, await specBlob(planHome, 'HEAD', path));
    const conflicted = headPaths.filter(path => hasConflictMarkers(headBlobs.get(path)!));
    if (conflicted.length > 0) {
      return {
        failed: false,
        evidence: [`reference: ${reference.kind} ${short(reference.sha)}`, `${conflicted.join(', ')}: spec has merge-conflict markers; vbrief-conflicts owns this`].join('\n'),
      };
    }

    const violations: string[] = [];
    for (const path of headPaths) {
      if (!reference.specPaths.includes(path)) violations.push(`spec file added: ${path}`);
    }
    for (const path of reference.specPaths) {
      if (!headPaths.includes(path)) violations.push(`spec file removed: ${path}`);
    }
    for (const path of headPaths.filter(p => reference.specPaths.includes(p))) {
      const headBytes = headBlobs.get(path)!;
      const referenceBytes = await specBlob(planHome, reference.sha, path);
      if (headBytes.equals(referenceBytes)) continue;
      let headDoc: unknown;
      let referenceDoc: unknown;
      try {
        headDoc = JSON.parse(headBytes.toString('utf-8'));
      } catch (error) {
        violations.push(`spec does not parse at HEAD: ${path}: ${errorMessage(error)}`);
        continue;
      }
      try {
        referenceDoc = JSON.parse(referenceBytes.toString('utf-8'));
      } catch (error) {
        violations.push(`${path}: changed (reference spec does not parse: ${errorMessage(error)})`);
        continue;
      }
      violations.push(...diffPlanDocuments(referenceDoc, headDoc).map(describeViolation));
    }

    const header = [`reference: ${reference.kind} ${short(reference.sha)}`, ...reference.notes];
    if (violations.length === 0) {
      return { failed: false, evidence: [...header, 'spec unchanged beyond lifecycle status fields'].join('\n') };
    }
    const touchedPaths = [...new Set([...reference.specPaths, ...headPaths])];
    return {
      failed: true,
      evidence: [...header, ...violations, ...remediation(planHome, workspacePath, issueId, reference, touchedPaths)].join('\n'),
      error: `Spec for ${issueId} changed beyond lifecycle status fields`,
    };
  } catch (error) {
    const message = `plan-integrity: git failed in ${planHome}: ${errorMessage(error)}`;
    return { failed: true, evidence: message, error: message };
  }
}
