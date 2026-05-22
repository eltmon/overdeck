import { Effect } from 'effect';
import chalk from 'chalk';
import { existsSync, renameSync, writeFileSync } from 'fs';
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
  noPromote?: boolean;
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

  const result = await Effect.runPromise(createBeadsFromVBrief(workspacePath));

  if (!result.success || result.created.length === 0) {
    const errors = result.errors.length > 0 ? result.errors : ['Beads creation produced no tasks'];
    if (options.json) {
      console.log(JSON.stringify({ success: false, created: result.created, errors }));
    } else {
      console.error(chalk.red('✗ Beads creation failed:'));
      for (const e of errors) console.error(chalk.red('  ' + e));
    }
    process.exit(2);
  }

  emitActivityEntrySync({
    source: 'plan',
    level: 'info',
    message: `${issueId} planning finalized — awaiting your approval`,
    issueId,
  });
  emitActivityTtsSync({
    utterance: `${issueId} planning is done, awaiting your approval`,
    priority: 1,
    issueId,
    source: 'planning-agent',
    eventType: 'planning.finalized',
  });

  let promoted = false;
  let promoteMessage: string | null = null;
  let promoteError: string | null = null;

  if (!options.noPromote) {
    const promotion = await promotePlanning(issueId);
    promoted = promotion.success;
    promoteMessage = promotion.message;
    promoteError = promotion.error;
  }

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      created: result.created,
      count: result.created.length,
      canonicalFilename,
      planStatus: 'proposed',
      promoted,
      ...(promoteMessage ? { promoteMessage } : {}),
      ...(promoteError ? { promoteError } : {}),
    }));
  } else {
    console.log(chalk.green(`✓ Created ${result.created.length} beads task${result.created.length === 1 ? '' : 's'}`));
    for (const id of result.created) console.log(chalk.dim('  • ' + id));
    console.log(chalk.green(`✓ Set plan.status=proposed (canonical: ${canonicalFilename})`));
    console.log('');
    if (options.noPromote) {
      console.log(chalk.cyan('Planning is finalized. Promotion skipped (--no-promote).'));
      console.log(chalk.dim('Run `pan plan done ' + issueId + '` or click Done in the dashboard to promote.'));
    } else if (promoted) {
      console.log(chalk.green('✓ Planning promoted to main — issue is ready for implementation.'));
      if (promoteMessage) console.log(chalk.dim('  ' + promoteMessage));
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
async function promotePlanning(issueId: string): Promise<{ success: boolean; message: string | null; error: string | null }> {
  try {
    const url = `${getDashboardApiUrlSync()}/api/issues/${issueId}/complete-planning`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
      return { success: false, message: null, error: String(err) };
    }
    return { success: true, message: parsed?.message ?? null, error: null };
  } catch (err: any) {
    const message = err?.message ? String(err.message) : String(err);
    return { success: false, message: null, error: `Dashboard unreachable: ${message}` };
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
