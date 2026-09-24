import { join } from 'node:path';

import {
  markRetainedTranscripts,
  removeAgentStateDir,
  type RemoveAgentStateDirResult,
} from './state-dir-removal.js';
import { getOverdeckHome } from '../paths.js';

/**
 * Remove runtime residue while retaining every JSONL transcript.
 *
 * PAN-3917: the transcript linkage used to be an overdeck.db row kept alive as
 * a stopped tombstone. The row is gone, so the retained-transcripts marker on
 * the state directory carries the linkage on its own: a directory that could
 * not be fully removed is marked retained, and one that was removed needs no
 * bookkeeping at all.
 */
export async function removeAgent(agentId: string): Promise<RemoveAgentStateDirResult> {
  const agentsDir = join(getOverdeckHome(), 'agents');
  const agentDir = join(agentsDir, agentId);
  const result = await removeAgentStateDir(agentDir, agentsDir);
  if (!result.removedDir) await markRetainedTranscripts(agentDir);
  return result;
}
