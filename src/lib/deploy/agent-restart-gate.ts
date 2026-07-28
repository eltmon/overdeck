import { recordDeployIntent } from './deploy-queue.js';
import {
  getDeployWindowAssessment,
  type DeployWindowDependencies,
} from './deploy-window.js';

export interface AgentRestartGateInput {
  initiator: string | undefined;
  force: boolean;
}

function formatQueueAge(requestedAt: string): string {
  const ageMs = Math.max(0, Date.now() - Date.parse(requestedAt));
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return `${Math.floor(ageMs / 1_000)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export async function agentRestartBlockReason(
  input: AgentRestartGateInput,
  deps: Partial<DeployWindowDependencies> = {},
): Promise<string | null> {
  const initiator = input.initiator?.trim();
  if (!initiator || input.force) return null;

  const assessment = await getDeployWindowAssessment(deps);
  if (!assessment.reason) return null;

  const queued = await recordDeployIntent({
    requestedBy: initiator,
    reason: assessment.reason,
    blockedBy: [],
  });

  return `Restart refused. The active deployment gate says: "${assessment.reason}" This deploy has been queued since ${queued.requestedAt} (${formatQueueAge(queued.requestedAt)} ago); it fires automatically as soon as the window clears — do not retry or use --force, which would interrupt the operation the gate is protecting.`;
}
