import { messageAgent } from '../agents/messaging.js';
import { spawnRun } from '../agents/spawn.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { listSessionNamesSync } from '../tmux.js';
import { buildWorkAgentPrompt } from './work-agent-prompt.js';

export interface EnsureSwarmForemanDeps {
  listSessionNamesSync: () => string[];
  messageAgent: typeof messageAgent;
  buildWorkAgentPrompt: typeof buildWorkAgentPrompt;
  spawnRun: typeof spawnRun;
  resolveProjectFromIssueSync: typeof resolveProjectFromIssueSync;
}

const defaultDeps: EnsureSwarmForemanDeps = {
  // Keep the binding lazy so importing Deacon does not force unrelated tests
  // with focused tmux mocks to provide this foreman-only dependency.
  listSessionNamesSync: () => listSessionNamesSync(),
  messageAgent,
  buildWorkAgentPrompt,
  spawnRun,
  resolveProjectFromIssueSync,
};

export async function ensureSwarmForeman(
  issueId: string,
  workspacePath: string,
  options: { startedBy: string; prompt?: string },
  deps: EnsureSwarmForemanDeps = defaultDeps,
): Promise<string[]> {
  const issue = issueId.toUpperCase();
  const agentId = `agent-${issue.toLowerCase()}`;
  if (deps.listSessionNamesSync().includes(agentId)) {
    await deps.messageAgent(agentId, options.prompt ?? `Continue managing ${issue} as its swarm foreman. Run pan swarm status ${issue} --json before acting.`, 'pan-swarm');
    return [`[swarm] attached to live foreman ${agentId} for ${issue}`];
  }
  const basePrompt = await deps.buildWorkAgentPrompt({
    issueId: issue,
    env: 'LOCAL',
    workspacePath,
    projectRoot: deps.resolveProjectFromIssueSync(issue)?.projectPath,
  });
  const state = await deps.spawnRun(issue, 'work', {
    workspace: workspacePath,
    prompt: options.prompt ? `${basePrompt}\n\n${options.prompt}` : basePrompt,
    foreman: true,
    startedBy: options.startedBy,
  });
  return [`[swarm] spawned foreman ${state.id} for ${issue}`];
}
