import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { AGENTS_DIR } from './paths.js';
import { createSession, killSession, sendKeys, sessionExists, getAgentSessions } from './tmux.js';
import { initHook, checkHook, generateFixedPointPrompt } from './hooks.js';
import { startWork, completeWork, getAgentCV } from './cv.js';
import type { ComplexityLevel } from './cloister/complexity.js';

export interface AgentState {
  id: string;
  issueId: string;
  workspace: string;
  runtime: string;
  model: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  lastActivity?: string;

  // Model routing & handoffs (Phase 4)
  complexity?: ComplexityLevel;
  handoffCount?: number;
  costSoFar?: number;
  sessionId?: string; // For resuming sessions after handoff
}

export function getAgentDir(agentId: string): string {
  return join(AGENTS_DIR, agentId);
}

export function getAgentState(agentId: string): AgentState | null {
  const stateFile = join(getAgentDir(agentId), 'state.json');
  if (!existsSync(stateFile)) return null;

  const content = readFileSync(stateFile, 'utf8');
  return JSON.parse(content);
}

export function saveAgentState(state: AgentState): void {
  const dir = getAgentDir(state.id);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify(state, null, 2)
  );
}

export interface SpawnOptions {
  issueId: string;
  workspace: string;
  runtime?: string;
  model?: string;
  prompt?: string;
  difficulty?: ComplexityLevel;
}

export function spawnAgent(options: SpawnOptions): AgentState {
  const agentId = `agent-${options.issueId.toLowerCase()}`;

  // Check if already running
  if (sessionExists(agentId)) {
    throw new Error(`Agent ${agentId} already running. Use 'pan work tell' to message it.`);
  }

  // Initialize hook for this agent (FPP support)
  initHook(agentId);

  // Create state
  const state: AgentState = {
    id: agentId,
    issueId: options.issueId,
    workspace: options.workspace,
    runtime: options.runtime || 'claude',
    model: options.model || 'sonnet',
    status: 'starting',
    startedAt: new Date().toISOString(),
    // Initialize Phase 4 fields
    complexity: options.difficulty,
    handoffCount: 0,
    costSoFar: 0,
  };

  saveAgentState(state);

  // Build prompt with FPP work if available
  let prompt = options.prompt || '';

  // FPP: Check for pending work on hook
  const { hasWork, items } = checkHook(agentId);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPrompt(agentId);
    if (fixedPointPrompt) {
      prompt = fixedPointPrompt + '\n\n---\n\n' + prompt;
    }
  }

  // Write prompt to file for complex prompts (avoids shell escaping issues)
  const promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
  if (prompt) {
    writeFileSync(promptFile, prompt);
  }

  // Auto-setup hooks if not configured
  checkAndSetupHooks();

  // Write initial task cache for heartbeat hook
  writeTaskCache(agentId, options.issueId);

  // Create tmux session and start claude
  const claudeCmd = `claude --dangerously-skip-permissions --model ${state.model}`;
  createSession(agentId, options.workspace, claudeCmd, {
    env: {
      PANOPTICON_AGENT_ID: agentId
    }
  });

  // If there's a prompt, load it via tmux buffer after claude starts
  if (prompt) {
    // Wait for claude to be ready by checking for the prompt character
    // Claude shows "❯" when ready for input
    let ready = false;
    for (let i = 0; i < 15; i++) {  // Max 15 seconds
      execSync('sleep 1');
      try {
        const pane = execSync(`tmux capture-pane -t ${agentId} -p`, { encoding: 'utf-8' });
        if (pane.includes('❯') || pane.includes('>')) {
          ready = true;
          break;
        }
      } catch {}
    }

    if (ready) {
      // Use tmux load-buffer and paste-buffer to send the prompt
      // This avoids all shell escaping issues
      execSync(`tmux load-buffer "${promptFile}"`);
      execSync(`tmux paste-buffer -t ${agentId}`);
      // Small delay to let paste complete, then send Enter
      execSync('sleep 0.5');
      execSync(`tmux send-keys -t ${agentId} Enter`);
    } else {
      console.error('Claude did not become ready in time, prompt not sent');
    }
  }

  // Update status
  state.status = 'running';
  saveAgentState(state);

  // Track work in CV
  startWork(agentId, options.issueId);

  return state;
}

export function listRunningAgents(): (AgentState & { tmuxActive: boolean })[] {
  const tmuxSessions = getAgentSessions();
  const tmuxNames = new Set(tmuxSessions.map(s => s.name));

  const agents: (AgentState & { tmuxActive: boolean })[] = [];

  // Read all agent states
  if (!existsSync(AGENTS_DIR)) return agents;

  const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const state = getAgentState(dir.name);
    if (state) {
      agents.push({
        ...state,
        tmuxActive: tmuxNames.has(state.id),
      });
    }
  }

  return agents;
}

export function stopAgent(agentId: string): void {
  // Normalize agent ID
  const normalizedId = agentId.startsWith('agent-') ? agentId : `agent-${agentId.toLowerCase()}`;

  if (sessionExists(normalizedId)) {
    killSession(normalizedId);
  }

  const state = getAgentState(normalizedId);
  if (state) {
    state.status = 'stopped';
    saveAgentState(state);
  }
}

export function messageAgent(agentId: string, message: string): void {
  // Normalize agent ID
  const normalizedId = agentId.startsWith('agent-') ? agentId : `agent-${agentId.toLowerCase()}`;

  if (!sessionExists(normalizedId)) {
    throw new Error(`Agent ${normalizedId} not running`);
  }

  sendKeys(normalizedId, message);

  // Also save to mail queue
  const mailDir = join(getAgentDir(normalizedId), 'mail');
  mkdirSync(mailDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(
    join(mailDir, `${timestamp}.md`),
    `# Message\n\n${message}\n`
  );
}

/**
 * Detect crashed agents (state shows running but tmux session is gone)
 */
export function detectCrashedAgents(): AgentState[] {
  const agents = listRunningAgents();
  return agents.filter(
    (agent) => agent.status === 'running' && !agent.tmuxActive
  );
}

/**
 * Recover a crashed agent by restarting it with context
 */
export function recoverAgent(agentId: string): AgentState | null {
  const normalizedId = agentId.startsWith('agent-') ? agentId : `agent-${agentId.toLowerCase()}`;
  const state = getAgentState(normalizedId);

  if (!state) {
    return null;
  }

  // Check if already running
  if (sessionExists(normalizedId)) {
    return state;
  }

  // Update crash count in health file
  const healthFile = join(getAgentDir(normalizedId), 'health.json');
  let health = { consecutiveFailures: 0, killCount: 0, recoveryCount: 0 };
  if (existsSync(healthFile)) {
    try {
      health = { ...health, ...JSON.parse(readFileSync(healthFile, 'utf-8')) };
    } catch {}
  }
  health.recoveryCount = (health.recoveryCount || 0) + 1;
  writeFileSync(healthFile, JSON.stringify(health, null, 2));

  // Build recovery prompt
  const recoveryPrompt = generateRecoveryPrompt(state);

  // Restart the agent with recovery context (YOLO mode - skip permissions)
  const claudeCmd = `claude --dangerously-skip-permissions --model ${state.model} "${recoveryPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  createSession(normalizedId, state.workspace, claudeCmd);

  // Update state
  state.status = 'running';
  state.lastActivity = new Date().toISOString();
  saveAgentState(state);

  return state;
}

/**
 * Generate a recovery prompt for a crashed agent
 */
function generateRecoveryPrompt(state: AgentState): string {
  const lines: string[] = [
    '# Agent Recovery',
    '',
    '⚠️ This agent session was recovered after a crash.',
    '',
    '## Previous Context',
    `- Issue: ${state.issueId}`,
    `- Workspace: ${state.workspace}`,
    `- Started: ${state.startedAt}`,
    '',
    '## Recovery Steps',
    '1. Check beads for context: `bd show ' + state.issueId + '`',
    '2. Review recent git commits: `git log --oneline -10`',
    '3. Check hook for pending work: `pan work hook check`',
    '4. Resume from last known state',
    '',
    '## FPP Reminder',
    '> "Any runnable action is a fixed point and must resolve before the system can rest."',
    '',
  ];

  // Add FPP work if available
  const { hasWork } = checkHook(state.id);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPrompt(state.id);
    if (fixedPointPrompt) {
      lines.push('---');
      lines.push('');
      lines.push(fixedPointPrompt);
    }
  }

  return lines.join('\n');
}

/**
 * Auto-recover all crashed agents
 */
export function autoRecoverAgents(): { recovered: string[]; failed: string[] } {
  const crashed = detectCrashedAgents();
  const recovered: string[] = [];
  const failed: string[] = [];

  for (const agent of crashed) {
    try {
      const result = recoverAgent(agent.id);
      if (result) {
        recovered.push(agent.id);
      } else {
        failed.push(agent.id);
      }
    } catch (error) {
      failed.push(agent.id);
    }
  }

  return { recovered, failed };
}

/**
 * Check if Panopticon hooks are configured, and auto-setup if not
 */
function checkAndSetupHooks(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const hookPath = join(homedir(), '.panopticon', 'bin', 'heartbeat-hook');

  // Check if settings.json exists and has heartbeat hook configured
  if (existsSync(settingsPath)) {
    try {
      const settingsContent = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);
      const postToolUse = settings?.hooks?.PostToolUse || [];

      const hookConfigured = postToolUse.some((hookConfig: any) =>
        hookConfig.hooks?.some((hook: any) =>
          hook.command === hookPath ||
          hook.command?.includes('panopticon') ||
          hook.command?.includes('heartbeat-hook')
        )
      );

      if (hookConfigured) {
        return; // Already configured
      }
    } catch {
      // Ignore errors, will attempt setup
    }
  }

  // Hooks not configured - run setup silently
  try {
    console.log('Configuring Panopticon heartbeat hooks...');
    execSync('pan setup hooks', { stdio: 'pipe' });
    console.log('✓ Heartbeat hooks configured');
  } catch (error) {
    console.warn('⚠ Failed to auto-configure hooks. Run `pan setup hooks` manually.');
  }
}

/**
 * Write task cache for heartbeat hook to use
 */
function writeTaskCache(agentId: string, issueId: string): void {
  const cacheDir = join(getAgentDir(agentId));
  mkdirSync(cacheDir, { recursive: true });

  const cacheFile = join(cacheDir, 'current-task.json');
  writeFileSync(
    cacheFile,
    JSON.stringify({
      id: issueId,
      title: `Working on ${issueId}`,
      updated_at: new Date().toISOString()
    }, null, 2)
  );
}
