/**
 * Handoff Context Module
 *
 * Captures and serializes agent context for handoffs between models.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { TokenUsage } from '../runtimes/types.js';
import type { ComplexityLevel } from './complexity.js';
import type { AgentState } from '../agents.js';
import { getAgentDir } from '../agents.js';

const execAsync = promisify(exec);

/**
 * Beads task snapshot for handoff
 */
export interface BeadsTask {
  id: string;
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'closed';
  priority: number;
  labels?: string[];
  complexity?: ComplexityLevel;
}

/**
 * Handoff context - captures full state for agent transition
 */
export interface HandoffContext {
  // Agent identity
  issueId: string;
  agentId: string;
  workspace: string;

  // Source info
  previousModel: string;
  previousRuntime: 'claude-code';
  previousSessionId?: string;

  // Files
  stateFile?: string;           // .planning/STATE.md content
  claudeMd?: string;            // CLAUDE.md content

  // Git state
  gitBranch?: string;
  uncommittedFiles?: string[];
  lastCommit?: string;

  // Beads state
  activeBeadsTasks?: BeadsTask[];
  remainingTasks?: BeadsTask[];
  completedTasks?: BeadsTask[];

  // AI summaries
  whatWasDone?: string;
  whatRemains?: string;
  blockers?: string[];
  decisions?: string[];

  // Metrics
  tokenUsage?: TokenUsage;
  costSoFar?: number;
  handoffCount?: number;

  // New agent target
  targetModel: string;
  reason: string;
}

/**
 * Capture full handoff context from an agent
 *
 * @param agentState - Current agent state
 * @param targetModel - Model to hand off to
 * @param reason - Reason for handoff
 * @returns Handoff context
 */
export async function captureHandoffContext(
  agentState: AgentState,
  targetModel: string,
  reason: string
): Promise<HandoffContext> {
  const context: HandoffContext = {
    issueId: agentState.issueId,
    agentId: agentState.id,
    workspace: agentState.workspace,
    previousModel: agentState.model,
    previousRuntime: 'claude-code',
    previousSessionId: agentState.sessionId,
    targetModel,
    reason,
    handoffCount: agentState.handoffCount || 0,
    costSoFar: agentState.costSoFar || 0,
  };

  // Capture files (STATE.md, CLAUDE.md)
  await captureFiles(context, agentState.workspace);

  // Capture git state
  await captureGitState(context, agentState.workspace);

  // Capture beads tasks
  await captureBeadsTasks(context, agentState.issueId);

  return context;
}

/**
 * Capture workspace files (STATE.md, CLAUDE.md)
 */
async function captureFiles(context: HandoffContext, workspace: string): Promise<void> {
  try {
    // Read STATE.md if it exists
    const stateFile = join(workspace, '.planning/STATE.md');
    if (existsSync(stateFile)) {
      context.stateFile = readFileSync(stateFile, 'utf-8');
    }

    // Read CLAUDE.md if it exists
    const claudeMd = join(workspace, 'CLAUDE.md');
    if (existsSync(claudeMd)) {
      context.claudeMd = readFileSync(claudeMd, 'utf-8');
    }
  } catch (error) {
    console.error('Error capturing files:', error);
  }
}

/**
 * Capture git state
 */
async function captureGitState(context: HandoffContext, workspace: string): Promise<void> {
  try {
    // Get current branch
    const { stdout: branch } = await execAsync('git branch --show-current', {
      cwd: workspace,
      encoding: 'utf-8',
    });
    context.gitBranch = branch.trim();

    // Get uncommitted files
    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: workspace,
      encoding: 'utf-8',
    });
    context.uncommittedFiles = status
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.substring(3)); // Remove status prefix

    // Get last commit
    const { stdout: lastCommit } = await execAsync('git log -1 --oneline', {
      cwd: workspace,
      encoding: 'utf-8',
    });
    context.lastCommit = lastCommit.trim();
  } catch (error) {
    console.error('Error capturing git state:', error);
  }
}

/**
 * Capture beads tasks state
 */
async function captureBeadsTasks(context: HandoffContext, issueId: string): Promise<void> {
  try {
    // List all tasks with this issue's label
    const label = issueId.toLowerCase();
    const { stdout: output } = await execAsync(`bd list --json -l ${label}`, {
      encoding: 'utf-8',
    });

    const tasks: BeadsTask[] = JSON.parse(output);

    // Categorize tasks
    context.activeBeadsTasks = tasks.filter(t => t.status === 'in_progress');
    context.remainingTasks = tasks.filter(t => t.status === 'open');
    context.completedTasks = tasks.filter(t => t.status === 'closed');
  } catch (error) {
    console.error('Error capturing beads tasks:', error);
    context.activeBeadsTasks = [];
    context.remainingTasks = [];
    context.completedTasks = [];
  }
}

/**
 * Serialize handoff context to markdown for agent prompt
 *
 * @param context - Handoff context
 * @returns Markdown representation
 */
export function serializeHandoffContext(context: HandoffContext): string {
  const lines: string[] = [];

  lines.push('# Handoff Context');
  lines.push('');
  lines.push(`**Reason:** ${context.reason}`);
  lines.push(`**From:** ${context.previousModel}`);
  lines.push(`**To:** ${context.targetModel}`);
  lines.push(`**Handoff Count:** ${context.handoffCount}`);
  if (context.costSoFar) {
    lines.push(`**Cost So Far:** $${context.costSoFar.toFixed(4)}`);
  }
  lines.push('');

  // Git state
  if (context.gitBranch) {
    lines.push('## Git State');
    lines.push('');
    lines.push(`**Branch:** ${context.gitBranch}`);
    if (context.lastCommit) {
      lines.push(`**Last Commit:** ${context.lastCommit}`);
    }
    if (context.uncommittedFiles && context.uncommittedFiles.length > 0) {
      lines.push(`**Uncommitted Files:** ${context.uncommittedFiles.length}`);
      lines.push('```');
      context.uncommittedFiles.forEach(file => lines.push(file));
      lines.push('```');
    }
    lines.push('');
  }

  // Beads tasks
  if (context.completedTasks && context.completedTasks.length > 0) {
    lines.push('## Completed Tasks');
    lines.push('');
    context.completedTasks.forEach(task => {
      lines.push(`- [x] ${task.title} (${task.id})`);
    });
    lines.push('');
  }

  if (context.activeBeadsTasks && context.activeBeadsTasks.length > 0) {
    lines.push('## Active Tasks');
    lines.push('');
    context.activeBeadsTasks.forEach(task => {
      lines.push(`- [ ] ${task.title} (${task.id}) - IN PROGRESS`);
    });
    lines.push('');
  }

  if (context.remainingTasks && context.remainingTasks.length > 0) {
    lines.push('## Remaining Tasks');
    lines.push('');
    context.remainingTasks.forEach(task => {
      lines.push(`- [ ] ${task.title} (${task.id})`);
    });
    lines.push('');
  }

  // STATE.md content
  if (context.stateFile) {
    lines.push('## Current State (STATE.md)');
    lines.push('');
    lines.push('```markdown');
    lines.push(context.stateFile);
    lines.push('```');
    lines.push('');
  }

  // AI summaries (if available)
  if (context.whatWasDone) {
    lines.push('## What Was Done');
    lines.push('');
    lines.push(context.whatWasDone);
    lines.push('');
  }

  if (context.whatRemains) {
    lines.push('## What Remains');
    lines.push('');
    lines.push(context.whatRemains);
    lines.push('');
  }

  if (context.blockers && context.blockers.length > 0) {
    lines.push('## Blockers');
    lines.push('');
    context.blockers.forEach(blocker => lines.push(`- ${blocker}`));
    lines.push('');
  }

  if (context.decisions && context.decisions.length > 0) {
    lines.push('## Decisions Made');
    lines.push('');
    context.decisions.forEach(decision => lines.push(`- ${decision}`));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build handoff prompt for new agent
 *
 * @param context - Handoff context
 * @param additionalInstructions - Optional additional instructions
 * @returns Prompt for new agent
 */
export function buildHandoffPrompt(
  context: HandoffContext,
  additionalInstructions?: string
): string {
  const lines: string[] = [];

  lines.push('# Agent Handoff');
  lines.push('');
  lines.push(`You are taking over work on issue ${context.issueId} from a ${context.previousModel} agent.`);
  lines.push('');
  lines.push(`**Handoff Reason:** ${context.reason}`);
  lines.push('');
  lines.push('Please review the context below and continue the work.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(serializeHandoffContext(context));

  if (additionalInstructions) {
    lines.push('---');
    lines.push('');
    lines.push('## Additional Instructions');
    lines.push('');
    lines.push(additionalInstructions);
    lines.push('');
  }

  return lines.join('\n');
}
