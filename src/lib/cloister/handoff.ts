/**
 * Handoff Manager
 *
 * Orchestrates model handoffs for running agents using two methods:
 * 1. Kill & Spawn: For general agents (clean handoff with context preservation)
 * 2. Specialist Wake: For permanent specialists (resume with preserved context)
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { AgentState } from '../agents.js';
import { getAgentState, saveAgentState, stopAgent, spawnAgent, getAgentDir } from '../agents.js';
import type { HandoffContext } from './handoff-context.js';
import { captureHandoffContext, buildHandoffPrompt } from './handoff-context.js';
import { sessionExists } from '../tmux.js';
import {
  wakeSpecialist,
  wakeSpecialistOrQueue,
  getSessionId,
  getTmuxSessionName,
  isRunning,
  recordWake,
  type SpecialistType,
} from './specialists.js';

/**
 * Handoff method type
 */
export type HandoffMethod = 'kill-spawn' | 'specialist-wake';

/**
 * Handoff result
 */
export interface HandoffResult {
  success: boolean;
  method: HandoffMethod;
  newAgentId?: string;
  newSessionId?: string;
  context?: HandoffContext;
  error?: string;
}

/**
 * Handoff options
 */
export interface HandoffOptions {
  targetModel: string;
  reason: string;
  method?: HandoffMethod; // Auto-detect if not specified
  waitForIdle?: boolean; // Wait for agent to be idle before killing (default: true)
  idleTimeoutMs?: number; // How long to wait for idle (default: 30000)
  additionalInstructions?: string; // Extra instructions for new agent
}

/**
 * Perform a model handoff for an agent
 *
 * Auto-selects handoff method based on agent type:
 * - Specialists (merge-agent, test-agent, etc.): Use specialist-wake
 * - General agents: Use kill-spawn
 *
 * @param agentId - Agent to hand off
 * @param options - Handoff options
 * @returns Handoff result
 */
export async function performHandoff(
  agentId: string,
  options: HandoffOptions
): Promise<HandoffResult> {
  // Get current agent state
  const state = getAgentState(agentId);
  if (!state) {
    return {
      success: false,
      method: 'kill-spawn',
      error: `Agent ${agentId} not found`,
    };
  }

  // Auto-detect method if not specified
  const method = options.method || detectHandoffMethod(agentId);

  // Execute appropriate handoff method
  if (method === 'specialist-wake') {
    return await performSpecialistWake(state, options);
  } else {
    return await performKillAndSpawn(state, options);
  }
}

/**
 * Detect appropriate handoff method for an agent
 *
 * @param agentId - Agent ID
 * @returns Handoff method
 */
function detectHandoffMethod(agentId: string): HandoffMethod {
  // Specialists use specialist-wake (context-preserving resume)
  const specialists = ['merge-agent', 'review-agent', 'test-agent', 'planning-agent'];
  if (specialists.some(s => agentId.includes(s))) {
    return 'specialist-wake';
  }

  // General agents use kill-spawn
  return 'kill-spawn';
}

/**
 * Kill & Spawn handoff method
 *
 * Process:
 * 1. Signal agent to save state (update STATE.md)
 * 2. Wait for idle (check for activity)
 * 3. Capture handoff context
 * 4. Kill current agent
 * 5. Build handoff prompt
 * 6. Spawn new agent with target model
 *
 * @param state - Current agent state
 * @param options - Handoff options
 * @returns Handoff result
 */
async function performKillAndSpawn(
  state: AgentState,
  options: HandoffOptions
): Promise<HandoffResult> {
  try {
    // Step 1: Signal agent to save state
    // TODO: Send message to agent asking to update STATE.md
    // For now, we'll capture what's there

    // Step 2: Wait for idle if requested
    if (options.waitForIdle !== false) {
      const timeout = options.idleTimeoutMs || 30000;
      const idle = await waitForIdle(state.id, timeout);
      if (!idle) {
        console.warn(`Agent ${state.id} did not become idle within ${timeout}ms`);
      }
    }

    // Step 3: Capture handoff context
    const context = await captureHandoffContext(state, options.targetModel, options.reason);

    // Step 4: Kill current agent
    stopAgent(state.id);

    // Step 5: Build handoff prompt
    const prompt = buildHandoffPrompt(context, options.additionalInstructions);

    // Save handoff prompt for debugging
    const handoffDir = join(getAgentDir(state.id), 'handoffs');
    mkdirSync(handoffDir, { recursive: true });
    const handoffFile = join(handoffDir, `handoff-${Date.now()}.md`);
    writeFileSync(handoffFile, prompt);

    // Step 6: Spawn new agent with target model
    // Use same agent ID to preserve identity
    const newState = await spawnAgent({
      issueId: state.issueId,
      workspace: state.workspace,
      runtime: state.runtime,
      model: options.targetModel,
      prompt,
    });

    // Update handoff metrics
    newState.handoffCount = (state.handoffCount || 0) + 1;
    newState.costSoFar = state.costSoFar || 0;
    newState.complexity = state.complexity;
    saveAgentState(newState);

    return {
      success: true,
      method: 'kill-spawn',
      newAgentId: newState.id,
      context,
    };
  } catch (error) {
    return {
      success: false,
      method: 'kill-spawn',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Specialist Wake handoff method
 *
 * Process:
 * 1. Capture handoff context
 * 2. Use `claude --resume {sessionId}` to wake specialist
 * 3. Pass task-specific prompt
 * 4. Faster context loading, specialist expertise retained
 *
 * NOTE: This requires the specialist to have been initialized first.
 * Specialists are persistent sessions that can be resumed.
 *
 * @param state - Current agent state
 * @param options - Handoff options
 * @returns Handoff result
 */
async function performSpecialistWake(
  state: AgentState,
  options: HandoffOptions
): Promise<HandoffResult> {
  try {
    // Step 1: Capture handoff context
    const context = await captureHandoffContext(state, options.targetModel, options.reason);

    // Step 2: Build task prompt for specialist
    const prompt = buildHandoffPrompt(context, options.additionalInstructions);

    // Step 3: Wake specialist using --resume
    // Determine specialist type from agent ID or options
    const specialistName = extractSpecialistName(state.id) as SpecialistType | null;
    if (!specialistName) {
      return {
        success: false,
        method: 'specialist-wake',
        error: 'Could not determine specialist name from agent ID',
      };
    }

    // Check if specialist session exists
    const sessionId = getSessionId(specialistName);
    const tmuxSession = getTmuxSessionName(specialistName);

    console.log(`[handoff] Waking specialist ${specialistName} (session: ${sessionId || 'none'})`);

    // Build task details for wakeSpecialistOrQueue
    const taskDetails = {
      issueId: state.issueId || 'unknown',
      branch: context.gitBranch || state.branch,
      workspace: state.workspace,
      prUrl: (context as any).prUrl,  // Optional field may not exist
      context: {
        reason: options.reason,
        targetModel: options.targetModel,
        additionalInstructions: options.additionalInstructions,
      },
    };

    // Use wakeSpecialistOrQueue to handle busy specialists (PAN-74)
    const wakeResult = await wakeSpecialistOrQueue(specialistName, taskDetails, {
      priority: 'normal',
      source: 'handoff',
    });

    if (!wakeResult.success) {
      console.error(`[handoff] Failed to wake or queue specialist: ${wakeResult.error}`);
      // Fall back to kill-spawn if specialist wake fails
      console.warn(`[handoff] Falling back to kill-spawn`);
      return await performKillAndSpawn(state, options);
    }

    if (wakeResult.queued) {
      console.log(`[handoff] Specialist ${specialistName} was busy, task queued`);
    } else {
      console.log(`[handoff] Successfully woke specialist ${specialistName}`);
    }

    return {
      success: true,
      method: 'specialist-wake',
      newSessionId: sessionId || undefined,
      context,
    };
  } catch (error) {
    return {
      success: false,
      method: 'specialist-wake',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Wait for agent to become idle
 *
 * @param agentId - Agent ID
 * @param timeoutMs - Timeout in milliseconds
 * @returns True if agent became idle, false if timeout
 */
async function waitForIdle(agentId: string, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Check if agent session still exists
    if (!sessionExists(agentId)) {
      return true; // Agent is gone, consider it idle
    }

    // Check for recent activity
    // TODO: Implement proper activity detection
    // For now, just wait a bit
    await sleep(1000);
  }

  return false; // Timeout
}

/**
 * Extract specialist name from agent ID
 *
 * @param agentId - Agent ID (e.g., "agent-merge-pan-18")
 * @returns Specialist name or null
 */
function extractSpecialistName(agentId: string): string | null {
  const specialists = ['merge-agent', 'review-agent', 'test-agent', 'planning-agent'];
  for (const specialist of specialists) {
    if (agentId.includes(specialist.replace('-agent', ''))) {
      return specialist;
    }
  }
  return null;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if handoff is recommended for an agent
 *
 * This is a placeholder for future trigger logic.
 * Triggers will be implemented in Phase C.
 *
 * @param agentId - Agent ID
 * @returns True if handoff is recommended
 */
export function shouldHandoff(agentId: string): boolean {
  // TODO: Implement trigger logic in Phase C
  return false;
}
