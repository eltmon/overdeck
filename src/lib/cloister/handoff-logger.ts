/**
 * Handoff Event Logger
 *
 * Logs handoff events to JSONL file for tracking and analysis.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { OVERDECK_HOME } from '../paths.js';
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
const HANDOFF_LOG_FILE = join(OVERDECK_HOME, 'logs', 'handoffs.jsonl');

/**
 * Ensure log directory exists
 */
function ensureLogDir(): void {
  const logDir = join(OVERDECK_HOME, 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Log a handoff event
 *
 * @param event - Handoff event to log
 */
export function logHandoffEventSync(event: HandoffEvent): void {
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
      runtime: context.previousRuntime, // New agent inherits the same harness
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
export function readHandoffEventsSync(limit?: number): HandoffEvent[] {
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
