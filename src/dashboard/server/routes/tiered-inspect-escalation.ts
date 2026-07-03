import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { decideEscalation, type EscalationAction } from '../../../lib/agents/tier-escalation.js';
import { resolveTieredExecutionEnabled } from '../../../lib/agents/tier-table.js';
import { loadConfigSync } from '../../../lib/config-yaml.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { getReviewStatusSync } from '../../../lib/review-status.js';
import {
  readTierOverrides,
  readWorkspacePlanSync,
  recordTierPromotion,
} from '../../../lib/vbrief/io.js';

export interface TieredInspectFailureEscalationDeps {
  loadConfig?: typeof loadConfigSync;
  resolveProject?: typeof resolveProjectFromIssueSync;
  exists?: typeof existsSync;
  readPlan?: typeof readWorkspacePlanSync;
  readOverrides?: typeof readTierOverrides;
  decide?: typeof decideEscalation;
  recordPromotion?: typeof recordTierPromotion;
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
  const decide = deps.decide ?? decideEscalation;
  const recordPromotion = deps.recordPromotion ?? recordTierPromotion;

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

  const beadId = notes?.match(/[Bb]ead\s+(\S+)/)?.[1];
  if (!doc || !beadId) return null;
  const item = doc.plan.items.find(candidate => candidate.id === beadId);
  if (!item) return null;

  const overrides = readOverrides(workspacePath);
  const decision = decide({
    kind: 'supervisor-blocked',
    beadId,
    sha: getReviewStatusSync(issueId)?.reviewedAtCommit ?? 'unknown',
    attemptsAtCurrentTier: tiered.escalation.retries_at_tier,
  }, item, tiered.escalation, overrides);

  if (decision.action === 'promote') {
    recordPromotion(workspacePath, beadId, decision.from, decision.to, decision.reason);
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
