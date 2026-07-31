import { join } from 'node:path';

import { listAllAgentsSync, removeAgentRecordSync } from '../overdeck/agents.js';
import { readIssueRecordForWorkspaceSync } from '../pan-dir/record.js';
import { getOverdeckHome } from '../paths.js';
import {
  removeAgentStateDir,
  type RemoveAgentStateDirResult,
} from '../agents/state-dir-removal.js';

export interface AgentGcResult { removed: string[]; preserved: string[] }
export interface AgentGcRow { id: string; issueId: string; status: string; workspace?: string | null }

export interface AgentGcDeps {
  agentsDir: string;
  cleanStateDir: (dirPath: string, agentsDir: string) => Promise<RemoveAgentStateDirResult>;
  removeRecord: (id: string) => void;
  isTerminalAgent: (agent: AgentGcRow) => boolean;
}

function defaultAgentGcDeps(): AgentGcDeps {
  return {
    agentsDir: join(getOverdeckHome(), 'agents'),
    cleanStateDir: removeAgentStateDir,
    removeRecord: removeAgentRecordSync,
    isTerminalAgent: (agent) => Boolean(agent.status === 'stopped' && agent.workspace
      && readIssueRecordForWorkspaceSync(agent.workspace, agent.issueId)?.pipeline?.closedOut === true),
  };
}

export async function pruneAgentRowsAfterTranscriptCleanup(
  agents: readonly AgentGcRow[],
  deps: AgentGcDeps = defaultAgentGcDeps(),
): Promise<AgentGcResult> {
  const removed: string[] = [];
  const preserved: string[] = [];
  for (const agent of agents) {
    try {
      const result = await deps.cleanStateDir(join(deps.agentsDir, agent.id), deps.agentsDir);
      if (!result.removedDir) {
        preserved.push(agent.id);
        continue;
      }
      deps.removeRecord(agent.id);
      removed.push(agent.id);
    } catch {
      preserved.push(agent.id);
    }
  }
  return { removed, preserved };
}

export async function pruneStoppedAgentsForIssue(
  issueId: string,
  agents: AgentGcRow[] = listAllAgentsSync(),
  deps: AgentGcDeps = defaultAgentGcDeps(),
): Promise<AgentGcResult> {
  const issue = issueId.toUpperCase();
  const scoped = agents.filter(agent => agent.issueId.toUpperCase() === issue);
  const terminal = scoped.filter(agent => agent.status === 'stopped');
  const live = scoped.filter(agent => agent.status !== 'stopped').map(agent => agent.id);
  const result = await pruneAgentRowsAfterTranscriptCleanup(terminal, deps);
  return { removed: result.removed, preserved: [...live, ...result.preserved] };
}

export async function pruneTerminalStoppedAgents(
  agents: AgentGcRow[] = listAllAgentsSync(),
  deps: AgentGcDeps = defaultAgentGcDeps(),
): Promise<AgentGcResult> {
  const terminal = agents.filter(deps.isTerminalAgent);
  return pruneAgentRowsAfterTranscriptCleanup(terminal, deps);
}
