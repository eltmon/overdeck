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
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { getManagedTmuxSocketName } from '../tmux.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { getClaudePermissionFlagsSync, getClaudePermissionFlagsStringSync } from '../claude-permissions.js';

const AGENTS_DIR = join(homedir(), '.panopticon', 'agents');
const REMOTE_PAN_DIR = '/workspace/.pan';
const REMOTE_TMUX_DIR = `${REMOTE_PAN_DIR}/tmux`;
const REMOTE_TMUX_CONFIG_PATH = `${REMOTE_TMUX_DIR}/panopticon.tmux.conf`;
const REMOTE_HOST_HEARTBEAT_PATH = `${REMOTE_PAN_DIR}/host-heartbeat`;
const REMOTE_TMUX_CONFIG_CONTENT = [
  '# Panopticon-managed tmux config',
  '# Keep this minimal and include only behavior Panopticon intentionally depends on.',
  'set -g mouse on',
  '',
].join('\n');

const PUSH_DAEMON_INTERVAL_SECONDS = 300;
const EPHEMERAL_WATCHDOG_INTERVAL_SECONDS = 60;
const EPHEMERAL_HEARTBEAT_STALE_THRESHOLD_SECONDS = 5 * 60;

export interface PushDaemonOptions {
  issueId: string;
  branch: string;
  intervalSeconds?: number;
  logFile?: string;
}

/**
 * Generate a self-contained Node.js heartbeat script that commits and pushes
 * /workspace changes on an interval. The script reads config from environment
 * variables when run directly, and exports `runHeartbeat` for testing.
 */
export function generatePushDaemonScript(options: PushDaemonOptions): string {
  const intervalSeconds = options.intervalSeconds ?? PUSH_DAEMON_INTERVAL_SECONDS;
  const logFile = options.logFile ?? `${REMOTE_PAN_DIR}/push-daemon.log`;
  const issueIdLiteral = JSON.stringify(options.issueId);
  const branchLiteral = JSON.stringify(options.branch);

  return [
    "const { execFile } = require('child_process');",
    "const fs = require('fs');",
    "const path = require('path');",
    '',
    'function log(message) {',
    '  try {',
    `    fs.appendFileSync(${JSON.stringify(logFile)}, '[' + new Date().toISOString() + '] ' + message + '\\n');`,
    '  } catch {}',
    '}',
    '',
    'function runOnce() {',
    "  const cwd = '/workspace';",
    '  try {',
    `    if (!fs.existsSync(path.join(cwd, '.git'))) {`,
    "      log('Not a git repository; skipping heartbeat');",
    '      return;',
    '    }',
    '  } catch (err) {',
    `    log('Error checking repository: ' + (err && err.message ? err.message : String(err)));`,
    '    return;',
    '  }',
    '',
    "  execFile('git', ['-C', cwd, 'add', '-A'], (err) => {",
    '    if (err) {',
    "      log('git add failed: ' + (err.message || String(err)));",
    '      return;',
    '    }',
    "    execFile('git', ['-C', cwd, 'diff', '--cached', '--quiet'], (err) => {",
    '      if (!err) {',
    '        return;',
    '      }',
    `      const message = 'wip(remote): heartbeat for ' + ${issueIdLiteral};`,
    '      execFile(',
    "        'git',",
    `        ['-C', cwd, '-c', 'user.name=Panopticon Remote', '-c', 'user.email=remote@panopticon.local', 'commit', '-m', message],`,
    '        (err) => {',
    '          if (err) {',
    "            log('git commit failed: ' + (err.message || String(err)));",
    '            return;',
    '          }',
    `          execFile('git', ['-C', cwd, 'push', 'origin', ${branchLiteral}], (err) => {`,
    '            if (err) {',
    "              log('git push failed: ' + (err.message || String(err)));",
    '            }',
    '          });',
    '        }',
    '      );',
    '    });',
    '  });',
    '}',
    '',
    'function runHeartbeat(config) {',
    '  runOnce();',
    '  setInterval(runOnce, config.intervalSeconds * 1000);',
    '}',
    '',
    'if (require.main === module) {',
    '  runHeartbeat({',
    `    intervalSeconds: Number(process.env.PAN_INTERVAL_SECONDS || '${intervalSeconds}'),`,
    '  });',
    '}',
    '',
    'module.exports = { runHeartbeat };',
  ].join('\n');
}

/**
 * Install a detached tmux heartbeat daemon on the VM that continuously commits
 * and pushes the feature branch for the issue.
 */
export async function installPushDaemon(
  provider: FlyProvider,
  vmName: string,
  issueId: string,
): Promise<void> {
  const branch = `feature/${issueId.toLowerCase()}`;
  const baseName = `push-daemon-${issueId.toLowerCase()}`;
  const scriptPath = `${REMOTE_PAN_DIR}/${baseName}.js`;
  const logFile = `${REMOTE_PAN_DIR}/${baseName}.log`;

  const script = generatePushDaemonScript({ issueId, branch, logFile });
  await writeRemoteFile(provider, vmName, scriptPath, script);

  const envVars = [
    `PAN_ISSUE_ID=${shellQuote(issueId)}`,
    `PAN_BRANCH=${shellQuote(branch)}`,
    `PAN_LOG_FILE=${shellQuote(logFile)}`,
    `PAN_INTERVAL_SECONDS=${PUSH_DAEMON_INTERVAL_SECONDS}`,
  ].join(' ');

  const daemonCmd = `${envVars} node ${scriptPath}`;
  const tmuxCmd = buildRemoteTmuxCommand([
    'new-session',
    '-d',
    '-s',
    baseName,
    '-c',
    '/workspace',
    daemonCmd,
  ]);
  const result = await runSsh(provider, vmName, tmuxCmd);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to start push daemon on ${vmName}: ${result.stderr}`);
  }
}

export interface EphemeralWatchdogOptions {
  heartbeatPath: string;
  intervalSeconds?: number;
  staleThresholdSeconds?: number;
  logFile?: string;
}

/**
 * Generate a self-contained Node.js watchdog script for ephemeral-tier VMs.
 * The script polls a host-heartbeat freshness file and stops the machine by
 * killing PID 1 when the heartbeat is older than the configured threshold.
 * With Fly restart.policy:'no', the machine stays stopped.
 */
export function generateEphemeralWatchdogScript(options: EphemeralWatchdogOptions): string {
  const heartbeatPathLiteral = JSON.stringify(options.heartbeatPath);
  const logFileLiteral = JSON.stringify(options.logFile ?? `${REMOTE_PAN_DIR}/ephemeral-watchdog.log`);
  const intervalSeconds = options.intervalSeconds ?? EPHEMERAL_WATCHDOG_INTERVAL_SECONDS;
  const staleThresholdSeconds = options.staleThresholdSeconds ?? EPHEMERAL_HEARTBEAT_STALE_THRESHOLD_SECONDS;

  return [
    "const fs = require('fs');",
    "const { execFile } = require('child_process');",
    '',
    'function log(message) {',
    '  try {',
    `    fs.appendFileSync(${logFileLiteral}, '[' + new Date().toISOString() + '] ' + message + '\\n');`,
    '  } catch {}',
    '}',
    '',
    'function stopMachine() {',
    "  log('Host heartbeat stale — stopping machine (kill 1)');",
    "  execFile('kill', ['1'], () => {});",
    '}',
    '',
    'function checkHeartbeat(config) {',
    '  try {',
    `    if (!fs.existsSync(${heartbeatPathLiteral})) {`,
    "      log('Heartbeat file not present yet; waiting for host');",
    '      return;',
    '    }',
    `    const stat = fs.statSync(${heartbeatPathLiteral});`,
    '    const ageSeconds = (Date.now() - stat.mtimeMs) / 1000;',
    '    if (ageSeconds > config.staleThresholdSeconds) {',
    '      log(`Heartbeat stale: ${Math.round(ageSeconds)}s > ${config.staleThresholdSeconds}s`);',
    '      stopMachine();',
    '    } else {',
    '      log(`Heartbeat fresh: ${Math.round(ageSeconds)}s <= ${config.staleThresholdSeconds}s`);',
    '    }',
    '  } catch (err) {',
    "    log('Error checking heartbeat: ' + (err && err.message ? err.message : String(err)));",
    '  }',
    '}',
    '',
    'function runWatchdog(config) {',
    '  checkHeartbeat(config);',
    '  setInterval(() => checkHeartbeat(config), config.intervalSeconds * 1000);',
    '}',
    '',
    'if (require.main === module) {',
    '  runWatchdog({',
    `    intervalSeconds: Number(process.env.PAN_WATCHDOG_INTERVAL_SECONDS || '${intervalSeconds}'),`,
    `    staleThresholdSeconds: Number(process.env.PAN_WATCHDOG_STALE_SECONDS || '${staleThresholdSeconds}'),`,
    '  });',
    '}',
    '',
    'module.exports = { runWatchdog, checkHeartbeat, stopMachine };',
  ].join('\n');
}

/**
 * Install a detached tmux watchdog session on an ephemeral-tier VM. The
 * watchdog self-stops the machine when the host heartbeat goes stale.
 */
export async function installEphemeralWatchdog(
  provider: FlyProvider,
  vmName: string,
  issueId: string,
): Promise<void> {
  const baseName = `ephemeral-watchdog-${issueId.toLowerCase()}`;
  const scriptPath = `${REMOTE_PAN_DIR}/${baseName}.js`;
  const logFile = `${REMOTE_PAN_DIR}/${baseName}.log`;

  const script = generateEphemeralWatchdogScript({
    heartbeatPath: REMOTE_HOST_HEARTBEAT_PATH,
    intervalSeconds: EPHEMERAL_WATCHDOG_INTERVAL_SECONDS,
    staleThresholdSeconds: EPHEMERAL_HEARTBEAT_STALE_THRESHOLD_SECONDS,
    logFile,
  });
  await writeRemoteFile(provider, vmName, scriptPath, script);

  const envVars = [
    `PAN_WATCHDOG_HEARTBEAT_PATH=${shellQuote(REMOTE_HOST_HEARTBEAT_PATH)}`,
    `PAN_WATCHDOG_LOG_FILE=${shellQuote(logFile)}`,
    `PAN_WATCHDOG_INTERVAL_SECONDS=${EPHEMERAL_WATCHDOG_INTERVAL_SECONDS}`,
    `PAN_WATCHDOG_STALE_SECONDS=${EPHEMERAL_HEARTBEAT_STALE_THRESHOLD_SECONDS}`,
  ].join(' ');

  const daemonCmd = `${envVars} node ${scriptPath}`;
  const tmuxCmd = buildRemoteTmuxCommand([
    'new-session',
    '-d',
    '-s',
    baseName,
    '-c',
    '/workspace',
    daemonCmd,
  ]);
  const result = await runSsh(provider, vmName, tmuxCmd);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to start ephemeral watchdog on ${vmName}: ${result.stderr}`);
  }
}

export interface RemoteAgentState {
  id: string;
  issueId: string;
  vmName: string;
  model: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  lastActivity?: string;
  location: 'remote';
  tier?: 'ephemeral' | 'durable';
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

/**
 * List remote agent states currently running/starting.
 * Local file scan only — no fly API calls.
 */
export function listActiveRemoteAgentStates(): RemoteAgentState[] {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .map((agentId) => loadRemoteAgentState(agentId))
    .filter((state): state is RemoteAgentState =>
      state?.location === 'remote' && (state.status === 'running' || state.status === 'starting'));
}

/** Run a FlyProvider Effect at the async/Promise boundary. */
function runSsh(
  provider: FlyProvider,
  vmName: string,
  command: string,
): Promise<ExecResult> {
  return Effect.runPromise(provider.ssh(vmName, command));
}

export interface RefreshHostHeartbeatDeps {
  listActiveRemoteAgentStates?: typeof listActiveRemoteAgentStates;
  createFlyProvider?: typeof createFlyProvider;
  now?: () => Date;
}

/**
 * Refresh the host-heartbeat freshness file on every active ephemeral-tier VM.
 * The deacon patrol calls this each cycle; the VM-side ephemeral watchdog uses
 * the file's mtime to decide when to self-stop the machine.
 */
export async function refreshHostHeartbeatForEphemeralVms(
  deps: RefreshHostHeartbeatDeps = {},
): Promise<string[]> {
  const activeStates = (deps.listActiveRemoteAgentStates ?? listActiveRemoteAgentStates)();
  const ephemeralStates = activeStates.filter(
    (state) => state.tier !== 'durable',
    // Missing tier defaults to ephemeral: older states pre-date tier tracking,
    // and writing a heartbeat is harmless for durable VMs while essential for
    // ephemeral ones that may still have a watchdog installed.
  );
  if (ephemeralStates.length === 0) return [];

  const fly = (deps.createFlyProvider ?? createFlyProvider)();
  const now = deps.now ? deps.now() : new Date();
  const heartbeatContent = now.toISOString();
  const actions: string[] = [];

  for (const state of ephemeralStates) {
    try {
      await runSsh(
        fly,
        state.vmName,
        `mkdir -p ${shellQuote(REMOTE_PAN_DIR)} && echo ${shellQuote(heartbeatContent)} > ${shellQuote(REMOTE_HOST_HEARTBEAT_PATH)}`,
      );
      actions.push(`Host heartbeat refreshed for ${state.issueId.toUpperCase()} on ${state.vmName}`);
    } catch (err: any) {
      actions.push(
        `Host heartbeat failed for ${state.issueId.toUpperCase()} on ${state.vmName}: ${err.message ?? String(err)}`,
      );
    }
  }

  return actions;
}

export interface RemoteSpendCapResult {
  allowed: boolean;
  current: number;
  cap: number;
  message?: string;
}

export interface CheckRemoteSpendCapDeps {
  listActiveRemoteAgentStates?: typeof listActiveRemoteAgentStates;
}

/**
 * Enforce the configured remote.max_concurrent_agents cap before spawning a
 * new remote work agent. A cap of zero or unset is treated as unlimited,
 * preserving today's behavior.
 */
export function checkRemoteSpendCap(
  config: { remote?: { max_concurrent_agents?: number } },
  deps: CheckRemoteSpendCapDeps = {},
): RemoteSpendCapResult {
  const activeStates = (deps.listActiveRemoteAgentStates ?? listActiveRemoteAgentStates)();
  const cap = config.remote?.max_concurrent_agents ?? 0;

  if (!cap || cap <= 0) {
    return { allowed: true, current: activeStates.length, cap: 0 };
  }

  if (activeStates.length >= cap) {
    return {
      allowed: false,
      current: activeStates.length,
      cap,
      message: `Remote agent cap reached: ${activeStates.length}/${cap} active remote agents. Stop an existing remote agent or raise remote.max_concurrent_agents.`,
    };
  }

  return { allowed: true, current: activeStates.length, cap };
}

export interface RemoteDurabilityPreflightResult {
  ok: boolean;
  missing: Array<'push_daemon' | 'volume'>;
  message?: string;
}

/**
 * Verify that the remote machine satisfies the durability requirements for the
 * chosen tier before the work agent starts. Durable tier requires a persistent
 * volume mounted at /workspace; the continuous push daemon is wired by the
 * spawn path itself, so this gate focuses on machine-level guarantees.
 */
export async function checkRemoteDurabilityPreflight(
  provider: FlyProvider,
  vmName: string,
  tier: 'ephemeral' | 'durable',
): Promise<RemoteDurabilityPreflightResult> {
  const missing: Array<'push_daemon' | 'volume'> = [];

  if (tier === 'durable') {
    const mountCheck = await runSsh(
      provider,
      vmName,
      "mount | grep -q ' on /workspace ' && echo mounted || echo missing",
    );
    if (mountCheck.stdout.trim() !== 'mounted') {
      missing.push('volume');
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message:
        `Durability preflight failed for ${tier} tier on ${vmName}: missing ${missing.join(', ')}. ` +
        `Durable remote work requires a Fly volume mounted at /workspace. ` +
        `Destroy this machine and re-create it with the durable tier, or spawn as ephemeral.`,
    };
  }

  return { ok: true, missing: [] };
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
  tier?: 'ephemeral' | 'durable';
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
  const tier = options.tier ?? 'ephemeral';

  const agentId = `agent-${issueId.toLowerCase()}`;
  const vmName = workspace.vmName;

  const fly = createFlyProvider({ resiliencyTier: tier });

  // Check if VM is running
  const vmStatus = await Effect.runPromise(fly.getStatus(vmName));
  if (vmStatus !== 'running') {
    throw new Error(`VM ${vmName} is not running. Start it with: pan workspace start ${issueId}`);
  }

  // Check if agent already exists
  if (await remoteSessionExists(fly, vmName, agentId)) {
    throw new Error(`Agent ${agentId} already running on ${vmName}. Use 'pan tell' to message it.`);
  }

  // Durability preflight: durable-tier machines must have a persistent volume
  // mounted at /workspace before we run work that expects to survive restarts.
  const durability = await checkRemoteDurabilityPreflight(fly, vmName, tier);
  if (!durability.ok) {
    throw new Error(durability.message);
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
    tier,
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

  // Install a continuous commit+push heartbeat daemon in its own tmux session.
  // This runs independently of the agent session and survives agent crashes.
  await installPushDaemon(fly, vmName, issueId);

  // Ephemeral-tier VMs self-stop when the host heartbeat goes stale, so a
  // laptop-closed / deacon-dead scenario does not leave a fleet running forever.
  // Durable-tier VMs are explicitly meant to outlive the host and get no watchdog.
  if (tier === 'ephemeral') {
    await installEphemeralWatchdog(fly, vmName, issueId);
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
