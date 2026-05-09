/**
 * Handoff Triggers
 *
 * Detects conditions that should trigger model handoffs:
 * 1. Stuck escalation - Agent inactive for too long
 * 2. Planning complete - Planning phase finished, ready for implementation
 * 3. Test failure - Tests failing, need more powerful model
 * 4. Task completion - Implementation done, ready for specialist testing
 */

import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { AgentHealth } from './health.js';
import type { CloisterConfig } from './config.js';
import { loadCloisterConfig } from './config.js';
import { withBdMutex } from '../bd-mutex.js';

const execAsync = promisify(exec);

/**
 * Cache for checkTaskCompletion keyed by `${workspace}::${issueId}`.
 * Invalidated by mtime of `.beads/issues.jsonl` — same trick as
 * computePlanningState (PAN-1024 hotfix). The handoff-suggestion endpoint
 * is polled every 30s per agent panel; without this cache, every poll
 * fires two `bd list --json` invocations which each take ~1.87s wall-clock
 * and 1+ MB of disk I/O, causing sustained disk thrashing across N agents.
 *
 * Single-flight via a Promise map prevents stampedes when the page first
 * loads multiple agent panels concurrently.
 */
interface TaskCompletionCacheEntry {
  mtimeMs: number;
  result: TriggerDetection;
}
const taskCompletionCache = new Map<string, TaskCompletionCacheEntry>();
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
  const conf = config || loadCloisterConfig();

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
  const conf = config || loadCloisterConfig();

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
}

/**
 * Check if implementation is complete and ready for testing.
 *
 * Detection:
 * - Beads task with "implement" in title is closed
 * - No remaining implementation tasks
 *
 * Cached by `.beads/issues.jsonl` mtime: the polled `/handoff/suggestion`
 * endpoint hits this every 30s per agent panel, and each cold call fires
 * two `bd list --json` invocations (~1.87s + ~1MB I/O each). Cache hits
 * are a single statSync. The cache is invalidated whenever beads changes,
 * so suggestions stay current.
 *
 * @param workspace - Workspace path (used to stat .beads/issues.jsonl).
 *                    When omitted (legacy callers), the cache is bypassed.
 * @param issueId - Issue ID
 * @param config - Cloister configuration
 * @returns Trigger detection result
 */
export async function checkTaskCompletion(
  issueId: string,
  config?: CloisterConfig,
  workspace?: string,
): Promise<TriggerDetection> {
  const conf = config || loadCloisterConfig();

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

  // mtime-based cache
  const cacheKey = `${workspace ?? ''}::${issueId.toLowerCase()}`;
  let mtimeMs = 0;
  if (workspace) {
    const beadsFile = join(workspace, '.beads', 'issues.jsonl');
    try {
      mtimeMs = statSync(beadsFile).mtimeMs;
    } catch {
      // No beads file — fall through to compute (cheap when JSONL absent).
    }
    if (mtimeMs > 0) {
      const cached = taskCompletionCache.get(cacheKey);
      if (cached && cached.mtimeMs === mtimeMs) {
        return cached.result;
      }
      // Single-flight: if another request is computing this same key, await
      // its result instead of firing another pair of `bd list` invocations.
      const inflight = taskCompletionInflight.get(cacheKey);
      if (inflight) return inflight;
    }
  }

  const computePromise = (async (): Promise<TriggerDetection> => {
    try {
      const { stdout: output } = await withBdMutex(() => execAsync(`bd list --json -l ${issueId.toLowerCase()} --status closed`, {
        encoding: 'utf-8',
      }));
      const tasks = JSON.parse(output);
      const implementTask = tasks.find((t: any) =>
        t.title.toLowerCase().includes('implement') ||
        t.labels?.includes('implementation')
      );

      if (implementTask) {
        const { stdout: openOutput } = await execAsync(`bd list --json -l ${issueId.toLowerCase()} --status open`, {
          encoding: 'utf-8',
        });
        const openTasks = JSON.parse(openOutput);

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

  if (workspace && mtimeMs > 0) {
    taskCompletionInflight.set(cacheKey, computePromise);
    try {
      const result = await computePromise;
      taskCompletionCache.set(cacheKey, { mtimeMs, result });
      return result;
    } finally {
      taskCompletionInflight.delete(cacheKey);
    }
  }
  return computePromise;
}

/**
 * Check all triggers for an agent
 *
 * @param agentId - Agent ID
 * @param workspace - Workspace path
 * @param issueId - Issue ID
 * @param currentModel - Current model
 * @param health - Agent health state
 * @param config - Cloister configuration
 * @returns Array of triggered detections
 */
export async function checkAllTriggers(
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

  const completionCheck = await checkTaskCompletion(issueId, config, workspace);
  if (completionCheck.triggered) triggers.push(completionCheck);

  return triggers;
}
