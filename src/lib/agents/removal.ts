import { join } from 'node:path';

import {
  markRetainedTranscripts,
  removeAgentStateDir,
  type RemoveAgentStateDirResult,
} from './state-dir-removal.js';
import {
  removeAgentRecordSync,
  tombstoneAgentRecordSync,
} from '../overdeck/agents.js';
import { getOverdeckHome } from '../paths.js';

/**
 * Remove runtime residue while retaining every JSONL transcript and its registry
 * linkage. The row becomes a stopped tombstone until configured retention expires
 * the final transcript; a fully removed directory permits immediate row removal.
 */
export async function removeAgent(agentId: string): Promise<RemoveAgentStateDirResult> {
  const agentsDir = join(getOverdeckHome(), 'agents');
  const agentDir = join(agentsDir, agentId);
  const result = await removeAgentStateDir(agentDir, agentsDir);
  if (result.removedDir) removeAgentRecordSync(agentId);
  else {
    await markRetainedTranscripts(agentDir);
    tombstoneAgentRecordSync(agentId);
  }
  return result;
}
