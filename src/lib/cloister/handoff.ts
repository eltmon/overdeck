/**
 * Handoff Manager
 *
 * Orchestrates model handoffs for running agents using two methods:
 * 1. Kill & Spawn: For general agents (clean handoff with context preservation)
 * 2. Legacy specialist wake has been removed; all handoffs use role-based respawn.
 */

import { Effect } from 'effect';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Data } from 'effect';
import type { AgentState } from '../agents.js';
import { getAgentState, saveAgentStateSync, stopAgent, spawnAgent, spawnRun, getAgentDir } from '../agents.js';
import type { HandoffContext } from './handoff-context.js';
import { captureHandoffContext, buildHandoffPrompt } from './handoff-context.js';
import { sessionExists } from '../tmux.js';
import { requireModelOverride } from '../model-validation.js';

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
 * Hand a running agent off to another model: capture its context, stop it, and
 * spawn the replacement with a handoff prompt. Returns `success: false` when the
 * agent is not found or the model override is invalid.
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

  let targetModel: string;
  try {
    targetModel = requireModelOverride(options.targetModel);
  } catch (error) {
    return {
      success: false,
      method: 'kill-spawn',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Legacy specialist wake has been deleted; normalize all handoffs to role respawn.
  const method = options.method === 'specialist-wake' ? 'kill-spawn' : (options.method || detectHandoffMethod(agentId));

  return await performKillAndSpawn(state, { ...options, targetModel, method });
}

/**
 * Detect appropriate handoff method for an agent
 *
 * @param agentId - Agent ID
 * @returns Handoff method
 */
function detectHandoffMethod(_agentId: string): HandoffMethod {
  return 'kill-spawn';
}

/**
 * Kill & Spawn handoff method
 *
 * Process:
 * 1. Signal agent to save state (update continue file)
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
    // TODO: Send message to agent asking to update the continue file
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
    await Effect.runPromise(stopAgent(state.id));

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
      harness: state.harness,
      model: options.targetModel,
      role: 'work',
      prompt,
      allowHost: state.hostOverride === true,
      startedBy: 'handoff',
    });

    // Preserve accumulated cost without reintroducing legacy phase/complexity routing fields.
    newState.costSoFar = state.costSoFar || 0;
    saveAgentStateSync(newState);

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
    if (!(await Effect.runPromise(sessionExists(agentId)))) {
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
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Tagged error for a rejected {@link performHandoff}, raised where an Effect
 * caller bridges it (the dashboard handoff route). `message` is the underlying
 * error's message.
 */
export class HandoffError extends Data.TaggedError('HandoffError')<{
  readonly agentId: string;
  readonly stage: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
