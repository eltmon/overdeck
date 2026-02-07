/**
 * Remote Agent Management
 *
 * Spawn and manage Claude agents on remote exe.dev VMs.
 * Agents run in tmux sessions for persistence and monitoring.
 */

import { ExeProvider, createExeProvider } from './exe-provider.js';
import type { RemoteWorkspaceMetadata } from './interface.js';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';

const AGENTS_DIR = join(homedir(), '.panopticon', 'agents');

export interface RemoteAgentState {
  id: string;
  issueId: string;
  vmName: string;
  model: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  lastActivity?: string;
  location: 'remote';
}

/**
 * Get agent state file path
 */
function getRemoteAgentStateFile(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'remote-state.json');
}

/**
 * Save remote agent state
 */
function saveRemoteAgentState(state: RemoteAgentState): void {
  const dir = join(AGENTS_DIR, state.id);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getRemoteAgentStateFile(state.id), JSON.stringify(state, null, 2));
}

/**
 * Load remote agent state
 */
export function loadRemoteAgentState(agentId: string): RemoteAgentState | null {
  const file = getRemoteAgentStateFile(agentId);
  if (!existsSync(file)) return null;

  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Check if remote agent session exists
 */
async function remoteSessionExists(
  exe: ExeProvider,
  vmName: string,
  sessionName: string
): Promise<boolean> {
  const result = await exe.ssh(vmName, `tmux has-session -t ${sessionName} 2>/dev/null && echo exists || echo not-found`);
  return result.stdout.trim() === 'exists';
}

export interface SpawnRemoteAgentOptions {
  issueId: string;
  workspace: RemoteWorkspaceMetadata;
  model?: string;
  prompt?: string;
  phase?: string;
}

/**
 * Spawn a Claude agent on a remote VM
 */
export async function spawnRemoteAgent(options: SpawnRemoteAgentOptions): Promise<RemoteAgentState> {
  const { issueId, workspace, model = 'claude-sonnet-4-5', prompt } = options;

  const agentId = `agent-${issueId.toLowerCase()}`;
  const vmName = workspace.vmName;

  const exe = createExeProvider({ infraVm: workspace.infraVm });

  // Check if VM is running
  const vmStatus = await exe.getStatus(vmName);
  if (vmStatus !== 'running') {
    throw new Error(`VM ${vmName} is not running. Start it with: pan workspace start ${issueId}`);
  }

  // Check if agent already exists
  if (await remoteSessionExists(exe, vmName, agentId)) {
    throw new Error(`Agent ${agentId} already running on ${vmName}. Use 'pan work tell' to message it.`);
  }

  // Create agent state
  const state: RemoteAgentState = {
    id: agentId,
    issueId,
    vmName,
    model,
    status: 'starting',
    startedAt: new Date().toISOString(),
    location: 'remote',
  };

  saveRemoteAgentState(state);

  // Write prompt to file on remote VM if provided
  let claudeCmd: string;

  if (prompt) {
    // Write prompt to file on VM using base64 to avoid escaping issues
    const promptFile = `/workspace/.panopticon/prompts/${agentId}.md`;
    await exe.ssh(vmName, `mkdir -p /workspace/.panopticon/prompts`);
    const promptBase64 = Buffer.from(prompt).toString('base64');
    await exe.ssh(vmName, `echo '${promptBase64}' | base64 -d > ${promptFile}`);

    // Create launcher script using base64 to avoid shell interpretation
    const launcherScript = `/workspace/.panopticon/prompts/${agentId}-launcher.sh`;
    const launcherContent = `#!/bin/bash
export PATH="/usr/local/bin:\$PATH"
prompt=\$(cat "${promptFile}")
exec claude --dangerously-skip-permissions --model ${model} "\$prompt"
`;
    const launcherBase64 = Buffer.from(launcherContent).toString('base64');
    await exe.ssh(vmName, `echo '${launcherBase64}' | base64 -d > ${launcherScript} && chmod +x ${launcherScript}`);

    claudeCmd = `bash ${launcherScript}`;
  } else {
    claudeCmd = `claude --dangerously-skip-permissions --model ${model}`;
  }

  // Create tmux session on remote VM
  const tmuxCmd = `tmux new-session -d -s ${agentId} -c /workspace '${claudeCmd}'`;
  const result = await exe.ssh(vmName, tmuxCmd);

  if (result.exitCode !== 0) {
    state.status = 'error';
    saveRemoteAgentState(state);
    throw new Error(`Failed to start agent: ${result.stderr}`);
  }

  // Update status
  state.status = 'running';
  saveRemoteAgentState(state);

  return state;
}

/**
 * Get remote agent output from tmux session
 */
export async function getRemoteAgentOutput(
  agentId: string,
  vmName: string,
  lines: number = 100
): Promise<string> {
  const exe = createExeProvider();

  const result = await exe.ssh(vmName, `tmux capture-pane -t ${agentId} -p -S -${lines}`);
  return result.stdout;
}

/**
 * Send message to remote agent
 */
export async function sendToRemoteAgent(
  agentId: string,
  vmName: string,
  message: string
): Promise<void> {
  const exe = createExeProvider();

  // Escape message for shell
  const escapedMessage = message.replace(/'/g, "'\\''");

  // Send keys to tmux session (send message then Enter)
  await exe.ssh(vmName, `tmux send-keys -t ${agentId} '${escapedMessage}'`);
  await exe.ssh(vmName, `tmux send-keys -t ${agentId} C-m`);
}

/**
 * Check if remote agent is still running
 */
export async function isRemoteAgentRunning(
  agentId: string,
  vmName: string
): Promise<boolean> {
  const exe = createExeProvider();
  return remoteSessionExists(exe, vmName, agentId);
}

/**
 * Kill remote agent session
 */
export async function killRemoteAgent(
  agentId: string,
  vmName: string
): Promise<void> {
  const exe = createExeProvider();
  await exe.ssh(vmName, `tmux kill-session -t ${agentId} 2>/dev/null || true`);

  // Update state
  const state = loadRemoteAgentState(agentId);
  if (state) {
    state.status = 'stopped';
    saveRemoteAgentState(state);
  }
}

/**
 * Get list of running remote agents on a VM
 */
export async function listRemoteAgents(vmName: string): Promise<string[]> {
  const exe = createExeProvider();

  const result = await exe.ssh(vmName, `tmux list-sessions -F "#{session_name}" 2>/dev/null | grep "^agent-" || true`);
  if (!result.stdout.trim()) {
    return [];
  }

  return result.stdout.trim().split('\n').filter(Boolean);
}

/**
 * Poll remote agent for status updates
 * Returns parsed events from the agent output
 */
export async function pollRemoteAgentStatus(
  agentId: string,
  vmName: string
): Promise<{
  isRunning: boolean;
  lastOutput: string;
  toolUses: string[];
}> {
  const exe = createExeProvider();

  // Check if session exists
  const isRunning = await remoteSessionExists(exe, vmName, agentId);

  if (!isRunning) {
    return { isRunning: false, lastOutput: '', toolUses: [] };
  }

  // Get recent output
  const output = await getRemoteAgentOutput(agentId, vmName, 50);

  // Parse tool uses from output (simple pattern matching)
  const toolUses: string[] = [];
  const toolPattern = /(?:Using|Calling|Running)\s+(\w+)\s+tool/gi;
  let match;
  while ((match = toolPattern.exec(output)) !== null) {
    toolUses.push(match[1]);
  }

  return {
    isRunning,
    lastOutput: output,
    toolUses,
  };
}
