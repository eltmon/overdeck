import {
  getDeployBlockReason,
  type DeployWindowDependencies,
} from './deploy-window.js';

export interface AgentRestartGateInput {
  initiator: string | undefined;
  force: boolean;
}

export async function agentRestartBlockReason(
  input: AgentRestartGateInput,
  deps: Partial<DeployWindowDependencies> = {},
): Promise<string | null> {
  const initiator = input.initiator?.trim();
  if (!initiator || input.force) return null;

  const blockReason = await getDeployBlockReason(
    initiator === 'flywheel-orchestrator'
      ? { ...deps, getFlywheelActiveRunId: () => null }
      : deps,
  );
  if (!blockReason) return null;

  return `Restart refused. The active deployment gate says: "${blockReason}" This agent-issued restart would disconnect live sessions while that gate is active. Rerun with --force to bypass the gate.`;
}
