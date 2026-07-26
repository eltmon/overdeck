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

  const deployDeps = initiator === 'flywheel-orchestrator'
    ? { ...deps, getFlywheelActiveRunId: () => null }
    : deps;
  const assessment = await getDeployWindowAssessment(deployDeps);
  if (!assessment.reason) return null;

  const queued = await recordDeployIntent({
    requestedBy: initiator,
    reason: assessment.reason,
    blockedBy: assessment.verifyingIssues,
  });
  const blockerCount = queued.blockedBy.length;
  const blockerLabel = blockerCount === 1 ? 'verification' : 'verifications';
  const blockerIds = blockerCount > 0 ? queued.blockedBy.join(', ') : 'none';

  return `Restart refused. The active deployment gate says: "${assessment.reason}" This deploy has been queued since ${queued.requestedAt} (${formatQueueAge(queued.requestedAt)} ago); it has been held by ${blockerCount} distinct ${blockerLabel}: ${blockerIds}. It will fire automatically at the next verification boundary — do not retry or use --force, which would kill a healthy verification mid-run.`;
}
