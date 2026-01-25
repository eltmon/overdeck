/**
 * Convoy Runtime - Multi-Agent Orchestration
 *
 * Enables parallel execution of multiple AI agents with dependency management.
 * Agents are spawned in tmux sessions and coordinated through file-based state.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { parse as parseYaml } from 'yaml';
import { createSession, killSession, sessionExists } from './tmux.js';
import { getConvoyTemplate, getExecutionOrder, type ConvoyTemplate, type ConvoyAgent } from './convoy-templates.js';
import { AGENTS_DIR } from './paths.js';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface ConvoyContext {
  projectPath: string;
  files?: string[];
  prUrl?: string;
  issueId?: string;
  [key: string]: any;
}

export interface ConvoyAgentState {
  role: string;
  subagent: string;
  tmuxSession: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  outputFile?: string;
  exitCode?: number;
}

export interface ConvoyState {
  id: string;
  template: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  agents: ConvoyAgentState[];
  startedAt: string;
  completedAt?: string;
  outputDir: string;
  context: ConvoyContext;
}

interface AgentTemplate {
  name: string;
  description: string;
  model: string;
  tools: string[];
  content: string;
}

// ============================================================================
// Paths
// ============================================================================

const CONVOY_DIR = join(homedir(), '.panopticon', 'convoys');

function getConvoyStateFile(convoyId: string): string {
  return join(CONVOY_DIR, `${convoyId}.json`);
}

function getConvoyOutputDir(convoyId: string, template: ConvoyTemplate): string {
  // Use template's output dir if specified, otherwise default
  const baseDir = template.config?.outputDir || '.panopticon/convoy-output';
  return join(process.cwd(), baseDir, convoyId);
}

// ============================================================================
// State Management
// ============================================================================

function saveConvoyState(state: ConvoyState): void {
  mkdirSync(CONVOY_DIR, { recursive: true });
  writeFileSync(getConvoyStateFile(state.id), JSON.stringify(state, null, 2));
}

function loadConvoyState(convoyId: string): ConvoyState | undefined {
  const stateFile = getConvoyStateFile(convoyId);
  if (!existsSync(stateFile)) {
    return undefined;
  }

  try {
    const content = readFileSync(stateFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

export function getConvoyStatus(convoyId: string): ConvoyState | undefined {
  return loadConvoyState(convoyId);
}

export function listConvoys(filter?: { status?: string }): ConvoyState[] {
  if (!existsSync(CONVOY_DIR)) {
    return [];
  }

  const files = readdirSync(CONVOY_DIR).filter(f => f.endsWith('.json'));
  const convoys: ConvoyState[] = [];

  for (const file of files) {
    const convoyId = file.replace('.json', '');
    const state = loadConvoyState(convoyId);
    if (state) {
      if (!filter?.status || state.status === filter.status) {
        convoys.push(state);
      }
    }
  }

  // Sort by startedAt descending
  return convoys.sort((a, b) =>
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

// ============================================================================
// Agent Template Parsing
// ============================================================================

export function parseAgentTemplate(templatePath: string): AgentTemplate {
  if (!existsSync(templatePath)) {
    throw new Error(`Agent template not found: ${templatePath}`);
  }

  const content = readFileSync(templatePath, 'utf-8');

  // Parse frontmatter (YAML between --- markers)
  const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    throw new Error(`Invalid agent template format (missing frontmatter): ${templatePath}`);
  }

  const frontmatter = parseYaml(frontmatterMatch[1]);
  const promptContent = frontmatterMatch[2].trim();

  return {
    name: frontmatter.name || 'unknown',
    description: frontmatter.description || '',
    model: frontmatter.model || 'sonnet',
    tools: frontmatter.tools || [],
    content: promptContent,
  };
}

// ============================================================================
// Agent Spawning
// ============================================================================

export async function spawnConvoyAgent(
  convoy: ConvoyState,
  agent: ConvoyAgent,
  agentState: ConvoyAgentState,
  context: Record<string, any>
): Promise<void> {
  const { role, subagent } = agent;

  // Find agent template
  const templatePath = join(AGENTS_DIR, `${subagent}.md`);
  const template = parseAgentTemplate(templatePath);

  // Build context for agent prompt
  const agentContext = {
    ...context,
    convoy: {
      id: convoy.id,
      template: convoy.template,
      role: role,
      outputDir: convoy.outputDir,
    },
  };

  // Build prompt with context
  let prompt = template.content;

  // Add context instructions
  const contextInstructions = `
# Convoy Context

You are part of a convoy: **${convoy.template}**
Your role: **${role}**

**Output Directory**: ${convoy.outputDir}
**Output File**: ${agentState.outputFile || 'Not specified'}

${context.files ? `**Files to review**: ${context.files.join(', ')}` : ''}
${context.prUrl ? `**Pull Request**: ${context.prUrl}` : ''}
${context.issueId ? `**Issue ID**: ${context.issueId}` : ''}

---

`;

  prompt = contextInstructions + prompt;

  // Create output directory
  mkdirSync(convoy.outputDir, { recursive: true });

  // Write prompt to temp file
  const promptFile = join(convoy.outputDir, `${role}-prompt.md`);
  writeFileSync(promptFile, prompt);

  // Build claude command with model from template
  const claudeCmd = `claude --dangerously-skip-permissions --model ${template.model}`;

  // Create tmux session
  createSession(agentState.tmuxSession, convoy.context.projectPath, claudeCmd, {
    env: {
      PANOPTICON_CONVOY_ID: convoy.id,
      PANOPTICON_CONVOY_ROLE: role,
    },
  });

  // Wait a moment for Claude to start
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Send prompt using tmux load-buffer and paste-buffer
  await execAsync(`tmux load-buffer "${promptFile}"`);
  await execAsync(`tmux paste-buffer -t ${agentState.tmuxSession}`);
  await new Promise(resolve => setTimeout(resolve, 500));
  await execAsync(`tmux send-keys -t ${agentState.tmuxSession} Enter`);

  // Update agent state
  agentState.status = 'running';
  agentState.startedAt = new Date().toISOString();
  saveConvoyState(convoy);
}

// ============================================================================
// Convoy Lifecycle
// ============================================================================

export async function startConvoy(
  templateName: string,
  context: ConvoyContext
): Promise<ConvoyState> {
  // Load template
  const template = getConvoyTemplate(templateName);
  if (!template) {
    throw new Error(`Unknown convoy template: ${templateName}`);
  }

  // Generate convoy ID
  const timestamp = Date.now();
  const convoyId = `convoy-${templateName}-${timestamp}`;

  // Create output directory
  const outputDir = getConvoyOutputDir(convoyId, template);
  mkdirSync(outputDir, { recursive: true });

  // Initialize convoy state
  const state: ConvoyState = {
    id: convoyId,
    template: templateName,
    status: 'running',
    agents: [],
    startedAt: new Date().toISOString(),
    outputDir,
    context,
  };

  // Initialize agent states
  for (const agent of template.agents) {
    const tmuxSession = `${convoyId}-${agent.role}`;
    const outputFile = join(outputDir, `${agent.role}.md`);

    state.agents.push({
      role: agent.role,
      subagent: agent.subagent,
      tmuxSession,
      status: 'pending',
      outputFile,
    });
  }

  saveConvoyState(state);

  // Get execution order (phases)
  const phases = getExecutionOrder(template);

  // Execute Phase 1 (first batch of agents)
  if (phases.length > 0) {
    await executePhase(state, template, phases[0], context);
  }

  // Start background monitor for phase transitions
  startPhaseMonitor(state.id, template, phases, context);

  return state;
}

async function executePhase(
  convoy: ConvoyState,
  template: ConvoyTemplate,
  phaseAgents: ConvoyAgent[],
  context: Record<string, any>
): Promise<void> {
  const spawnPromises: Promise<void>[] = [];

  for (const agent of phaseAgents) {
    const agentState = convoy.agents.find(a => a.role === agent.role);
    if (!agentState) {
      throw new Error(`Agent state not found for role: ${agent.role}`);
    }

    // Check dependencies are completed
    const deps = agent.dependsOn || [];
    const allDepsCompleted = deps.every(depRole => {
      const depAgent = convoy.agents.find(a => a.role === depRole);
      return depAgent?.status === 'completed';
    });

    if (!allDepsCompleted) {
      throw new Error(`Dependencies not met for agent ${agent.role}`);
    }

    // Build context with outputs from dependency agents
    const agentContext = { ...context };
    for (const depRole of deps) {
      const depAgent = convoy.agents.find(a => a.role === depRole);
      if (depAgent?.outputFile && existsSync(depAgent.outputFile)) {
        agentContext[`${depRole}_output`] = readFileSync(depAgent.outputFile, 'utf-8');
      }
    }

    spawnPromises.push(spawnConvoyAgent(convoy, agent, agentState, agentContext));
  }

  // Spawn all agents in this phase in parallel
  await Promise.all(spawnPromises);
}

function startPhaseMonitor(
  convoyId: string,
  template: ConvoyTemplate,
  phases: ConvoyAgent[][],
  context: Record<string, any>
): void {
  // Run monitor in background (non-blocking)
  const monitorLoop = async () => {
    let currentPhaseIndex = 1; // Phase 0 already executed

    while (currentPhaseIndex < phases.length) {
      // Wait a bit before checking
      await new Promise(resolve => setTimeout(resolve, 5000));

      const state = loadConvoyState(convoyId);
      if (!state || state.status !== 'running') {
        break;
      }

      // Check if current phase is done
      const prevPhase = phases[currentPhaseIndex - 1];
      const allCompleted = prevPhase.every(agent => {
        const agentState = state.agents.find(a => a.role === agent.role);
        return agentState?.status === 'completed' || agentState?.status === 'failed';
      });

      if (allCompleted) {
        // Check for failures
        const anyFailed = prevPhase.some(agent => {
          const agentState = state.agents.find(a => a.role === agent.role);
          return agentState?.status === 'failed';
        });

        if (anyFailed) {
          state.status = 'partial';
          saveConvoyState(state);
          console.log(`[convoy] Phase ${currentPhaseIndex - 1} had failures. Stopping convoy.`);
          break;
        }

        // Start next phase
        console.log(`[convoy] Starting phase ${currentPhaseIndex}`);
        await executePhase(state, template, phases[currentPhaseIndex], context);
        currentPhaseIndex++;
      }

      // Update agent statuses based on tmux sessions
      updateAgentStatuses(state);
    }

    // Check if all agents are done
    const finalState = loadConvoyState(convoyId);
    if (finalState) {
      const allDone = finalState.agents.every(a =>
        a.status === 'completed' || a.status === 'failed'
      );

      if (allDone) {
        const anyFailed = finalState.agents.some(a => a.status === 'failed');
        finalState.status = anyFailed ? 'partial' : 'completed';
        finalState.completedAt = new Date().toISOString();
        saveConvoyState(finalState);
        console.log(`[convoy] Convoy ${convoyId} ${finalState.status}`);
      }
    }
  };

  // Start monitor (don't await - runs in background)
  monitorLoop().catch(err => {
    console.error(`[convoy] Monitor error for ${convoyId}:`, err);
  });
}

function updateAgentStatuses(convoy: ConvoyState): void {
  let updated = false;

  for (const agent of convoy.agents) {
    if (agent.status === 'running' && !sessionExists(agent.tmuxSession)) {
      // Tmux session ended - mark as completed
      agent.status = 'completed';
      agent.completedAt = new Date().toISOString();
      updated = true;

      // Check if output file was created
      if (agent.outputFile && existsSync(agent.outputFile)) {
        agent.exitCode = 0;
      } else {
        agent.exitCode = 1; // No output = failed
        agent.status = 'failed';
      }
    }
  }

  if (updated) {
    saveConvoyState(convoy);
  }
}

export async function stopConvoy(convoyId: string): Promise<void> {
  const state = loadConvoyState(convoyId);
  if (!state) {
    throw new Error(`Convoy not found: ${convoyId}`);
  }

  // Kill all running agent tmux sessions
  for (const agent of state.agents) {
    if (sessionExists(agent.tmuxSession)) {
      killSession(agent.tmuxSession);
    }
  }

  // Update state
  state.status = 'failed';
  state.completedAt = new Date().toISOString();
  saveConvoyState(state);
}

export async function waitForConvoy(
  convoyId: string,
  timeoutMs: number = 20 * 60 * 1000
): Promise<ConvoyState> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const state = loadConvoyState(convoyId);
    if (!state) {
      throw new Error(`Convoy not found: ${convoyId}`);
    }

    if (state.status === 'completed' || state.status === 'failed' || state.status === 'partial') {
      return state;
    }

    // Wait before checking again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Timeout - stop convoy
  await stopConvoy(convoyId);
  const state = loadConvoyState(convoyId);
  if (!state) {
    throw new Error(`Convoy not found after timeout: ${convoyId}`);
  }

  return state;
}
