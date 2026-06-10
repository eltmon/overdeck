/**
 * Remote Agent Management
 *
 * Spawn and manage Claude agents on remote Fly.io machines.
 * Agents run in tmux sessions for persistence and monitoring.
 *
 * PAN-1249: Effect migration. FlyProvider methods now return Effects.
 * Internal helpers run the Effects via `Effect.runPromise` at the boundary
 * with the existing async function shape so existing callers keep working
 * (caller migration is intentionally out of scope for this batch).
 */

import { Effect } from 'effect';
import { createFlyProvider } from './fly-provider.js';
import type { FlyProvider } from './fly-provider.js';
import type { RemoteWorkspaceMetadata, ExecResult } from './interface.js';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { getManagedTmuxSocketName } from '../tmux.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { getClaudePermissionFlagsSync, getClaudePermissionFlagsStringSync } from '../claude-permissions.js';

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
export function saveRemoteAgentState(state: RemoteAgentState): void {
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

/** Run a FlyProvider Effect at the async/Promise boundary. */
function runSsh(
  provider: FlyProvider,
  vmName: string,
  command: string,
): Promise<ExecResult> {
  return Effect.runPromise(provider.ssh(vmName, command));
}

/**
 * Check if remote agent session exists
 */
async function remoteSessionExists(
  provider: FlyProvider,
  vmName: string,
  sessionName: string
): Promise<boolean> {
  await ensureRemoteTmuxContext(provider, vmName);
  const result = await runSsh(
    provider,
    vmName,
    `${buildRemoteTmuxCommand(['has-session', '-t', sessionName])} 2>/dev/null && echo exists || echo not-found`,
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

async function ensureRemoteTmuxContext(provider: FlyProvider, vmName: string): Promise<void> {
  const configBase64 = Buffer.from(REMOTE_TMUX_CONFIG_CONTENT).toString('base64');
  await runSsh(
    provider,
    vmName,
    `mkdir -p ${shellQuote(REMOTE_TMUX_DIR)} && echo ${shellQuote(configBase64)} | base64 -d > ${shellQuote(REMOTE_TMUX_CONFIG_PATH)}`,
  );
}

/**
 * Write a file on the VM via base64 chunks. The Machines exec API rejects
 * payloads somewhere above 4KB (PayloadTooLarge), so large content — agent
 * prompts are 25KB+ — must be appended in slices and decoded at the end.
 * Throws on any failed write: a missing prompt file produces an agent that
 * silently starts with no instructions.
 */
export async function writeRemoteFile(
  provider: FlyProvider,
  vmName: string,
  remotePath: string,
  content: string,
): Promise<void> {
  const b64 = Buffer.from(content).toString('base64');
  const tmp = `${remotePath}.b64`;
  const init = await runSsh(provider, vmName, `mkdir -p $(dirname ${remotePath}) && : > ${tmp}`);
  if (init.exitCode !== 0) {
    throw new Error(`Failed to create ${tmp} on ${vmName}: ${init.stderr}`);
  }
  // ~16KB HTTP body ceiling on the exec API; 8KB chunks leave headroom.
  // Pace writes — per-machine exec actions are rate-limited (429 on bursts).
  const CHUNK = 8192;
  for (let i = 0; i < b64.length; i += CHUNK) {
    const chunk = b64.slice(i, i + CHUNK);
    const res = await runSsh(provider, vmName, `printf %s '${chunk}' >> ${tmp}`);
    if (res.exitCode !== 0) {
      throw new Error(`Failed writing chunk ${i / CHUNK} of ${remotePath} on ${vmName}: ${res.stderr}`);
    }
    if (i + CHUNK < b64.length) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  const fin = await runSsh(provider, vmName, `base64 -d < ${tmp} > ${remotePath} && rm ${tmp} && wc -c < ${remotePath}`);
  if (fin.exitCode !== 0) {
    throw new Error(`Failed to decode ${remotePath} on ${vmName}: ${fin.stderr}`);
  }
  const written = parseInt(fin.stdout.trim(), 10);
  const expected = Buffer.byteLength(content);
  if (written !== expected) {
    throw new Error(`Size mismatch writing ${remotePath} on ${vmName}: wrote ${written}, expected ${expected}`);
  }
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
  const vmStatus = await Effect.runPromise(fly.getStatus(vmName));
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
    // Write prompt to file on VM (chunked: the exec API rejects large payloads)
    const promptFile = `/workspace/.pan/prompts/${agentId}.md`;
    await writeRemoteFile(fly, vmName, promptFile, prompt);

    // Create launcher script
    const launcherScript = `/workspace/.pan/prompts/${agentId}-launcher.sh`;
    const launcherContent = generateLauncherScriptSync({
      role: 'work',
      spawnMode: 'remote',
      workingDir: '/workspace',
      changeDir: false,
      setRemotePath: true,
      promptFile,
      baseCommand: 'claude',
      permissionFlags: getClaudePermissionFlagsSync(),
      model,
    });
    await writeRemoteFile(fly, vmName, launcherScript, launcherContent);
    const chmodRes = await runSsh(fly, vmName, `chmod +x ${launcherScript}`);
    if (chmodRes.exitCode !== 0) {
      throw new Error(`Failed to chmod launcher on ${vmName}: ${chmodRes.stderr}`);
    }

    claudeCmd = `bash ${launcherScript}`;
  } else {
    claudeCmd = `claude ${getClaudePermissionFlagsStringSync()} --model ${model}`;
  }

  console.log(`[claude-invoke] purpose=remote-agent | model=${model} | source=remote-agents.ts | vm=${vmName} | agent=${agentId} | command="${claudeCmd}"`);

  await ensureRemoteTmuxContext(fly, vmName);

  // Create tmux session on remote VM
  const tmuxCmd = buildRemoteTmuxCommand(['new-session', '-d', '-s', agentId, '-c', '/workspace', claudeCmd]);
  const result = await runSsh(fly, vmName, tmuxCmd);

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

  const result = await runSsh(
    fly,
    vmName,
    buildRemoteTmuxCommand(['capture-pane', '-t', agentId, '-p', '-S', `-${lines}`]),
  );
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
  await runSsh(
    fly,
    vmName,
    `mkdir -p ${shellQuote(`${REMOTE_PAN_DIR}/prompts`)} && echo ${shellQuote(messageBase64)} | base64 -d > ${shellQuote(promptFile)}`,
  );
  await runSsh(fly, vmName, buildRemoteTmuxCommand(['load-buffer', '-b', agentId, promptFile]));
  await runSsh(fly, vmName, buildRemoteTmuxCommand(['paste-buffer', '-b', agentId, '-t', agentId, '-d']));
  await new Promise(resolve => setTimeout(resolve, 300));
  await runSsh(fly, vmName, buildRemoteTmuxCommand(['send-keys', '-t', agentId, 'C-m']));
  await runSsh(fly, vmName, `rm -f ${shellQuote(promptFile)}`);
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
  await runSsh(
    fly,
    vmName,
    `${buildRemoteTmuxCommand(['kill-session', '-t', agentId])} 2>/dev/null || true`,
  );

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

  const result = await runSsh(
    fly,
    vmName,
    `${buildRemoteTmuxCommand(['list-sessions', '-F', '#{session_name}'])} 2>/dev/null || true`,
  );
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
