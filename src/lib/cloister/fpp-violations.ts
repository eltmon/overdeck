/**
 * FPP (First Principles Programming) Violation Detection
 *
 * Detects when agents have pending work but are idle, and sends
 * escalating nudges to get them back on track.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { checkHook } from '../hooks.js';
import { getRuntimeForAgent } from '../runtimes/index.js';
import { getAgentHealth } from './health.js';
import { PANOPTICON_HOME } from '../paths.js';

/**
 * FPP violation types
 */
export type FPPViolationType = 'hook_idle' | 'pr_stale' | 'review_pending' | 'status_mismatch';

/**
 * FPP violation record
 */
export interface FPPViolation {
  agentId: string;
  type: FPPViolationType;
  detectedAt: string;
  nudgeCount: number;
  lastNudgeAt?: string;
  resolved: boolean;
}

/**
 * FPP violation configuration
 */
export interface FPPViolationConfig {
  hook_idle_minutes: number;
  pr_approved_minutes: number;
  review_pending_minutes: number;
  max_nudges: number;
}

/**
 * Default FPP violation configuration
 */
export const DEFAULT_FPP_CONFIG: FPPViolationConfig = {
  hook_idle_minutes: 5,
  pr_approved_minutes: 10,
  review_pending_minutes: 15,
  max_nudges: 3,
};

/**
 * Path to violations data file
 */
const VIOLATIONS_DATA_FILE = join(PANOPTICON_HOME, 'fpp-violations.json');

/**
 * Persisted violations data format
 */
interface ViolationsDataPersisted {
  violations: Array<[string, FPPViolation]>;
}

/**
 * Load violations from file
 */
function loadViolations(): Map<string, FPPViolation> {
  if (!existsSync(VIOLATIONS_DATA_FILE)) {
    return new Map();
  }

  try {
    const fileContent = readFileSync(VIOLATIONS_DATA_FILE, 'utf-8');
    const persisted: ViolationsDataPersisted = JSON.parse(fileContent);

    return new Map(persisted.violations || []);
  } catch (error) {
    console.error('Failed to load violations data, starting fresh:', error);
    return new Map();
  }
}

/**
 * Save violations to file (atomic write)
 */
function saveViolations(violations: Map<string, FPPViolation>): void {
  try {
    // Ensure directory exists
    const dir = dirname(VIOLATIONS_DATA_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const persisted: ViolationsDataPersisted = {
      violations: Array.from(violations.entries()),
    };

    // Atomic write: write to temp file, then rename
    const tempFile = `${VIOLATIONS_DATA_FILE}.tmp`;
    writeFileSync(tempFile, JSON.stringify(persisted, null, 2));
    writeFileSync(VIOLATIONS_DATA_FILE, readFileSync(tempFile));

    // Clean up temp file
    try {
      require('fs').unlinkSync(tempFile);
    } catch {}
  } catch (error) {
    console.error('Failed to save violations data:', error);
  }
}

/**
 * Store of active violations (persisted to disk)
 */
const activeViolations = loadViolations();

/**
 * Get escalating nudge message based on nudge count
 */
function getNudgeMessage(violation: FPPViolation, nudgeCount: number): string {
  const { type } = violation;

  if (nudgeCount === 1) {
    // Nudge 1: Status check
    switch (type) {
      case 'hook_idle':
        return "What's your current status? You have pending work on your hook.";
      case 'pr_stale':
        return "What's your current status? Your PR has been approved but not merged yet.";
      case 'review_pending':
        return "What's your current status? You have a review request pending.";
      default:
        return "What's your current status? Please provide an update.";
    }
  } else if (nudgeCount === 2) {
    // Nudge 2: Gentle reminder
    switch (type) {
      case 'hook_idle':
        return "I notice you've been idle while having pending work. Do you need help with the task on your hook?";
      case 'pr_stale':
        return "I notice you've been idle with an approved PR. Do you need help merging it?";
      case 'review_pending':
        return "I notice you've been idle with a pending review request. Do you need help addressing the feedback?";
      default:
        return "I notice you've been idle with pending work. Do you need assistance?";
    }
  } else {
    // Nudge 3: Direct action
    switch (type) {
      case 'hook_idle':
        return "You have pending work on your hook that needs attention. Execute it now or explain why you're blocked.";
      case 'pr_stale':
        return "Your PR is approved and ready to merge. Merge it now or explain any blockers.";
      case 'review_pending':
        return "You have review feedback that needs to be addressed. Work on it now or explain why you can't proceed.";
      default:
        return "You have pending work that requires immediate attention. Take action now or explain the blocker.";
    }
  }
}

/**
 * Check for FPP violations on an agent
 *
 * @param agentId - Agent to check
 * @param config - FPP violation configuration
 * @returns Violation if detected, null otherwise
 */
export function checkAgentForViolations(
  agentId: string,
  config: FPPViolationConfig = DEFAULT_FPP_CONFIG
): FPPViolation | null {
  const runtime = getRuntimeForAgent(agentId);
  if (!runtime) return null;

  // Get agent health to check activity
  const health = getAgentHealth(agentId, runtime);
  if (!health) return null;

  // Only check agents that are idle (stale, warning, stuck)
  if (health.state === 'active') return null;

  // Calculate idle time in minutes
  const idleMinutes = health.timeSinceActivity
    ? Math.floor(health.timeSinceActivity / (60 * 1000))
    : 0;

  // Check for work on hook
  let hookStatus: ReturnType<typeof checkHook>;
  try {
    hookStatus = checkHook(agentId);
  } catch (error) {
    console.error(`Failed to check hook for ${agentId}:`, error);
    return null;
  }

  if (hookStatus.hasWork && idleMinutes >= config.hook_idle_minutes) {
    // Check if we already have an active violation
    const existingKey = `${agentId}-hook_idle`;
    const existing = activeViolations.get(existingKey);

    if (existing && !existing.resolved) {
      return existing;
    }

    // Create new violation
    const violation: FPPViolation = {
      agentId,
      type: 'hook_idle',
      detectedAt: new Date().toISOString(),
      nudgeCount: 0,
      resolved: false,
    };

    activeViolations.set(existingKey, violation);
    saveViolations(activeViolations);
    return violation;
  }

  return null;
}

/**
 * Send a nudge to an agent about an FPP violation
 *
 * @param violation - The violation to nudge about
 * @returns True if nudge was sent successfully
 */
export function sendNudge(violation: FPPViolation): boolean {
  const runtime = getRuntimeForAgent(violation.agentId);
  if (!runtime) return false;

  // Increment nudge count
  violation.nudgeCount++;
  violation.lastNudgeAt = new Date().toISOString();

  // Get escalating message
  const message = getNudgeMessage(violation, violation.nudgeCount);

  try {
    runtime.sendMessage(violation.agentId, message);
    console.log(`🔔 Sent FPP nudge #${violation.nudgeCount} to ${violation.agentId}`);
    saveViolations(activeViolations);
    return true;
  } catch (error) {
    console.error(`Failed to send nudge to ${violation.agentId}:`, error);
    return false;
  }
}

/**
 * Resolve a violation (agent has addressed the issue)
 *
 * @param agentId - Agent ID
 * @param type - Violation type
 */
export function resolveViolation(agentId: string, type: FPPViolationType): void {
  const key = `${agentId}-${type}`;
  const violation = activeViolations.get(key);

  if (violation) {
    violation.resolved = true;
    console.log(`🔔 FPP violation resolved for ${agentId}: ${type}`);
    saveViolations(activeViolations);
  }
}

/**
 * Get all active violations
 *
 * @returns Array of active violations
 */
export function getActiveViolations(): FPPViolation[] {
  return Array.from(activeViolations.values()).filter(v => !v.resolved);
}

/**
 * Get violations for a specific agent
 *
 * @param agentId - Agent ID
 * @returns Array of violations for this agent
 */
export function getAgentViolations(agentId: string): FPPViolation[] {
  return getActiveViolations().filter(v => v.agentId === agentId);
}

/**
 * Check if an agent has exceeded max nudges
 *
 * @param violation - The violation to check
 * @param config - FPP violation configuration
 * @returns True if max nudges exceeded
 */
export function hasExceededMaxNudges(
  violation: FPPViolation,
  config: FPPViolationConfig = DEFAULT_FPP_CONFIG
): boolean {
  return violation.nudgeCount >= config.max_nudges;
}

/**
 * Clear resolved violations older than a certain time
 *
 * @param hoursOld - Clear violations resolved this many hours ago
 */
export function clearOldViolations(hoursOld: number = 24): void {
  const cutoff = Date.now() - hoursOld * 60 * 60 * 1000;
  let changed = false;

  for (const [key, violation] of activeViolations.entries()) {
    if (violation.resolved && new Date(violation.detectedAt).getTime() < cutoff) {
      activeViolations.delete(key);
      changed = true;
    }
  }

  if (changed) {
    saveViolations(activeViolations);
  }
}
