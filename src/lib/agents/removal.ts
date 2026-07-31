import { join } from 'node:path';

import {
  markRetainedTranscripts,
  removeAgentStateDir,
  type RemoveAgentStateDirResult,
} from './state-dir-removal.js';
import { getAgentStateSync } from './agent-state.js';
import {
  ensureAgentTombstoneSync,
  type AgentTombstoneIdentity,
} from '../overdeck/agent-tombstones.js';
import { listAllAgentsSync, removeAgentRecordSync } from '../overdeck/agents.js';
import { getOverdeckHome } from '../paths.js';

function resolveTombstoneIdentity(agentId: string): AgentTombstoneIdentity | null {
  const source = listAllAgentsSync().find((agent) => agent.id === agentId) ?? getAgentStateSync(agentId);
  if (!source || source.id !== agentId) return null;
  const fields = [source.issueId, source.role, source.workspace, source.harness, source.model];
  if (fields.some((value) => typeof value !== 'string' || value.length === 0)) return null;
  return {
    id: agentId,
    issueId: source.issueId,
    role: source.role,
    workspace: source.workspace,
    harness: source.harness,
    model: source.model,
  } as AgentTombstoneIdentity;
}

/**
 * Remove runtime residue while retaining every JSONL transcript and its registry
 * linkage. The row becomes a stopped tombstone until configured retention expires
 * the final transcript; a fully removed directory permits immediate row removal.
 */
export async function removeAgent(agentId: string): Promise<RemoveAgentStateDirResult> {
  const identity = resolveTombstoneIdentity(agentId);
  if (identity === null) {
    throw new Error(`removeAgent: cannot preserve transcript linkage for ${agentId}`);
  }
  ensureAgentTombstoneSync(identity);

  const agentsDir = join(getOverdeckHome(), 'agents');
  const agentDir = join(agentsDir, agentId);
  const result = await removeAgentStateDir(agentDir, agentsDir);
  if (result.removedDir) removeAgentRecordSync(agentId);
  else await markRetainedTranscripts(agentDir);
  return result;
}
