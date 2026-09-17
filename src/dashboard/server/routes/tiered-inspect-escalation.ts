import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { decideEscalation, decideVerificationFailureEscalation, type EscalationAction } from '../../../lib/agents/tier-escalation.js';
import { selectHardestPlanItem } from '../../../lib/agents/spawn-prep.js';
import { resolveTieredExecutionEnabled } from '../../../lib/agents/tier-table.js';
import { loadConfigSync } from '../../../lib/config-yaml.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { getReviewStatusSync } from '../../../lib/review-status.js';
import {
  readTierOverrides,
  readTierRetries,
  readWorkspacePlanSync,
  recordTierPromotion,
  recordTierRetry,
} from '../../../lib/xbrief/io.js';

export interface TieredInspectFailureEscalationDeps {
  loadConfig?: typeof loadConfigSync;
  resolveProject?: typeof resolveProjectFromIssueSync;
  exists?: typeof existsSync;
  readPlan?: typeof readWorkspacePlanSync;
  readOverrides?: typeof readTierOverrides;
  readRetries?: typeof readTierRetries;
  decide?: typeof decideEscalation;
  recordPromotion?: typeof recordTierPromotion;
  recordRetry?: typeof recordTierRetry;
  /** Reviewed-commit lookup for the escalation reason; injectable for tests. */
  readReviewedCommit?: (issueId: string) => string | undefined;
}

export function handleTieredInspectFailureEscalation(
  issueId: string,
  notes: string | undefined,
  deps: TieredInspectFailureEscalationDeps = {},
): EscalationAction | null {
  const loadConfig = deps.loadConfig ?? loadConfigSync;
  const resolveProject = deps.resolveProject ?? resolveProjectFromIssueSync;
  const exists = deps.exists ?? existsSync;
  const readPlan = deps.readPlan ?? readWorkspacePlanSync;
  const readOverrides = deps.readOverrides ?? readTierOverrides;
  const readRetries = deps.readRetries ?? readTierRetries;
  const decide = deps.decide ?? decideEscalation;
  const recordPromotion = deps.recordPromotion ?? recordTierPromotion;
  const recordRetry = deps.recordRetry ?? recordTierRetry;
  const readReviewedCommit = deps.readReviewedCommit
    ?? ((id: string) => getReviewStatusSync(id)?.reviewedAtCommit ?? undefined);

  const tiered = loadConfig().config.tieredExecution;
  if (!tiered.escalation.enabled) return null;

  const project = resolveProject(issueId);
  if (!project) return null;
  const workspacePath = join(
    project.projectPath,
    'workspaces',
    `feature-${issueId.toLowerCase()}`,
  );
  if (!exists(workspacePath)) return null;

  const doc = readPlan(workspacePath);
  if (!resolveTieredExecutionEnabled(tiered, doc?.plan.metadata)) return null;

  const taskId = notes?.match(/[Bb]ead\s+(\S+)/)?.[1];
  if (!doc || !taskId) return null;
  const item = doc.plan.items.find(candidate => candidate.id === taskId);
  if (!item) return null;

  const overrides = readOverrides(workspacePath);
  // PAN-3858: pass the real recorded attempt count, not the configured retry
  // budget — passing `retries_at_tier` here made the retry branch of
  // decideEscalation unreachable, so every first failure promoted immediately.
  const effectiveDifficulty = overrides[taskId]?.effectiveDifficulty ?? item.metadata?.difficulty;
  const recordedRetry = readRetries(workspacePath)[taskId];
  const attemptsAtCurrentTier = recordedRetry && recordedRetry.difficulty === effectiveDifficulty
    ? recordedRetry.attempts
    : 0;
  const decision = decide({
    kind: 'supervisor-blocked',
    itemId: taskId,
    sha: readReviewedCommit(issueId) ?? 'unknown',
    attemptsAtCurrentTier,
  }, item, tiered.escalation, overrides);

  if (decision.action === 'promote') {
    recordPromotion(workspacePath, taskId, decision.from, decision.to, decision.reason);
  } else if (decision.action === 'retry' && effectiveDifficulty) {
    recordRetry(workspacePath, taskId, effectiveDifficulty, decision.attempt);
  }

  return decision;
}

export async function reportTieredInspectFailureEscalation(
  issueId: string,
  notes: string | undefined,
  deps: TieredInspectFailureEscalationDeps = {},
): Promise<void> {
  try {
    const decision = handleTieredInspectFailureEscalation(issueId, notes, deps);
    if (decision) {
      console.log(`[specialists/done] Tier escalation decision for ${issueId}: ${decision.action}`);
    }
  } catch (err) {
    console.warn(`[specialists/done] Tier escalation handling failed for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface TieredVerificationFailureEscalationDeps {
  loadConfig?: typeof loadConfigSync;
  exists?: typeof existsSync;
  readPlan?: typeof readWorkspacePlanSync;
  readOverrides?: typeof readTierOverrides;
  readRetries?: typeof readTierRetries;
  decide?: typeof decideVerificationFailureEscalation;
  recordPromotion?: typeof recordTierPromotion;
  recordRetry?: typeof recordTierRetry;
  selectItem?: typeof selectHardestPlanItem;
}

/**
 * Verification-failed escalation (PAN-3858). Verification runs against the
 * whole submitted diff, so the failure is attributed to the plan's hardest
 * item (status-blind: items are already marked completed at verification
 * time). A promotion there raises the tier of the respawn that fixes the
 * failure. Shares the retry-attempt store with the supervisor-blocked path.
 */
export function handleTieredVerificationFailureEscalation(
  issueId: string,
  workspacePath: string,
  detail: string,
  deps: TieredVerificationFailureEscalationDeps = {},
): EscalationAction | null {
  const loadConfig = deps.loadConfig ?? loadConfigSync;
  const exists = deps.exists ?? existsSync;
  const readPlan = deps.readPlan ?? readWorkspacePlanSync;
  const readOverrides = deps.readOverrides ?? readTierOverrides;
  const readRetries = deps.readRetries ?? readTierRetries;
  const decide = deps.decide ?? decideVerificationFailureEscalation;
  const recordPromotion = deps.recordPromotion ?? recordTierPromotion;
  const recordRetry = deps.recordRetry ?? recordTierRetry;
  const selectItem = deps.selectItem ?? selectHardestPlanItem;

  const tiered = loadConfig().config.tieredExecution;
  if (!tiered.escalation.enabled) return null;
  if (!exists(workspacePath)) return null;

  const doc = readPlan(workspacePath);
  if (!resolveTieredExecutionEnabled(tiered, doc?.plan.metadata)) return null;
  if (!doc) return null;

  const overrides = readOverrides(workspacePath);
  const item = selectItem(doc, tiered, overrides);
  if (!item) return null;

  const effectiveDifficulty = overrides[item.id]?.effectiveDifficulty ?? item.metadata?.difficulty;
  const recordedRetry = readRetries(workspacePath)[item.id];
  const attemptsAtCurrentTier = recordedRetry && recordedRetry.difficulty === effectiveDifficulty
    ? recordedRetry.attempts
    : 0;
  const decision = decide({
    bead: item,
    config: tiered.escalation,
    overrides,
    detail,
    attemptsAtCurrentTier,
  });

  if (decision.action === 'promote') {
    recordPromotion(workspacePath, item.id, decision.from, decision.to, decision.reason);
  } else if (decision.action === 'retry' && effectiveDifficulty) {
    recordRetry(workspacePath, item.id, effectiveDifficulty, decision.attempt);
  }

  return decision;
}

export async function reportTieredVerificationFailureEscalation(
  issueId: string,
  workspacePath: string,
  detail: string,
  deps: TieredVerificationFailureEscalationDeps = {},
): Promise<void> {
  try {
    const decision = handleTieredVerificationFailureEscalation(issueId, workspacePath, detail, deps);
    if (decision) {
      console.log(`[review] Tier escalation decision for ${issueId}: ${decision.action}`);
    }
  } catch (err) {
    console.warn(`[review] Tier escalation handling failed for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
