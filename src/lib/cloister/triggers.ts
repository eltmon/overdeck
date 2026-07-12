/**
 * Handoff Triggers
 *
 * Detects conditions that should trigger model handoffs:
 * 1. Stuck escalation - Agent inactive for too long
 * 2. Planning complete - Planning phase finished, ready for implementation
 * 3. Test failure - Tests failing, need more powerful model
 * 4. Task completion - Implementation done, ready for specialist testing
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import type { AgentHealth } from './health.js';
import type { CloisterConfig } from './config.js';
import { loadCloisterConfigSync } from './config.js';
import { createBeadsResolver } from '../beads/resolver.js';

/** Single-flight prevents concurrent dashboard polls from duplicating the canonical read. */
const taskCompletionInflight = new Map<string, Promise<TriggerDetection>>();

/**
 * Trigger type
 */
export type TriggerType =
  | 'stuck_escalation'
  | 'test_failure'
  | 'task_complete'
  | 'manual';

/**
 * Trigger detection result
 */
export interface TriggerDetection {
  triggered: boolean;
  type: TriggerType;
  reason: string;
  suggestedModel?: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Check if agent should be handed off due to stuck escalation
 *
 * Model-specific thresholds:
 * - Haiku: Stuck after 10 minutes → escalate to Sonnet
 * - Sonnet: Stuck after 20 minutes → escalate to Opus
 * - Opus: Stuck after 30 minutes → alert user (no auto-escalation)
 *
 * @param health - Agent health state
 * @param currentModel - Current model
 * @param config - Cloister configuration
 * @returns Trigger detection result
 */
export function checkStuckEscalation(
  health: AgentHealth,
  currentModel: string,
  config?: CloisterConfig
): TriggerDetection {
  const conf = config || loadCloisterConfigSync();

  // Get stuck escalation config
  const stuckConfig = conf.handoffs?.auto_triggers?.stuck_escalation;
  if (!stuckConfig?.enabled) {
    return {
      triggered: false,
      type: 'stuck_escalation',
      reason: 'Stuck escalation disabled in config',
      confidence: 'high',
    };
  }

  // Check if agent is stuck based on health state
  if (health.state !== 'stuck') {
    return {
      triggered: false,
      type: 'stuck_escalation',
      reason: `Agent is ${health.state}, not stuck`,
      confidence: 'high',
    };
  }

  // Get minutes since last activity
  if (!health.lastActivity) {
    return {
      triggered: false,
      type: 'stuck_escalation',
      reason: 'No last activity timestamp available',
      confidence: 'low',
    };
  }
  const minutesSinceActivity = (Date.now() - health.lastActivity.getTime()) / (1000 * 60);

  // Check model-specific thresholds
  if (currentModel === 'haiku' && minutesSinceActivity >= stuckConfig.haiku_to_sonnet_minutes) {
    return {
      triggered: true,
      type: 'stuck_escalation',
      reason: `Haiku agent stuck for ${Math.round(minutesSinceActivity)} minutes`,
      suggestedModel: 'sonnet',
      confidence: 'high',
    };
  }

  if (currentModel === 'sonnet' && minutesSinceActivity >= stuckConfig.sonnet_to_opus_minutes) {
    return {
      triggered: true,
      type: 'stuck_escalation',
      reason: `Sonnet agent stuck for ${Math.round(minutesSinceActivity)} minutes`,
      suggestedModel: 'opus',
      confidence: 'high',
    };
  }

  if (currentModel === 'opus') {
    return {
      triggered: false,
      type: 'stuck_escalation',
      reason: 'Opus agent stuck - no higher model available, manual intervention needed',
      confidence: 'high',
    };
  }

  return {
    triggered: false,
    type: 'stuck_escalation',
    reason: `Agent stuck but threshold not reached (${Math.round(minutesSinceActivity)} minutes)`,
    confidence: 'medium',
  };
}

/**
 * Check if test failures should trigger escalation
 *
 * Aggressive escalation: Any test failure from Haiku escalates to Sonnet
 * Reasoning: Haiku is for simple tasks - if tests fail, the task isn't simple
 *
 * @param workspace - Workspace path
 * @param currentModel - Current model
 * @param config - Cloister configuration
 * @returns Trigger detection result
 */
export function checkTestFailure(
  workspace: string,
  currentModel: string,
  config?: CloisterConfig
): TriggerDetection {
  const conf = config || loadCloisterConfigSync();

  // Get test failure config
  const testConfig = conf.handoffs?.auto_triggers?.test_failure;
  if (!testConfig?.enabled) {
    return {
      triggered: false,
      type: 'test_failure',
      reason: 'Test failure escalation disabled in config',
      confidence: 'high',
    };
  }

  // Only escalate from Haiku or configured from_model
  if (currentModel !== testConfig.from_model) {
    return {
      triggered: false,
      type: 'test_failure',
      reason: `Test failure escalation only applies to ${testConfig.from_model} model`,
      confidence: 'high',
    };
  }

  // Check for test failures
  // Look for common test result files/patterns
  const testFailure = detectTestFailure(workspace);

  if (testFailure.failed) {
    return {
      triggered: true,
      type: 'test_failure',
      reason: `Test failures detected: ${testFailure.reason}`,
      suggestedModel: testConfig.to_model,
      confidence: testFailure.confidence,
    };
  }

  return {
    triggered: false,
    type: 'test_failure',
    reason: 'No test failures detected',
    confidence: 'medium',
  };
}

/**
 * Detect test failures in workspace
 *
 * Checks for:
 * - npm test output
 * - Jest results
 * - pytest results
 * - cargo test results
 *
 * @param workspace - Workspace path
 * @returns Test failure detection
 */
function detectTestFailure(workspace: string): {
  failed: boolean;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
} {
  // TODO: Implement proper test result detection
  // For now, this is a placeholder that checks for common test result files

  // Check for .test-results or similar
  const commonTestPaths = [
    '.test-results',
    'test-results',
    'junit.xml',
    'coverage',
    '.nyc_output',
  ];

  // This is a simplified check - in reality we'd parse test output
  return {
    failed: false,
    reason: 'Test result detection not yet implemented',
    confidence: 'low',
  };
}async function checkTaskCompletionPromise(
  issueId: string,
  config?: CloisterConfig,
  workspace?: string,
): Promise<TriggerDetection> {
  const conf = config || loadCloisterConfigSync();

  // Get task completion config
  const completionConfig = conf.handoffs?.auto_triggers?.implementation_complete;
  if (!completionConfig?.enabled) {
    return {
      triggered: false,
      type: 'task_complete',
      reason: 'Task completion detection disabled in config',
      confidence: 'high',
    };
  }

  const cacheKey = `${workspace ?? ''}::${issueId.toLowerCase()}`;
  const inflight = taskCompletionInflight.get(cacheKey);
  if (inflight) return inflight;

  const computePromise = (async (): Promise<TriggerDetection> => {
    // PAN-1812: the workspace beads DB must be queried from the agent's own
    // workspace. Without cwd the query can run against the wrong directory and
    // falsely report no open beads.
    if (!workspace) {
      return {
        triggered: false,
        type: 'task_complete',
        reason: 'No workspace available to check task completion',
        confidence: 'high',
      };
    }

    try {
      const result = await createBeadsResolver(workspace).getBeadsForIssue(issueId);
      if (!result.ok) throw result.error;
      const tasks = result.value.filter((task) => task.status === 'closed');
      const implementTask = tasks.find((t: any) =>
        t.title.toLowerCase().includes('implement') ||
        t.labels?.includes('implementation')
      );

      if (implementTask) {
        const openTasks = result.value.filter((task) => task.status === 'open');

        if (openTasks.length === 0) {
          return {
            triggered: true,
            type: 'task_complete',
            reason: 'Implementation task closed, no remaining tasks',
            suggestedModel: completionConfig.to_specialist,
            confidence: 'high',
          };
        }
        return {
          triggered: false,
          type: 'task_complete',
          reason: `Implementation task closed but ${openTasks.length} tasks remain`,
          confidence: 'medium',
        };
      }
    } catch {
      // Beads not available or error querying — fall through to default.
    }

    return {
      triggered: false,
      type: 'task_complete',
      reason: 'No implementation completion signals detected',
      confidence: 'high',
    };
  })();

  taskCompletionInflight.set(cacheKey, computePromise);
  try {
    return await computePromise;
  } finally {
    taskCompletionInflight.delete(cacheKey);
  }
}async function checkAllTriggersPromise(
  agentId: string,
  workspace: string,
  issueId: string,
  currentModel: string,
  health: AgentHealth,
  config?: CloisterConfig
): Promise<TriggerDetection[]> {
  const triggers: TriggerDetection[] = [];

  // Check each trigger type
  const stuckCheck = checkStuckEscalation(health, currentModel, config);
  if (stuckCheck.triggered) triggers.push(stuckCheck);

  const testCheck = checkTestFailure(workspace, currentModel, config);
  if (testCheck.triggered) triggers.push(testCheck);

  const completionCheck = await Effect.runPromise(checkTaskCompletion(issueId, config, workspace));
  if (completionCheck.triggered) triggers.push(completionCheck);

  return triggers;
}

// ─── PAN-1249: additive Effect variants ───────────────────────────────────────

/**
 * Effect-typed variant of {@link checkTaskCompletion}. Wraps the Promise-based
 * implementation; never fails (the underlying function swallows errors and
 * returns a "not triggered" detection on failure).
 */
export function checkTaskCompletion(
  issueId: string,
  config?: CloisterConfig,
  workspace?: string,
): Effect.Effect<TriggerDetection> {
  return Effect.promise(() => checkTaskCompletionPromise(issueId, config, workspace));
}

/**
 * Effect-typed variant of {@link checkAllTriggers}. Never fails — uses
 * `Effect.promise` because the underlying async path absorbs bd / fs errors.
 */
export function checkAllTriggers(
  agentId: string,
  workspace: string,
  issueId: string,
  currentModel: string,
  health: AgentHealth,
  config?: CloisterConfig,
): Effect.Effect<TriggerDetection[]> {
  return Effect.promise(() => checkAllTriggersPromise(agentId, workspace, issueId, currentModel, health, config));
}
