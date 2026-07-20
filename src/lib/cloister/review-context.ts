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
import { findPlanSync, readPlan } from '../xbrief/io.js';
import { scanStubUi, type StubUiFinding } from './lint-stub-ui.js';
import { fetchCodeRabbitFindings, type CodeRabbitFinding } from './coderabbit-ingestion.js';
import { findXBriefByIssueSync } from '../xbrief/lifecycle-io.js';
import { getDevrootPathSync } from '../config.js';
import { FsError } from '../errors.js';
import { resolveWorkspaceRepoRootsSync } from '../project-repos.js';

const execAsync = promisify(exec);

export const REVIEW_LARGE_CHANGESET_FILES = 25;
export const REVIEW_LARGE_CHANGESET_LINES = 1500;

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

export interface ReviewItemTrace {
  itemId: string;
  title: string;
  traces: string[];
}

/** Per-repo git context for polyrepo workspaces (PAN-2948). Additive — absent
 * or single-entry for monorepo workspaces, so existing consumers are untouched. */
export interface ReviewRepoContext {
  repoKey: string;
  branch: string;
  headSha: string;
  diffBase: string;
  fileCount: number;
}

export interface ReviewContextManifest {
  runId: string;
  issueId: string;
  generatedAt: string;
  branch: string;
  headSha: string;
  /** Present when the workspace is polyrepo: one entry per sub-repo reviewed. */
  repos?: ReviewRepoContext[];
  diff: {
    stat: string;
    truncated: boolean;
  };
  changedFiles: ChangedFile[];
  largeChangeset: {
    fileCount: number;
    changedLines: number;
    isLarge: boolean;
  };
  acceptanceCriteria: string[];
  nonGoals: string[];
  traces: ReviewItemTrace[];
  policyNotes: string[];
  stubUiFindings: StubUiFinding[];
  codeRabbitFindings: CodeRabbitFinding[];
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

export async function getDiffBase(cwd: string, targetBranch = 'main'): Promise<string> {
  try {
    const { stdout } = await execAsync(`git merge-base origin/${targetBranch} HEAD`, { cwd, encoding: 'utf-8' });
    return stdout.trim();
  } catch {
    try {
      const { stdout } = await execAsync(`git merge-base ${targetBranch} HEAD`, { cwd, encoding: 'utf-8' });
      return stdout.trim();
    } catch {
      return targetBranch;
    }
  }
}

export async function getChangedFiles(cwd: string, base: string, pathPrefix = ''): Promise<ChangedFile[]> {
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
    const prefixedPath = `${pathPrefix}${path}`;

    files.push({
      path: prefixedPath,
      status: statusLetter,
      additions: counts.additions,
      deletions: counts.deletions,
      riskScore: riskScore(prefixedPath),
    });
  }

  // Sort descending by risk score so reviewers see hotspots first
  return files.sort((a, b) => b.riskScore - a.riskScore);
}

export async function getDiffStat(cwd: string, base: string): Promise<{ stat: string; truncated: boolean }> {
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

interface PlanReviewRequirements {
  acceptanceCriteria: string[];
  nonGoals: string[];
  traces: ReviewItemTrace[];
}

async function extractPlanReviewRequirements(workspace: string, issueId: string): Promise<PlanReviewRequirements> {
  // Try workspace-local spec first
  const planPath = findPlanSync(workspace);
  if (planPath) {
    try {
      const doc = await Effect.runPromise(readPlan(planPath));
      return {
        acceptanceCriteria: flattenAC(doc),
        nonGoals: flattenNonGoals(doc),
        traces: flattenTraces(doc),
      };
    } catch {
      // Fall through to lifecycle lookup
    }
  }

  // Try project-root lifecycle directories
  try {
    const projectRoot = getDevrootPathSync();
    if (!projectRoot) return { acceptanceCriteria: [], nonGoals: [], traces: [] };
    const found = findXBriefByIssueSync(projectRoot, issueId);
    if (found) {
      return {
        acceptanceCriteria: flattenAC(found.document),
        nonGoals: flattenNonGoals(found.document),
        traces: flattenTraces(found.document),
      };
    }
  } catch {
    // Non-fatal
  }

  return { acceptanceCriteria: [], nonGoals: [], traces: [] };
}

interface PanItem {
  id?: string;
  title?: string;
  acceptanceCriteria?: string[];
  subItems?: Array<{ title?: string; description?: string }>;
  metadata?: Record<string, unknown>;
}

function flattenAC(doc: { plan?: { items?: PanItem[] } }): string[] {
  const acs: string[] = [];
  for (const item of doc?.plan?.items ?? []) {
    // Planning agent writes acceptanceCriteria directly on items
    if (Array.isArray(item.acceptanceCriteria)) {
      acs.push(...item.acceptanceCriteria);
    }
    // Standard xBRIEF v0.5 sub-items
    for (const sub of item.subItems ?? []) {
      const text = sub.title ?? sub.description ?? '';
      if (text) acs.push(text);
    }
  }
  return acs;
}

function flattenNonGoals(doc: { plan?: { narratives?: Record<string, string | undefined> } }): string[] {
  const raw = doc.plan?.narratives?.NonGoals?.trim();
  if (!raw || raw.toLowerCase() === 'none') return [];
  return raw
    .split('\n')
    .map(line => line.trim().replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function flattenTraces(doc: { plan?: { items?: PanItem[] } }): ReviewItemTrace[] {
  const traces: ReviewItemTrace[] = [];
  for (const item of doc.plan?.items ?? []) {
    const raw = item.metadata?.traces;
    if (!Array.isArray(raw)) continue;
    const itemTraces = raw.filter((trace): trace is string => typeof trace === 'string' && trace.trim().length > 0);
    if (itemTraces.length === 0) continue;
    traces.push({
      itemId: item.id ?? '<unknown>',
      title: item.title ?? '',
      traces: itemTraces,
    });
  }
  return traces;
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
    | 'issueId' | 'branch' | 'headSha' | 'repos' | 'changedFiles' | 'acceptanceCriteria' | 'nonGoals' | 'traces' | 'policyNotes' | 'stubUiFindings' | 'codeRabbitFindings' | 'diff' | 'largeChangeset'
  >,
): string {
  const lines: string[] = [];

  lines.push(`Issue: ${manifest.issueId}`);
  lines.push(`Branch: ${manifest.branch}`);
  lines.push(`Head: ${manifest.headSha}`);

  if (manifest.repos && manifest.repos.length > 1) {
    lines.push('Polyrepo workspace — changed-file paths are prefixed with the sub-repo name:');
    for (const repo of manifest.repos) {
      lines.push(`  ${repo.repoKey}: ${repo.branch} @ ${repo.headSha.slice(0, 8)} (${repo.fileCount} files changed)`);
    }
  }

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

  if (manifest.largeChangeset?.isLarge) {
    lines.push('');
    lines.push(`LARGE CHANGESET: ${manifest.largeChangeset.fileCount} files, ${manifest.largeChangeset.changedLines} changed lines.`);
    lines.push('Read the highest-risk files first, then medium-risk. Read only changed regions, not whole files.');
    lines.push('If you approach the context limit, write a report on what you reviewed and flag any uncovered high-risk files as a BLOCKING coverage gap.');
    lines.push('Do not read everything and overflow; do not approve changes you have not reviewed.');
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

  if (manifest.nonGoals.length > 0) {
    lines.push('');
    lines.push('NonGoals / must-not constraints:');
    for (const [i, nonGoal] of manifest.nonGoals.slice(0, 7).entries()) {
      lines.push(`  ${i + 1}. ${nonGoal}`);
    }
    if (manifest.nonGoals.length > 7) {
      lines.push(`  ... and ${manifest.nonGoals.length - 7} more (see manifest)`);
    }
  }

  if (manifest.traces.length > 0) {
    lines.push('');
    lines.push('Requirement traces:');
    for (const trace of manifest.traces.slice(0, 7)) {
      lines.push(`  ${trace.itemId}: ${trace.traces.join(', ')}`);
    }
    if (manifest.traces.length > 7) {
      lines.push(`  ... and ${manifest.traces.length - 7} more (see manifest)`);
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

  if (manifest.stubUiFindings.length > 0) {
    lines.push('');
    lines.push('Stub UI findings (BLOCKING if unmitigated):');
    for (const finding of manifest.stubUiFindings.slice(0, 10)) {
      lines.push(`  - ${finding.patternLabel} @ ${finding.filePath}:${finding.lineNumber}`);
    }
    if (manifest.stubUiFindings.length > 10) {
      lines.push(`  ... and ${manifest.stubUiFindings.length - 10} more (see manifest)`);
    }
  }

  if (manifest.codeRabbitFindings.length > 0) {
    lines.push('');
    lines.push('CodeRabbit findings (ADVISORY — non-gating; context, not acceptance criteria):');
    for (const finding of manifest.codeRabbitFindings.slice(0, 10)) {
      const location = finding.path ? `${finding.path}${typeof finding.line === 'number' ? `:${finding.line}` : ''}` : 'general';
      const bodyPreview = finding.body.slice(0, 200);
      lines.push(`  - ${location} ${bodyPreview}${finding.body.length > 200 ? '...' : ''}`);
    }
    if (manifest.codeRabbitFindings.length > 10) {
      lines.push(`  ... and ${manifest.codeRabbitFindings.length - 10} more (see manifest)`);
    }
  }

  lines.push('');
  lines.push(`Diff stat: ${manifest.diff.stat}`);

  return lines.join('\n');
}export async function buildReviewContextPromise(opts: BuildReviewContextOpts): Promise<ReviewContextManifest> {
  const { runId, issueId, workspace } = opts;

  if (!existsSync(workspace)) {
    throw new Error(`Workspace directory does not exist: ${workspace}`);
  }

  // PAN-2948: a polyrepo workspace root is a one-commit wrapper repo whose
  // .gitignore excludes the code sub-repos — diffing it always yields an empty
  // manifest. Resolve the actual repo roots and build per-repo, aggregating
  // with repo-prefixed paths. Monorepo resolves to one root at the workspace.
  const roots = resolveWorkspaceRepoRootsSync(issueId, workspace);
  const isPolyrepo = roots.some(root => root.isPolyrepo);

  const perRepo = await Promise.all(roots.map(async root => {
    const prefix = isPolyrepo ? `${root.repoKey}/` : '';
    const [headSha, branch, diffBase] = await Promise.all([
      getHeadSha(root.dir),
      getCurrentBranch(root.dir),
      getDiffBase(root.dir, root.targetBranch),
    ]);
    const [changedFiles, diffStat, stubUiFindings] = await Promise.all([
      getChangedFiles(root.dir, diffBase, prefix),
      getDiffStat(root.dir, diffBase),
      scanStubUi(root.dir, diffBase).catch((err) => {
        console.warn(`[buildReviewContext] scanStubUi failed for ${root.repoKey}: ${err instanceof Error ? err.message : String(err)}`);
        return [] as StubUiFinding[];
      }),
    ]);
    return {
      root,
      headSha,
      branch,
      diffBase,
      changedFiles,
      diffStat,
      stubUiFindings: prefix
        ? stubUiFindings.map(finding => ({ ...finding, filePath: `${prefix}${finding.filePath}` }))
        : stubUiFindings,
    };
  }));

  // Primary repo drives the top-level branch/headSha: the first root with
  // changes (for MYN that's fe), falling back to the first root.
  const primary = perRepo.find(repo => repo.changedFiles.length > 0) ?? perRepo[0];
  const headSha = primary.headSha;
  // Polyrepo: opts.branch describes the wrapper ("master") — the primary
  // sub-repo's branch is the one reviewers should see.
  const currentBranch = isPolyrepo ? primary.branch : (opts.branch ?? primary.branch);
  const changedFiles = perRepo
    .flatMap(repo => repo.changedFiles)
    .sort((a, b) => b.riskScore - a.riskScore);
  const diff = isPolyrepo
    ? {
        stat: perRepo
          .filter(repo => repo.changedFiles.length > 0)
          .map(repo => `── ${repo.root.repoKey} ──\n${repo.diffStat.stat}`)
          .join('\n') || 'No changes',
        truncated: true,
      }
    : primary.diffStat;
  const stubUiFindings = perRepo.flatMap(repo => repo.stubUiFindings);
  const repoContexts: ReviewRepoContext[] = perRepo.map(repo => ({
    repoKey: repo.root.repoKey,
    branch: repo.branch,
    headSha: repo.headSha,
    diffBase: repo.diffBase,
    fileCount: repo.changedFiles.length,
  }));

  const [planRequirements, policyNotes, codeRabbitFindings] = await Promise.all([
    extractPlanReviewRequirements(workspace, issueId),
    readPolicyNotes(workspace),
    fetchCodeRabbitFindings({ workspace, branch: currentBranch }).catch((err) => {
      console.warn(`[buildReviewContext] CodeRabbit ingestion failed: ${err instanceof Error ? err.message : String(err)}`);
      return [] as CodeRabbitFinding[];
    }),
  ]);

  const fileCount = changedFiles.length;
  const changedLines = changedFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const largeChangeset = {
    fileCount,
    changedLines,
    isLarge: fileCount > REVIEW_LARGE_CHANGESET_FILES || changedLines > REVIEW_LARGE_CHANGESET_LINES,
  };

  const manifestDir = join(workspace, PAN_DIRNAME, 'review', runId);
  await mkdir(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, 'context.json');

  const manifest: ReviewContextManifest = {
    runId,
    issueId,
    generatedAt: new Date().toISOString(),
    branch: currentBranch,
    headSha,
    ...(isPolyrepo ? { repos: repoContexts } : {}),
    diff,
    changedFiles,
    largeChangeset,
    acceptanceCriteria: planRequirements.acceptanceCriteria,
    nonGoals: planRequirements.nonGoals,
    traces: planRequirements.traces,
    policyNotes,
    stubUiFindings,
    codeRabbitFindings,
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
export const buildReviewContext = (
  opts: BuildReviewContextOpts,
): Effect.Effect<ReviewContextManifest, FsError> =>
  Effect.tryPromise({
    try: () => buildReviewContextPromise(opts),
    catch: (cause) =>
      new FsError({
        path: opts.workspace,
        operation: 'buildReviewContext',
        cause,
      }),
  });
