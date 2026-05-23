/**
 * Handoff Context Module
 *
 * Captures and serializes agent context for handoffs between models.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Data, Effect } from 'effect';
import type { TokenUsage } from '../runtimes/types.js';
import type { ComplexityLevel } from './complexity.js';
import type { AgentState } from '../agents.js';
import { renderPrompt } from './prompts.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { resolveVBriefDir } from '../vbrief/lifecycle.js';
import { readContinueStateSync, type ContinueState } from '../vbrief/continue-state.js';
import { readWorkspaceContinue } from '../pan-dir/index.js';
import { withBdMutex } from '../bd-mutex.js';

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
  /** Parsed scope continue file. */
  continueState?: ContinueState;
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
}async function captureHandoffContextPromise(
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
    handoffCount: 0,
    costSoFar: agentState.costSoFar || 0,
  };

  // Capture files (continue file, CLAUDE.md)
  await captureFiles(context, agentState.workspace, agentState.issueId);

  // Capture git state
  await captureGitState(context, agentState.workspace);

  // Capture beads tasks
  await captureBeadsTasks(context, agentState.issueId);

  return context;
}

/**
 * Capture workspace files (continue file, CLAUDE.md)
 */
async function captureFiles(
  context: HandoffContext,
  workspace: string,
  issueId: string,
): Promise<void> {
  try {
    // Read the live workspace continue state first, then migration fallbacks.
    let continueState: ContinueState | null = null;
    try {
      continueState = await Effect.runPromise(readWorkspaceContinue(workspace));
    } catch { /* ignore */ }
    if (!continueState) {
      const resolved = resolveProjectFromIssueSync(issueId);
      if (resolved) {
        for (const dir of ['active', 'proposed', 'completed', 'cancelled'] as const) {
          try {
            const lifecycleDir = resolveVBriefDir(resolved.projectPath, dir);
            const cs = readContinueStateSync(lifecycleDir, issueId);
            if (cs) {
              continueState = cs;
              break;
            }
          } catch { /* ignore */ }
        }
      }
    }
    if (continueState) {
      context.continueState = continueState;
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

  // Continue file content (structured planning state)
  if (context.continueState) {
    lines.push('## Current State (continue.vbrief.json)');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(context.continueState, null, 2));
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
  return Effect.runSync(renderPrompt({
    name: 'handoff-to-work',
    vars: {
      ISSUE_ID: context.issueId,
      PREVIOUS_MODEL: context.previousModel,
      REASON: context.reason,
      HANDOFF_CONTEXT: serializeHandoffContext(context),
      ADDITIONAL_INSTRUCTIONS_BLOCK: additionalInstructions || '',
    },
  }));
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect-channel variants. The async variants above stay so existing
// callers keep working; Effect-based callers can compose without runPromise.

/** Tagged error for handoff-context Effect variants. */
export class HandoffContextError extends Data.TaggedError('HandoffContextError')<{
  readonly issueId: string;
  readonly stage: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `captureHandoffContext`. */
export const captureHandoffContext = (
  agentState: AgentState,
  targetModel: string,
  reason: string,
): Effect.Effect<HandoffContext, HandoffContextError> =>
  Effect.tryPromise({
    try: () => captureHandoffContextPromise(agentState, targetModel, reason),
    catch: (cause) =>
      new HandoffContextError({
        issueId: agentState.issueId,
        stage: 'captureHandoffContext',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
