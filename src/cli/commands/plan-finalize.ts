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
import { PAN_DIRNAME, PAN_SPEC_FILENAME } from '../../lib/pan-dir/index.js';
import type { VBriefDocument } from '../../lib/vbrief/types.js';

interface PlanFinalizeOptions {
  workspace?: string;
  json?: boolean;
  /** Commander negation: `--no-promote` arrives as `promote: false` (default true). */
  promote?: boolean;
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

function readAutoSpawnOnFinalize(issueId: string): boolean {
  const panopticonHome = process.env.PANOPTICON_HOME ?? join(homedir(), '.panopticon');
  const stateFile = join(panopticonHome, 'agents', `planning-${issueId.toLowerCase()}`, 'state.json');
  try {
    if (!existsSync(stateFile)) return false;
    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as { autoSpawnOnFinalize?: unknown };
    return state.autoSpawnOnFinalize === true;
  } catch {
    return false;
  }
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

  if (!options.json) {
    console.log(chalk.dim(`workspace: ${workspacePath}`));
    console.log(chalk.dim('finalizing vBRIEF and creating beads…'));
  }

  // Stamp plan.status='proposed' and plan.metadata.canonicalFilename onto the
  // vBRIEF before beads creation. Atomic temp+rename.
  const canonicalFilename = stampPlanForFinalization(planPath, issueId);

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
    const promotion = await promotePlanning(issueId, autoSpawnOnFinalize);
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
      success: true,
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
}

/**
 * Chain plan-finalize into the dashboard's complete-planning endpoint so the
 * canonical spec is promoted to main and the issue transitions to Planned
 * without requiring a human Done click. The route defers its session kill
 * until after the response is flushed so callers running inside the planning
 * tmux session still see this response.
 */
export async function promotePlanning(issueId: string, autoSpawn = false): Promise<PromotePlanningResult> {
  try {
    const url = `${getDashboardApiUrlSync()}/api/issues/${issueId}/complete-planning`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: getDashboardApiUrlSync() },
        body: JSON.stringify(autoSpawn ? { autoSpawn: true } : {}),
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
      return {
        success: false,
        message: null,
        error: String(err),
        workAgentSpawned: false,
        workAgentMessage: null,
        workAgentError: null,
        workAgentSkipReason: null,
      };
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
    const message = err?.message ? String(err.message) : String(err);
    return {
      success: false,
      message: null,
      error: `Dashboard unreachable: ${message}`,
      workAgentSpawned: false,
      workAgentMessage: null,
      workAgentError: null,
      workAgentSkipReason: null,
    };
  }
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
