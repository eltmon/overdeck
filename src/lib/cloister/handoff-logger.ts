/**
 * Handoff Event Logger
 *
 * Logs handoff events to JSONL file for tracking and analysis.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PANOPTICON_HOME } from '../paths.js';
import type { HandoffContext } from './handoff-context.js';
import type { TriggerType } from './triggers.js';

/**
 * Handoff event structure
 */
export interface HandoffEvent {
  timestamp: string;
  agentId: string;
  issueId: string;

  // Model transition
  from: {
    model: string;
    runtime: string;
    sessionId?: string;
  };
  to: {
    model: string;
    runtime: string;
    sessionId?: string;
  };

  // Trigger information
  trigger: TriggerType | 'manual';
  reason: string;

  // Context
  context: {
    beadsTaskCompleted?: string;
    stuckMinutes?: number;
    costAtHandoff?: number;
    handoffCount?: number;
  };

  // Result - handoff OPERATION success (did we spawn new agent?)
  success: boolean;
  errorMessage?: string;

  // Recovery outcome - did the agent ACTUALLY recover?
  // This is verified after the handoff, not at handoff time
  outcome?: {
    verified: boolean;          // Has recovery been checked?
    agentRecovered: boolean;    // Did the agent start making progress?
    verifiedAt?: string;        // When was this verified?
    verificationMethod?: 'heartbeat' | 'manual' | 'task_complete';
    notes?: string;
  };
}

/**
 * Handoff log file path
 */
const HANDOFF_LOG_FILE = join(PANOPTICON_HOME, 'logs', 'handoffs.jsonl');

/**
 * Ensure log directory exists
 */
function ensureLogDir(): void {
  const logDir = join(PANOPTICON_HOME, 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Log a handoff event
 *
 * @param event - Handoff event to log
 */
export function logHandoffEvent(event: HandoffEvent): void {
  ensureLogDir();

  const line = JSON.stringify(event) + '\n';
  appendFileSync(HANDOFF_LOG_FILE, line, 'utf-8');
}

/**
 * Create a handoff event from handoff result
 *
 * @param agentId - Agent ID
 * @param issueId - Issue ID
 * @param context - Handoff context
 * @param trigger - Trigger type
 * @param success - Whether handoff succeeded
 * @param errorMessage - Error message if failed
 * @returns Handoff event
 */
export function createHandoffEvent(
  agentId: string,
  issueId: string,
  context: HandoffContext,
  trigger: TriggerType | 'manual',
  success: boolean,
  errorMessage?: string
): HandoffEvent {
  // Calculate stuck minutes if applicable
  let stuckMinutes: number | undefined;
  if (trigger === 'stuck_escalation') {
    // This would be calculated from health state
    // For now, we'll omit it unless available in context
  }

  return {
    timestamp: new Date().toISOString(),
    agentId,
    issueId,
    from: {
      model: context.previousModel,
      runtime: context.previousRuntime,
      sessionId: context.previousSessionId,
    },
    to: {
      model: context.targetModel,
      runtime: 'claude-code', // New agent runtime
      sessionId: undefined, // Will be set after spawn
    },
    trigger,
    reason: context.reason,
    context: {
      costAtHandoff: context.costSoFar,
      handoffCount: context.handoffCount,
      stuckMinutes,
    },
    success,
    errorMessage,
  };
}

/**
 * Read all handoff events from log
 *
 * @param limit - Maximum number of events to return (most recent first)
 * @returns Array of handoff events
 */
export function readHandoffEvents(limit?: number): HandoffEvent[] {
  ensureLogDir();

  if (!existsSync(HANDOFF_LOG_FILE)) {
    return [];
  }

  const content = readFileSync(HANDOFF_LOG_FILE, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());

  const events = lines.map(line => JSON.parse(line) as HandoffEvent);

  // Return most recent first
  events.reverse();

  if (limit) {
    return events.slice(0, limit);
  }

  return events;
}

/**
 * Read handoff events for a specific issue
 *
 * @param issueId - Issue ID
 * @returns Array of handoff events for the issue
 */
export function readIssueHandoffEvents(issueId: string): HandoffEvent[] {
  const allEvents = readHandoffEvents();
  return allEvents.filter(e => e.issueId === issueId);
}

/**
 * Read handoff events for a specific agent
 *
 * @param agentId - Agent ID
 * @returns Array of handoff events for the agent
 */
export function readAgentHandoffEvents(agentId: string): HandoffEvent[] {
  const allEvents = readHandoffEvents();
  return allEvents.filter(e => e.agentId === agentId);
}

/**
 * Get handoff statistics
 *
 * Returns both operation success rate (handoff executed) and recovery success rate
 * (agent actually recovered). These are DIFFERENT metrics:
 *
 * - operationSuccessRate: Did the handoff operation complete successfully?
 * - recoverySuccessRate: Did the agent actually start making progress after handoff?
 *
 * @returns Handoff statistics
 */
export function getHandoffStats(): {
  totalHandoffs: number;
  byTrigger: Record<string, number>;
  byModel: {
    from: Record<string, number>;
    to: Record<string, number>;
  };
  // Legacy field for backwards compatibility
  successRate: number;
  // More detailed metrics
  operationSuccessRate: number;  // Handoff operation succeeded
  recoverySuccessRate: number;   // Agent actually recovered (verified only)
  pendingVerification: number;   // Handoffs that haven't been verified yet
  verifiedCount: number;         // Total handoffs that have been verified
} {
  const events = readHandoffEvents();

  const stats = {
    totalHandoffs: events.length,
    byTrigger: {} as Record<string, number>,
    byModel: {
      from: {} as Record<string, number>,
      to: {} as Record<string, number>,
    },
    successRate: 0,
    operationSuccessRate: 0,
    recoverySuccessRate: 0,
    pendingVerification: 0,
    verifiedCount: 0,
  };

  let operationSuccessCount = 0;
  let recoverySuccessCount = 0;

  for (const event of events) {
    // Count by trigger
    stats.byTrigger[event.trigger] = (stats.byTrigger[event.trigger] || 0) + 1;

    // Count by model
    stats.byModel.from[event.from.model] = (stats.byModel.from[event.from.model] || 0) + 1;
    stats.byModel.to[event.to.model] = (stats.byModel.to[event.to.model] || 0) + 1;

    // Count operation successes (handoff executed)
    if (event.success) {
      operationSuccessCount++;
    }

    // Count recovery outcomes (agent actually recovered)
    if (event.outcome?.verified) {
      stats.verifiedCount++;
      if (event.outcome.agentRecovered) {
        recoverySuccessCount++;
      }
    } else {
      stats.pendingVerification++;
    }
  }

  // Calculate rates
  stats.operationSuccessRate = events.length > 0 ? operationSuccessCount / events.length : 0;
  stats.recoverySuccessRate = stats.verifiedCount > 0 ? recoverySuccessCount / stats.verifiedCount : 0;

  // Legacy successRate - use operation success for backwards compatibility
  // but NOTE: This is misleading for "did the agent recover?"
  stats.successRate = stats.operationSuccessRate;

  return stats;
}

/**
 * Update the outcome of a handoff event (verify if agent recovered)
 *
 * @param agentId - Agent ID
 * @param timestamp - Original handoff timestamp
 * @param outcome - Recovery outcome
 */
export function updateHandoffOutcome(
  agentId: string,
  timestamp: string,
  outcome: {
    agentRecovered: boolean;
    verificationMethod: 'heartbeat' | 'manual' | 'task_complete';
    notes?: string;
  }
): void {
  ensureLogDir();

  if (!existsSync(HANDOFF_LOG_FILE)) {
    return;
  }

  const content = readFileSync(HANDOFF_LOG_FILE, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());

  // Find and update the matching event
  const updatedLines = lines.map(line => {
    const event = JSON.parse(line) as HandoffEvent;
    if (event.agentId === agentId && event.timestamp === timestamp) {
      event.outcome = {
        verified: true,
        agentRecovered: outcome.agentRecovered,
        verifiedAt: new Date().toISOString(),
        verificationMethod: outcome.verificationMethod,
        notes: outcome.notes,
      };
      return JSON.stringify(event);
    }
    return line;
  });

  // Rewrite the file
  writeFileSync(HANDOFF_LOG_FILE, updatedLines.join('\n') + '\n', 'utf-8');
}

/**
 * Get handoffs pending verification
 *
 * @returns Array of handoff events that need outcome verification
 */
export function getPendingVerificationHandoffs(): HandoffEvent[] {
  const events = readHandoffEvents();
  return events.filter(e => e.success && !e.outcome?.verified);
}
