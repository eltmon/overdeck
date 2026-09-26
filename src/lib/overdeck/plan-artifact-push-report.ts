/**
 * Surfacing `pushPlanArtifacts` trouble on the dashboard (PAN-4224).
 *
 * The CLI verbs that write `.pan/` artifacts (backlog sequence, order books)
 * only ever printed push problems to stderr, so an operator who wasn't
 * watching that terminal never learned the plan home had drifted. This turns
 * a `PushPlanArtifactsResult` into a warning message, and files it as a
 * dashboard activity entry.
 */

import { createHash } from 'node:crypto';
import { emitActivityEntryOncePortable } from '../activity-logger.js';
import type { PlanArtifactBackup, PushPlanArtifactsResult } from './plan-artifact-commit.js';

export interface PlanArtifactPushDescription {
  readonly message: string;
  readonly details?: string;
}

function backupNote(backedUp: readonly PlanArtifactBackup[]): { readonly note: string; readonly details: string } {
  const [{ path, backup }] = backedUp;
  const backupDir = backup.slice(0, backup.length - path.length - 1);
  return {
    note: `moved ${backedUp.length} untracked .pan/ file(s) that differed from origin to ${backupDir}`,
    details: backedUp.map((entry) => `${entry.path} -> ${entry.backup}`).join('\n'),
  };
}

/**
 * Describe a `pushPlanArtifacts` result as an operator-facing warning, or
 * `null` when there's nothing worth surfacing: a clean push, or a plain
 * "nothing to push" skip.
 */
export function describePlanArtifactPush(push: PushPlanArtifactsResult): PlanArtifactPushDescription | null {
  const problem = push.pushed ? push.warning : push.skipped ? undefined : push.reason;
  const backedUp = push.backedUp;

  if (!problem && !backedUp?.length) return null;

  const parts = [...(problem ? [problem] : [])];
  let details: string | undefined;
  if (backedUp?.length) {
    const { note, details: backupDetails } = backupNote(backedUp);
    parts.push(note);
    details = backupDetails;
  }
  return { message: parts.join('; '), details };
}

/**
 * Describe the push, and — when there's something worth flagging — file it as
 * a dashboard activity warning. The emit is idempotent per plan home and
 * message, so a caller can invoke this on every push without duplicating
 * entries when nothing changed. The emit outcome is not the caller's concern:
 * this never blocks or fails the push itself on it.
 */
export async function surfacePlanArtifactPush(
  push: PushPlanArtifactsResult,
  options: { readonly planHome: string; readonly command: string },
): Promise<PlanArtifactPushDescription | null> {
  const description = describePlanArtifactPush(push);
  if (!description) return null;

  const digest = createHash('sha1').update(`${options.planHome}\n${description.message}`).digest('hex').slice(0, 12);
  await emitActivityEntryOncePortable({
    id: `plan-artifact-push:${digest}`,
    source: 'plan-artifacts',
    level: 'warn',
    command: options.command,
    message: `Plan home ${options.planHome}: ${description.message}`,
    details: description.details,
  });

  return description;
}
