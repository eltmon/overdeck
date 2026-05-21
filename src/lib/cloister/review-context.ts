/**
 * Review Context Manifest Builder (PAN-1059)
 *
 * Builds a shared `.pan/review/<runId>/context.json` before spawning
 * any sub-reviewers. All four convoy agents read this file instead of
 * independently running `git diff` and reading every changed file,
 * eliminating ~4× redundant I/O and the token cost that goes with it.
 */

import { exec } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { Effect } from 'effect';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { findPlan, readPlanAsync } from '../vbrief/io.js';
import { findVBriefByIssue } from '../vbrief/lifecycle-io.js';
import { getDevrootPath } from '../config.js';
import { FsError } from '../errors.js';

const execAsync = promisify(exec);

// The manifest no longer embeds raw diff text (PAN-1125).
// Reviewers receive a concise inline summary in their spawn prompt and read
// individual files on demand. The manifest carries metadata only: stat,
// changedFiles, acceptanceCriteria, and policyNotes.

const RISK_HIGH = 5;
const RISK_MED  = 3;
const RISK_LOW  = 1;

// Patterns that raise a file's risk score
const HIGH_RISK_PATTERNS = [
  /auth/i, /password/i, /token/i, /secret/i, /crypt/i,
  /permission/i, /privilege/i, /admin/i, /acl/i, /rbac/i,
  /payment/i, /billing/i, /stripe/i,
  /sql/i, /query/i, /inject/i,
  /exec\b/i, /spawn/i, /shell/i, /eval\b/i,
];

const MED_RISK_PATTERNS = [
  /config/i, /env/i, /setting/i, /migration/i,
  /middleware/i, /route/i, /api/i,
];

const LOW_RISK_PATTERNS = [
  /test/i, /spec/i, /mock/i, /fixture/i, /stub/i,
  /\.md$/, /\.txt$/, /\.json$/, /README/i,
];

export interface ChangedFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U';
  additions: number;
  deletions: number;
  riskScore: number;
}

export interface ReviewContextManifest {
  runId: string;
  issueId: string;
  generatedAt: string;
  branch: string;
  headSha: string;
  diff: {
    stat: string;
    truncated: boolean;
  };
  changedFiles: ChangedFile[];
  acceptanceCriteria: string[];
  policyNotes: string[];
  manifestPath: string;
}

function riskScore(filePath: string): number {
  if (LOW_RISK_PATTERNS.some(p => p.test(filePath))) return RISK_LOW;
  if (HIGH_RISK_PATTERNS.some(p => p.test(filePath))) return RISK_HIGH;
  if (MED_RISK_PATTERNS.some(p => p.test(filePath))) return RISK_MED;
  return 2; // default: between low and medium
}

async function getHeadSha(cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd, encoding: 'utf-8' });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function getCurrentBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd, encoding: 'utf-8' });
    return stdout.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function getDiffBase(cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git merge-base origin/main HEAD', { cwd, encoding: 'utf-8' });
    return stdout.trim();
  } catch {
    try {
      const { stdout } = await execAsync('git merge-base main HEAD', { cwd, encoding: 'utf-8' });
      return stdout.trim();
    } catch {
      return 'main';
    }
  }
}

async function getChangedFiles(cwd: string, base: string): Promise<ChangedFile[]> {
  // --name-status gives us the status letter + path
  let nameStatus = '';
  try {
    const { stdout } = await execAsync(
      `git diff --name-status "${base}"...HEAD`,
      { cwd, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 },
    );
    nameStatus = stdout;
  } catch {
    return [];
  }

  // --numstat gives us additions + deletions per file
  const numstatMap = new Map<string, { additions: number; deletions: number }>();
  try {
    const { stdout } = await execAsync(
      `git diff --numstat "${base}"...HEAD`,
      { cwd, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 },
    );
    for (const line of stdout.split('\n')) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const additions = parseInt(parts[0], 10) || 0;
        const deletions = parseInt(parts[1], 10) || 0;
        // Binary files show '-'; treat as 0
        numstatMap.set(parts[2], { additions, deletions });
      }
    }
  } catch {
    // numstat failure is non-fatal; additions/deletions default to 0
  }

  const files: ChangedFile[] = [];
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue;
    const [statusChar, ...pathParts] = line.split('\t');
    const path = pathParts[pathParts.length - 1] ?? '';
    if (!path) continue;

    const statusLetter = (statusChar?.[0] ?? 'M') as ChangedFile['status'];
    const counts = numstatMap.get(path) ?? { additions: 0, deletions: 0 };

    files.push({
      path,
      status: statusLetter,
      additions: counts.additions,
      deletions: counts.deletions,
      riskScore: riskScore(path),
    });
  }

  // Sort descending by risk score so reviewers see hotspots first
  return files.sort((a, b) => b.riskScore - a.riskScore);
}

async function getDiffStat(cwd: string, base: string): Promise<{ stat: string; truncated: boolean }> {
  let stat = '';

  try {
    const { stdout } = await execAsync(
      `git diff --stat "${base}"...HEAD`,
      { cwd, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 },
    );
    stat = stdout.trim() || 'No changes';
  } catch {
    stat = 'Unable to compute diff stat';
  }

  // We no longer embed raw diff text in the manifest (PAN-1125).
  // Reviewers read individual files via Read/Grep as needed.
  return { stat, truncated: true };
}

async function extractAcceptanceCriteria(workspace: string, issueId: string): Promise<string[]> {
  // Try workspace-local spec first
  const planPath = findPlan(workspace);
  if (planPath) {
    try {
      const doc = await readPlanAsync(planPath);
      return flattenAC(doc);
    } catch {
      // Fall through to lifecycle lookup
    }
  }

  // Try project-root lifecycle directories
  try {
    const projectRoot = getDevrootPath();
    if (!projectRoot) return [];
    const found = findVBriefByIssue(projectRoot, issueId);
    if (found) {
      return flattenAC(found.document);
    }
  } catch {
    // Non-fatal
  }

  return [];
}

interface PanItem {
  acceptanceCriteria?: string[];
  subItems?: Array<{ title?: string; description?: string }>;
}

function flattenAC(doc: { plan?: { items?: PanItem[] } }): string[] {
  const acs: string[] = [];
  for (const item of doc?.plan?.items ?? []) {
    // Planning agent writes acceptanceCriteria directly on items
    if (Array.isArray(item.acceptanceCriteria)) {
      acs.push(...item.acceptanceCriteria);
    }
    // Standard vBRIEF v0.5 sub-items
    for (const sub of item.subItems ?? []) {
      const text = sub.title ?? sub.description ?? '';
      if (text) acs.push(text);
    }
  }
  return acs;
}

async function readPolicyNotes(workspace: string): Promise<string[]> {
  const notes: string[] = [];

  // Pull CRITICAL rules from CLAUDE.md
  const claudeMdPath = join(workspace, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    try {
      const content = await readFile(claudeMdPath, 'utf-8');
      const criticalLines = content
        .split('\n')
        .filter(l => l.startsWith('## CRITICAL') || l.startsWith('**NEVER') || l.startsWith('**CRITICAL'))
        .map(l => l.replace(/^#+\s*/, '').replace(/^\*+/, '').trim())
        .filter(Boolean);
      notes.push(...criticalLines.slice(0, 10));
    } catch {
      // Non-fatal
    }
  }

  return notes;
}

export interface BuildReviewContextOpts {
  runId: string;
  issueId: string;
  workspace: string;
  branch?: string;
}

/**
 * Build and persist the review context manifest for a review run.
 *
 * Returns the manifest object and its path on disk.
 * Throws if the workspace directory does not exist.
 */
/**
 * Format a concise Tier-1 inline summary from manifest fields.
 *
 * This summary is embedded directly into each convoy reviewer's spawn prompt
 * so they receive scope, priority, and constraints without reading a large
 * manifest file first (PAN-1125).
 */
export function formatTier1Summary(
  manifest: Pick<
    ReviewContextManifest,
    'issueId' | 'branch' | 'headSha' | 'changedFiles' | 'acceptanceCriteria' | 'policyNotes' | 'diff'
  >,
): string {
  const lines: string[] = [];

  lines.push(`Issue: ${manifest.issueId}`);
  lines.push(`Branch: ${manifest.branch}`);
  lines.push(`Head: ${manifest.headSha}`);

  const highRisk = manifest.changedFiles.filter((f) => f.riskScore >= 5);
  const medRisk = manifest.changedFiles.filter((f) => f.riskScore >= 3 && f.riskScore < 5);
  const lowRisk = manifest.changedFiles.filter((f) => f.riskScore < 3);
  lines.push(
    `Files changed: ${manifest.changedFiles.length} (${highRisk.length} high-risk, ${medRisk.length} medium, ${lowRisk.length} low)`,
  );

  if (manifest.changedFiles.length > 0) {
    lines.push('');
    lines.push('Changed files (risk-ranked):');
    for (const f of manifest.changedFiles.slice(0, 15)) {
      const riskLabel = f.riskScore >= 5 ? 'HIGH' : f.riskScore >= 3 ? 'MED' : 'LOW';
      lines.push(`  ${f.path.padEnd(40)} (+${f.additions}/-${f.deletions})  risk: ${riskLabel}`);
    }
    if (manifest.changedFiles.length > 15) {
      lines.push(`  ... and ${manifest.changedFiles.length - 15} more (see manifest)`);
    }
  }

  if (manifest.acceptanceCriteria.length > 0) {
    lines.push('');
    lines.push('Acceptance criteria:');
    for (const [i, ac] of manifest.acceptanceCriteria.slice(0, 7).entries()) {
      lines.push(`  ${i + 1}. ${ac}`);
    }
    if (manifest.acceptanceCriteria.length > 7) {
      lines.push(`  ... and ${manifest.acceptanceCriteria.length - 7} more (see manifest)`);
    }
  }

  if (manifest.policyNotes.length > 0) {
    lines.push('');
    lines.push('Policy notes:');
    for (const note of manifest.policyNotes.slice(0, 5)) {
      lines.push(`  - ${note}`);
    }
    if (manifest.policyNotes.length > 5) {
      lines.push(`  ... and ${manifest.policyNotes.length - 5} more (see manifest)`);
    }
  }

  lines.push('');
  lines.push(`Diff stat: ${manifest.diff.stat}`);

  return lines.join('\n');
}

export async function buildReviewContext(opts: BuildReviewContextOpts): Promise<ReviewContextManifest> {
  const { runId, issueId, workspace } = opts;

  if (!existsSync(workspace)) {
    throw new Error(`Workspace directory does not exist: ${workspace}`);
  }

  const [headSha, currentBranch, diffBase] = await Promise.all([
    getHeadSha(workspace),
    opts.branch ? Promise.resolve(opts.branch) : getCurrentBranch(workspace),
    getDiffBase(workspace),
  ]);

  const [changedFiles, diff] = await Promise.all([
    getChangedFiles(workspace, diffBase),
    getDiffStat(workspace, diffBase),
  ]);

  const [acceptanceCriteria, policyNotes] = await Promise.all([
    extractAcceptanceCriteria(workspace, issueId),
    readPolicyNotes(workspace),
  ]);

  const manifestDir = join(workspace, PAN_DIRNAME, 'review', runId);
  await mkdir(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, 'context.json');

  const manifest: ReviewContextManifest = {
    runId,
    issueId,
    generatedAt: new Date().toISOString(),
    branch: currentBranch,
    headSha,
    diff,
    changedFiles,
    acceptanceCriteria,
    policyNotes,
    manifestPath,
  };

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return manifest;
}

// ─── Effect variant (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect variant of {@link buildReviewContext}. Wraps the Promise-based
 * implementation in `Effect.tryPromise` so callers in Effect pipelines can
 * compose it with typed error channels. The git probes inside
 * {@link buildReviewContext} are best-effort — they fall back to sentinel
 * strings instead of failing — so the only error this Effect can surface is
 * the workspace-not-found {@link FsError}.
 */
export const buildReviewContextEffect = (
  opts: BuildReviewContextOpts,
): Effect.Effect<ReviewContextManifest, FsError> =>
  Effect.tryPromise({
    try: () => buildReviewContext(opts),
    catch: (cause) =>
      new FsError({
        path: opts.workspace,
        operation: 'buildReviewContext',
        cause,
      }),
  });
