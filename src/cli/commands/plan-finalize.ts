import { Effect } from 'effect';
import chalk from 'chalk';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { createBeadsFromVBrief } from '../../lib/vbrief/beads.js';
import { findPlanSync, findWorkspaceDraftPlanSync, readPlanSync } from '../../lib/vbrief/io.js';
import { generateVBriefFilename, slugify } from '../../lib/vbrief/lifecycle.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../../lib/activity-logger.js';
import { getDashboardApiUrlSync } from '../../lib/config.js';
import { checkPrdGateSync, getIssueDraftPath, MIN_PRD_LINES, type PrdGateResult, PAN_DIRNAME, PAN_SPEC_FILENAME } from '../../lib/pan-dir/index.js';
import type { VBriefDocument } from '../../lib/vbrief/types.js';
import { formatQualityIssues, lintPlanQuality, type QualityIssue } from '../../lib/vbrief/quality-lint.js';
import { analyzeSwarmReadiness, type SwarmReadinessVerdict } from '../../lib/vbrief/swarm-readiness.js';
import { findProjectByPathSync, getProjectSwarmHotspots } from '../../lib/projects.js';

interface PlanFinalizeOptions {
  workspace?: string;
  json?: boolean;
  /** Commander negation: `--no-promote` arrives as `promote: false` (default true). */
  promote?: boolean;
  /** Commander negation: `--no-quality-lint` arrives as `qualityLint: false` (default true). */
  qualityLint?: boolean;
  /** Commander negation: `--no-prd` arrives as `prd: false` (default true) — bypass the PRD-first gate. */
  prd?: boolean;
}

export type PlanFinalizeQualityGateResult =
  | { ok: true; skipped: boolean; issues: QualityIssue[] }
  | { ok: false; skipped: false; issues: QualityIssue[] };

export function evaluatePlanFinalizeQualityGate(
  doc: VBriefDocument,
  options: Pick<PlanFinalizeOptions, 'qualityLint'> & { prdText?: string; hotspots?: string[] } = {},
): PlanFinalizeQualityGateResult {
  if (options.qualityLint === false) {
    return { ok: true, skipped: true, issues: [] };
  }
  const issues = lintPlanQuality(doc, { prdText: options.prdText, hotspots: options.hotspots });
  const errors = issues.filter(issue => issue.severity === 'error');
  return errors.length > 0
    ? { ok: false, skipped: false, issues }
    : { ok: true, skipped: false, issues };
}

export function formatReadinessReport(verdict: SwarmReadinessVerdict): string[] {
  const lines: string[] = ['Readiness report:'];
  lines.push('  dependency waves:');
  if (verdict.waves.length === 0) {
    lines.push('    none');
  } else {
    for (const wave of verdict.waves) {
      const ids = wave.items.map(item => item.id).join(', ') || 'none';
      lines.push(`    wave ${wave.index}: ${ids}`);
    }
  }

  lines.push('  file-overlap matrix:');
  const matrixRows = Object.entries(verdict.overlapMatrix);
  if (matrixRows.length === 0) {
    lines.push('    none');
  } else {
    let printed = false;
    for (const [itemId, overlaps] of matrixRows) {
      for (const [otherId, sharedFiles] of Object.entries(overlaps)) {
        if (itemId > otherId) continue;
        printed = true;
        lines.push(`    ${itemId} <-> ${otherId}: ${sharedFiles.length > 0 ? sharedFiles.join(', ') : '(conservative overlap)'}`);
      }
    }
    if (!printed) lines.push('    no cross-item file overlaps');
  }

  lines.push('  conflict groups:');
  if (verdict.conflictGroups.length === 0) {
    lines.push('    none');
  } else {
    for (const group of verdict.conflictGroups) {
      const shared = group.sharedFiles.length > 0 ? ` - ${group.sharedFiles.join(', ')}` : '';
      lines.push(`    ${group.itemIds.join(' + ')} (${group.reason})${shared}`);
    }
  }
  return lines;
}

interface PromotePlanningResult {
  success: boolean;
  message: string | null;
  error: string | null;
  workAgentSpawned: boolean;
  workAgentMessage: string | null;
  workAgentError: string | null;
  workAgentSkipReason: string | null;
}

type AutoPromotePhase = 'createBeads' | 'completePlanning' | 'terminal';
type AutoPromotePhaseStatus = 'start' | 'success' | 'failure' | 'skipped';

function emitAutoPromotePhase(
  issueId: string,
  phase: AutoPromotePhase,
  status: AutoPromotePhaseStatus,
  reason: string,
  details: Record<string, unknown> = {},
): void {
  const timestamp = new Date().toISOString();
  emitActivityEntrySync({
    source: 'plan-finalize',
    level: status === 'failure' ? 'error' : 'info',
    message: `auto-promote.phase=${phase}`,
    issueId,
    details: JSON.stringify({ issueId, timestamp, phase, status, reason, ...details }),
  });
}

function findWorkspaceRoot(start: string): string | null {
  let dir = resolve(start);
  while (true) {
    if (findPlanSync(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readAutoSpawnOnFinalize(issueId: string): boolean {
  const overdeckHome = process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck');
  const flagFile = join(overdeckHome, 'agents', `planning-${issueId.toLowerCase()}`, 'auto-spawn-on-finalize.json');
  try {
    if (!existsSync(flagFile)) return false;
    const flag = JSON.parse(readFileSync(flagFile, 'utf-8')) as { autoSpawnOnFinalize?: unknown };
    return flag.autoSpawnOnFinalize === true;
  } catch {
    return false;
  }
}

function readPrdDraftText(workspacePath: string, issueId: string): string | undefined {
  const path = join(workspacePath, PAN_DIRNAME, 'drafts', `${issueId}.md`);
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Format the PRD-first gate failure message (PAN-2234). Exported so tests can
 * assert on the exact text and so both finalize exit paths share one source.
 */
export function formatPrdGateFailureMessage(
  issueId: string,
  result: PrdGateResult,
  projectRootHint: string | null,
): string {
  if (result.reason === 'too-short') {
    return `✗ PRD-first gate: PRD draft too short for ${issueId}. Found ${result.path} (${result.lineCount} lines; minimum is ${MIN_PRD_LINES}). Expand it into a real implementation brief, then re-run finalize. For a genuinely trivial issue use --no-prd.`;
  }
  const canonical = projectRootHint ? getIssueDraftPath(projectRootHint, issueId) : `.pan/drafts/${issueId}.md`;
  return `✗ PRD-first gate: no PRD draft found for ${issueId}. Write ${canonical} first (roles/plan.md, Outputs #1), then re-run finalize. For a genuinely trivial issue use --no-prd.`;
}

export async function planFinalizeCommand(options: PlanFinalizeOptions = {}): Promise<void> {
  const startDir = options.workspace ? resolve(options.workspace) : process.cwd();
  const workspacePath = findWorkspaceRoot(startDir);

  if (!workspacePath) {
    const msg = 'No workspace spec found in current directory or any parent. Run this from a workspace where the planning agent wrote .pan/spec.vbrief.json.';
    if (options.json) console.log(JSON.stringify({ success: false, error: msg }));
    else console.error(chalk.red('✗ ' + msg));
    process.exit(1);
  }

  const planPath = findWorkspaceDraftPlanSync(workspacePath) ?? findPlanSync(workspacePath);
  if (!planPath) {
    const msg = `vBRIEF plan not readable at ${workspacePath}/.pan/spec.vbrief.json`;
    if (options.json) console.log(JSON.stringify({ success: false, error: msg }));
    else console.error(chalk.red('✗ ' + msg));
    process.exit(1);
  }

  // Derive issue ID from workspace directory name (feature-<id> or <id>) so we
  // can stamp the canonical filename onto the plan before generating beads.
  const workspaceName = workspacePath.split('/').pop() || '';
  const issueId = workspaceName.replace(/^feature-/, '').toUpperCase();

  // PRD-first gate (PAN-2234): refuse to finalize without a non-trivial PRD
  // draft. The prompt in roles/plan.md has always required this; this is the
  // mechanical enforcement. --no-prd bypasses loudly (and propagates noPrd to
  // the complete-planning endpoint so the server doesn't 422 the same run).
  const projectRootHint = findProjectByPathSync(workspacePath)?.path ?? null;
  if (options.prd === false) {
    if (!options.json) console.error(chalk.yellow('⚠ PRD gate SKIPPED (--no-prd)'));
  } else {
    const prdGate = checkPrdGateSync({ projectRoot: projectRootHint, workspacePath, issueId });
    if (!prdGate.ok) {
      const message = formatPrdGateFailureMessage(issueId, prdGate, projectRootHint);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: 'PRD-first gate failed', message, prdGate }));
      } else {
        console.error(chalk.red(message));
      }
      process.exit(4);
    }
  }

  if (!options.json) {
    console.log(chalk.dim(`workspace: ${workspacePath}`));
    console.log(chalk.dim('finalizing vBRIEF and creating beads…'));
  }

  const planDoc = readPlanSync(planPath);
  const prdText = readPrdDraftText(workspacePath, issueId);
  const hotspots = getProjectSwarmHotspots(findProjectByPathSync(workspacePath));
  const qualityGate = evaluatePlanFinalizeQualityGate(planDoc, { ...options, prdText, hotspots });
  const readinessReport = formatReadinessReport(analyzeSwarmReadiness(planDoc, { hotspots }));
  if (qualityGate.skipped) {
    if (!options.json) {
      console.error(chalk.yellow('⚠ quality lint SKIPPED (--no-quality-lint)'));
    }
  } else {
    if (!qualityGate.ok) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: 'vBRIEF quality lint failed', qualityIssues: qualityGate.issues }));
      } else {
        console.error(chalk.red('✗ vBRIEF quality lint failed:'));
        for (const line of formatQualityIssues(qualityGate.issues)) {
          console.error(chalk.red('  ' + line));
        }
        console.error('');
        for (const line of readinessReport) console.error(chalk.dim(line));
        console.error(chalk.dim('Use --no-quality-lint only for an emergency one-run bypass.'));
      }
      process.exit(3);
    }
    const warnings = qualityGate.issues.filter(issue => issue.severity === 'warn');
    if (warnings.length > 0) {
      if (options.json) {
        console.error(JSON.stringify({ qualityWarnings: warnings }));
      } else {
        console.error(chalk.yellow('⚠ vBRIEF quality warnings:'));
        for (const line of formatQualityIssues(warnings)) {
          console.error(chalk.yellow('  ' + line));
        }
      }
    }
  }
  if (!options.json) {
    for (const line of readinessReport) console.error(chalk.dim(line));
  }

  emitAutoPromotePhase(issueId, 'createBeads', 'start', 'creating beads from finalized vBRIEF', { workspacePath });
  // Pass the exact plan being finalized: on a re-plan, the main-side canonical
  // spec still has the OLD content until promotion, so resolving main-first
  // here would materialize beads from the superseded plan.
  const result = await Effect.runPromise(createBeadsFromVBrief(workspacePath, { planPath }));
  const autoSpawnOnFinalize = readAutoSpawnOnFinalize(issueId);

  if (!result.success || result.created.length === 0) {
    const errors = result.errors.length > 0 ? result.errors : ['Beads creation produced no tasks'];
    emitAutoPromotePhase(issueId, 'createBeads', 'failure', errors.join('; '), {
      workspacePath,
      createdCount: result.created.length,
    });
    emitAutoPromotePhase(issueId, 'terminal', 'failure', 'beads creation failed', { workspacePath });
    if (options.json) {
      console.log(JSON.stringify({ success: false, created: result.created, errors }));
    } else {
      console.error(chalk.red('✗ Beads creation failed:'));
      for (const e of errors) console.error(chalk.red('  ' + e));
    }
    process.exit(2);
  }
  emitAutoPromotePhase(issueId, 'createBeads', 'success', 'beads created', {
    workspacePath,
    createdCount: result.created.length,
  });

  // Stamp plan.status='proposed' and plan.metadata.canonicalFilename onto the
  // vBRIEF only after beads creation succeeds. Atomic temp+rename.
  const canonicalFilename = stampPlanForFinalization(planPath, issueId);

  emitActivityEntrySync({
    source: 'plan',
    level: 'info',
    message: autoSpawnOnFinalize
      ? `${issueId} planned — starting implementation`
      : `${issueId} planning finalized — awaiting your approval`,
    issueId,
  });
  emitActivityTtsSync({
    utterance: autoSpawnOnFinalize
      ? `${issueId} planned, starting implementation`
      : `${issueId} planning is done, awaiting your approval`,
    priority: 1,
    issueId,
    source: 'planning-agent',
    eventType: 'planning.finalized',
  });

  let promoted = false;
  let promoteMessage: string | null = null;
  let promoteError: string | null = null;
  let workAgentSpawned = false;
  let workAgentMessage: string | null = null;
  let workAgentError: string | null = null;
  let workAgentSkipReason: string | null = null;

  const noPromote = options.promote === false;
  if (!noPromote) {
    emitAutoPromotePhase(issueId, 'completePlanning', 'start', autoSpawnOnFinalize ? 'posting complete-planning autoSpawn request' : 'posting complete-planning request');
    const promotion = await promotePlanning(issueId, autoSpawnOnFinalize, { noPrd: options.prd === false });
    promoted = promotion.success;
    promoteMessage = promotion.message;
    promoteError = promotion.error;

    workAgentSpawned = promotion.workAgentSpawned;
    workAgentMessage = promotion.workAgentMessage;
    workAgentError = promotion.workAgentError;
    workAgentSkipReason = promotion.workAgentSkipReason;
    emitAutoPromotePhase(issueId, 'completePlanning', promoted ? 'success' : 'failure', promoted ? 'complete-planning returned success' : (promoteError ?? 'complete-planning failed'), {
      workAgentSpawned,
      workAgentSkipReason,
    });
  } else {
    emitAutoPromotePhase(issueId, 'completePlanning', 'skipped', 'promotion skipped by --no-promote');
  }

  emitAutoPromotePhase(issueId, 'terminal', promoted || noPromote ? 'success' : 'failure', promoted ? 'planning promoted' : noPromote ? 'promotion skipped' : (promoteError ?? 'promotion failed'), {
    workAgentSpawned,
    workAgentSkipReason,
  });

  if (options.json) {
    console.log(JSON.stringify({
      success: promoted || noPromote,
      created: result.created,
      count: result.created.length,
      canonicalFilename,
      planStatus: 'proposed',
      promoted,
      workAgentSpawned,
      ...(promoteMessage ? { promoteMessage } : {}),
      ...(promoteError ? { promoteError } : {}),
      ...(workAgentMessage ? { workAgentMessage } : {}),
      ...(workAgentError ? { workAgentError } : {}),
      ...(workAgentSkipReason ? { workAgentSkipReason } : {}),
    }));
  } else {
    console.log(chalk.green(`✓ Created ${result.created.length} beads task${result.created.length === 1 ? '' : 's'}`));
    for (const id of result.created) console.log(chalk.dim('  • ' + id));
    console.log(chalk.green(`✓ Set plan.status=proposed (canonical: ${canonicalFilename})`));
    console.log('');
    if (noPromote) {
      console.log(chalk.cyan('Planning is finalized. Promotion skipped (--no-promote).'));
      console.log(chalk.dim('Run `pan plan done ' + issueId + '` or click Done in the dashboard to promote.'));
    } else if (promoted) {
      console.log(chalk.green('✓ Planning promoted to main — issue is ready for implementation.'));
      if (promoteMessage) console.log(chalk.dim('  ' + promoteMessage));
      if (workAgentSpawned) {
        console.log(chalk.green('✓ Work agent spawned — implementation in progress.'));
        if (workAgentMessage) console.log(chalk.dim('  ' + workAgentMessage));
      } else if (autoSpawnOnFinalize) {
        console.log(chalk.yellow('⚠ Auto-promoted but work agent spawn was skipped.'));
        if (workAgentMessage) console.log(chalk.dim('  ' + workAgentMessage));
        if (workAgentError) console.log(chalk.dim('  ' + workAgentError));
        console.log(chalk.dim('Run `pan start ' + issueId + '` to retry the work agent spawn.'));
      } else {
        console.log(chalk.dim('Run `pan start ' + issueId + '` or click Start Agent to begin implementation.'));
      }
    } else {
      console.log(chalk.yellow('⚠ Planning finalized but auto-promotion failed.'));
      if (promoteError) console.log(chalk.dim('  ' + promoteError));
      console.log(chalk.dim('Run `pan plan done ' + issueId + '` to retry, or click Done in the dashboard.'));
    }
  }

  if (!noPromote && !promoted) {
    process.exit(1);
  }
}

/**
 * Chain plan-finalize into the dashboard's complete-planning endpoint so the
 * canonical spec is promoted to main and the issue transitions to Planned
 * without requiring a human Done click. The route defers its session kill
 * until after the response is flushed so callers running inside the planning
 * tmux session still see this response.
 */
// PAN-1972: the complete-planning POST carries the whole finalize handoff —
// promote spec, commit, transition, AND the `--auto-start` stamp. If it lands
// while the dashboard is momentarily down (e.g. mid-restart), a single fetch
// fails and the work agent never auto-starts. Retry with exponential backoff.
const PROMOTE_MAX_ATTEMPTS = 5;
const PROMOTE_BASE_DELAY_MS = 1_000;
// Retry only on transient gateway/unavailable statuses (dashboard up but not
// ready). A real 4xx or app-500 is deterministic and may have partially
// executed — do not blindly retry it.
const PROMOTE_RETRYABLE_STATUS = new Set([502, 503, 504]);

function promoteBackoffMs(completedAttempts: number): number {
  return PROMOTE_BASE_DELAY_MS * 2 ** completedAttempts; // 1s, 2s, 4s, 8s
}

const promoteFailure = (error: string): PromotePlanningResult => ({
  success: false, message: null, error,
  workAgentSpawned: false, workAgentMessage: null, workAgentError: null, workAgentSkipReason: null,
});

export async function promotePlanning(issueId: string, autoSpawn = false, opts: { noPrd?: boolean } = {}): Promise<PromotePlanningResult> {
  const url = `${getDashboardApiUrlSync()}/api/issues/${issueId}/complete-planning`;
  let lastError = 'complete-planning failed';

  for (let attempt = 0; attempt < PROMOTE_MAX_ATTEMPTS; attempt++) {
    const hasMoreAttempts = attempt < PROMOTE_MAX_ATTEMPTS - 1;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: getDashboardApiUrlSync() },
          body: JSON.stringify({ ...(autoSpawn ? { autoSpawn: true } : {}), ...(opts.noPrd ? { noPrd: true } : {}) }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const text = await response.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
      if (!response.ok) {
        const err = (parsed && (parsed.error || parsed.message)) || text.slice(0, 200) || `HTTP ${response.status}`;
        lastError = String(err);
        if (PROMOTE_RETRYABLE_STATUS.has(response.status) && hasMoreAttempts) {
          const delay = promoteBackoffMs(attempt);
          console.error(chalk.dim(`complete-planning HTTP ${response.status}; retrying in ${delay / 1000}s (attempt ${attempt + 1}/${PROMOTE_MAX_ATTEMPTS})…`));
          await new Promise<void>((r) => setTimeout(r, delay));
          continue;
        }
        return promoteFailure(lastError);
      }
      const workAgentSpawned = parsed?.workAgentSpawned === true;
      const workAgentSkipReason = typeof parsed?.workAgentSkipReason === 'string' ? parsed.workAgentSkipReason : null;
      const workAgentSession = typeof parsed?.workAgentSession === 'string' ? parsed.workAgentSession : null;
      const workAgentError = typeof parsed?.workAgentError === 'string' ? parsed.workAgentError : null;
      return {
        success: true,
        message: parsed?.message ?? null,
        error: null,
        workAgentSpawned,
        workAgentMessage: workAgentSession ? `Session: ${workAgentSession}` : (workAgentSkipReason ? `Skip reason: ${workAgentSkipReason}` : null),
        workAgentError,
        workAgentSkipReason,
      };
    } catch (err: any) {
      // A thrown fetch is a connection-level failure (dashboard unreachable /
      // ECONNREFUSED): the request never reached the server, so retrying is
      // safe. An AbortError is our own 90s timeout — the request may have
      // landed and partially executed, so do NOT retry that one.
      const isTimeout = err?.name === 'AbortError';
      const message = err?.message ? String(err.message) : String(err);
      lastError = isTimeout ? 'complete-planning timed out after 90s' : `Dashboard unreachable: ${message}`;
      if (!isTimeout && hasMoreAttempts) {
        const delay = promoteBackoffMs(attempt);
        console.error(chalk.dim(`complete-planning unreachable (${message}); retrying in ${delay / 1000}s (attempt ${attempt + 1}/${PROMOTE_MAX_ATTEMPTS})…`));
        await new Promise<void>((r) => setTimeout(r, delay));
        continue;
      }
      return promoteFailure(lastError);
    }
  }
  return promoteFailure(lastError);
}

/**
 * Set plan.status to 'proposed' and stamp the canonical filename on the plan.
 * Atomically writes back via temp+rename. Returns the canonical filename.
 *
 * Preserves an existing canonicalFilename on the plan (date stays immutable
 * once it's been set during a previous finalization).
 *
 * Exported for tests.
 */
export function stampPlanForFinalization(planPath: string, issueId: string): string {
  const doc: VBriefDocument = readPlanSync(planPath);
  const slugSource = doc.plan.title || doc.plan.id || issueId;
  const slug = slugify(slugSource);

  const existingFilename = doc.plan.metadata?.canonicalFilename ?? null;
  const canonicalFilename = existingFilename ?? generateVBriefFilename(issueId, slug);

  doc.plan.metadata = { ...(doc.plan.metadata ?? {}), canonicalFilename };

  const now = new Date().toISOString();
  doc.plan.status = 'proposed';
  doc.plan.sequence = (doc.plan.sequence ?? 0) + 1;
  doc.plan.updated = now;
  doc.vBRIEFInfo.updated = now;

  const tmp = planPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tmp, planPath);

  return canonicalFilename;
}
