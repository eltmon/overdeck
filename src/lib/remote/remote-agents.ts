/**
 * Remote Agent Management
 *
 * Spawn and manage Claude agents on remote Fly.io machines.
 * Agents run in tmux sessions for persistence and monitoring.
 */

import { createFlyProvider } from './fly-provider.js';
import type { RemoteProvider, RemoteWorkspaceMetadata } from './interface.js';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { getManagedTmuxSocketName } from '../tmux.js';
import { generateLauncherScript } from '../launcher-generator.js';

const AGENTS_DIR = join(homedir(), '.panopticon', 'agents');
const REMOTE_PAN_DIR = '/workspace/.pan';
const REMOTE_TMUX_DIR = `${REMOTE_PAN_DIR}/tmux`;
const REMOTE_TMUX_CONFIG_PATH = `${REMOTE_TMUX_DIR}/panopticon.tmux.conf`;
const REMOTE_TMUX_CONFIG_CONTENT = [
  '# Panopticon-managed tmux config',
  '# Keep this minimal and include only behavior Panopticon intentionally depends on.',
  'set -g mouse on',
  '',
].join('\n');

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
  provider: RemoteProvider,
  vmName: string,
  sessionName: string
): Promise<boolean> {
  await ensureRemoteTmuxContext(provider, vmName);
  const result = await provider.ssh(
    vmName,
    `${buildRemoteTmuxCommand(['has-session', '-t', sessionName])} 2>/dev/null && echo exists || echo not-found`
  );
  return result.stdout.trim() === 'exists';
}

export interface SpawnRemoteAgentOptions {
  issueId: string;
  workspace: RemoteWorkspaceMetadata;
  model?: string;
  prompt?: string;
  phase?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getRemoteTmuxBaseArgs(): string[] {
  return ['-L', getManagedTmuxSocketName(), '-f', REMOTE_TMUX_CONFIG_PATH];
}

function buildRemoteTmuxCommand(args: string[]): string {
  return ['tmux', ...getRemoteTmuxBaseArgs(), ...args].map(shellQuote).join(' ');
}

async function ensureRemoteTmuxContext(provider: RemoteProvider, vmName: string): Promise<void> {
  const configBase64 = Buffer.from(REMOTE_TMUX_CONFIG_CONTENT).toString('base64');
  await provider.ssh(
    vmName,
    `mkdir -p ${shellQuote(REMOTE_TMUX_DIR)} && echo ${shellQuote(configBase64)} | base64 -d > ${shellQuote(REMOTE_TMUX_CONFIG_PATH)}`
  );
}

/**
 * Spawn a Claude agent on a remote VM
 */
export async function spawnRemoteAgent(options: SpawnRemoteAgentOptions): Promise<RemoteAgentState> {
  const { issueId, workspace, model = 'claude-sonnet-4-6', prompt } = options;

  const agentId = `agent-${issueId.toLowerCase()}`;
  const vmName = workspace.vmName;

  const fly = createFlyProvider();

  // Check if VM is running
  const vmStatus = await fly.getStatus(vmName);
  if (vmStatus !== 'running') {
    throw new Error(`VM ${vmName} is not running. Start it with: pan workspace start ${issueId}`);
  }

  // Check if agent already exists
  if (await remoteSessionExists(fly, vmName, agentId)) {
    throw new Error(`Agent ${agentId} already running on ${vmName}. Use 'pan tell' to message it.`);
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
    const promptFile = `/workspace/.pan/prompts/${agentId}.md`;
    await fly.ssh(vmName, `mkdir -p /workspace/.pan/prompts`);
    const promptBase64 = Buffer.from(prompt).toString('base64');
    await fly.ssh(vmName, `echo '${promptBase64}' | base64 -d > ${promptFile}`);

    // Create launcher script using base64 to avoid shell interpretation
    const launcherScript = `/workspace/.pan/prompts/${agentId}-launcher.sh`;
    const launcherContent = generateLauncherScript({
      agentType: 'remote',
      workingDir: '/workspace',
      changeDir: false,
      setRemotePath: true,
      promptFile,
      baseCommand: 'claude',
      permissionFlags: ['--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions'],
      model,
    });
    const launcherBase64 = Buffer.from(launcherContent).toString('base64');
    await fly.ssh(vmName, `echo '${launcherBase64}' | base64 -d > ${launcherScript} && chmod +x ${launcherScript}`);

    claudeCmd = `bash ${launcherScript}`;
  } else {
    claudeCmd = `claude --dangerously-skip-permissions --permission-mode bypassPermissions --model ${model}`;
  }

  console.log(`[claude-invoke] purpose=remote-agent | model=${model} | source=remote-agents.ts | vm=${vmName} | agent=${agentId} | command="${claudeCmd}"`);

  await ensureRemoteTmuxContext(fly, vmName);

  // Create tmux session on remote VM
  const tmuxCmd = buildRemoteTmuxCommand(['new-session', '-d', '-s', agentId, '-c', '/workspace', claudeCmd]);
  const result = await fly.ssh(vmName, tmuxCmd);

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
  const fly = createFlyProvider();
  await ensureRemoteTmuxContext(fly, vmName);

  const result = await fly.ssh(vmName, buildRemoteTmuxCommand(['capture-pane', '-t', agentId, '-p', '-S', `-${lines}`]));
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
  const fly = createFlyProvider();
  await ensureRemoteTmuxContext(fly, vmName);

  const promptFile = `${REMOTE_PAN_DIR}/prompts/${agentId}-message.txt`;
  const messageBase64 = Buffer.from(message).toString('base64');
  await fly.ssh(
    vmName,
    `mkdir -p ${shellQuote(`${REMOTE_PAN_DIR}/prompts`)} && echo ${shellQuote(messageBase64)} | base64 -d > ${shellQuote(promptFile)}`
  );
  await fly.ssh(vmName, buildRemoteTmuxCommand(['load-buffer', '-b', agentId, promptFile]));
  await fly.ssh(vmName, buildRemoteTmuxCommand(['paste-buffer', '-b', agentId, '-t', agentId, '-d']));
  await new Promise(resolve => setTimeout(resolve, 300));
  await fly.ssh(vmName, buildRemoteTmuxCommand(['send-keys', '-t', agentId, 'C-m']));
  await fly.ssh(vmName, `rm -f ${shellQuote(promptFile)}`);
}

/**
 * Check if remote agent is still running
 */
export async function isRemoteAgentRunning(
  agentId: string,
  vmName: string
): Promise<boolean> {
  const fly = createFlyProvider();
  return remoteSessionExists(fly, vmName, agentId);
}

/**
 * Kill remote agent session
 */
export async function killRemoteAgent(
  agentId: string,
  vmName: string
): Promise<void> {
  const fly = createFlyProvider();
  await ensureRemoteTmuxContext(fly, vmName);
  await fly.ssh(vmName, `${buildRemoteTmuxCommand(['kill-session', '-t', agentId])} 2>/dev/null || true`);

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
  const fly = createFlyProvider();
  await ensureRemoteTmuxContext(fly, vmName);

  const result = await fly.ssh(vmName, `${buildRemoteTmuxCommand(['list-sessions', '-F', '#{session_name}'])} 2>/dev/null || true`);
  if (!result.stdout.trim()) {
    return [];
  }

  return result.stdout.trim().split('\n').filter((name) => name.startsWith('agent-'));
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
  const fly = createFlyProvider();

  // Check if session exists
  const isRunning = await remoteSessionExists(fly, vmName, agentId);

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
