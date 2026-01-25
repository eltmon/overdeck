/**
 * Specialist Handoff Event Logger
 *
 * Logs specialist handoff events (work passing between specialist agents)
 * to JSONL file for tracking and analysis in the dashboard.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { PANOPTICON_HOME } from '../paths.js';

/**
 * Specialist handoff event structure
 */
export interface SpecialistHandoff {
  id: string;
  timestamp: string; // ISO 8601
  issueId: string;
  fromSpecialist: string; // e.g., "review-agent"
  toSpecialist: string; // e.g., "test-agent"
  status: 'queued' | 'processing' | 'completed' | 'failed';
  priority: 'urgent' | 'high' | 'normal' | 'low';
  completedAt?: string; // ISO 8601
  result?: 'success' | 'failure';
  context?: {
    workspace?: string;
    branch?: string;
    prUrl?: string;
    source?: string;
  };
}

/**
 * Specialist handoff log file path
 */
const SPECIALIST_HANDOFF_LOG_FILE = join(PANOPTICON_HOME, 'logs', 'specialist-handoffs.jsonl');

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
 * Log a specialist handoff event
 *
 * @param event - Specialist handoff event to log
 */
export function logSpecialistHandoff(event: SpecialistHandoff): void {
  ensureLogDir();

  const line = JSON.stringify(event) + '\n';
  appendFileSync(SPECIALIST_HANDOFF_LOG_FILE, line, 'utf-8');
}

/**
 * Create a specialist handoff event (queued status)
 *
 * @param fromSpecialist - Source specialist (or 'issue-agent')
 * @param toSpecialist - Target specialist
 * @param issueId - Issue ID
 * @param priority - Task priority
 * @param context - Additional context
 * @returns Specialist handoff event
 */
export function createSpecialistHandoff(
  fromSpecialist: string,
  toSpecialist: string,
  issueId: string,
  priority: 'urgent' | 'high' | 'normal' | 'low',
  context?: {
    workspace?: string;
    branch?: string;
    prUrl?: string;
    source?: string;
  }
): SpecialistHandoff {
  return {
    id: `${toSpecialist}-${issueId}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    issueId,
    fromSpecialist,
    toSpecialist,
    status: 'queued',
    priority,
    context,
  };
}

/**
 * Read all specialist handoff events from log
 *
 * @param limit - Maximum number of events to return (most recent first)
 * @returns Array of specialist handoff events
 */
export function readSpecialistHandoffs(limit?: number): SpecialistHandoff[] {
  ensureLogDir();

  if (!existsSync(SPECIALIST_HANDOFF_LOG_FILE)) {
    return [];
  }

  const content = readFileSync(SPECIALIST_HANDOFF_LOG_FILE, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());

  const events = lines.map(line => JSON.parse(line) as SpecialistHandoff);

  // Return most recent first
  events.reverse();

  if (limit) {
    return events.slice(0, limit);
  }

  return events;
}

/**
 * Read specialist handoff events for a specific issue
 *
 * @param issueId - Issue ID
 * @returns Array of specialist handoff events for the issue
 */
export function readIssueSpecialistHandoffs(issueId: string): SpecialistHandoff[] {
  const allEvents = readSpecialistHandoffs();
  return allEvents.filter(e => e.issueId === issueId);
}

/**
 * Get specialist handoff statistics
 *
 * @returns Specialist handoff statistics
 */
export function getSpecialistHandoffStats(): {
  totalHandoffs: number;
  todayCount: number;
  bySpecialist: Record<string, { sent: number; received: number }>;
  byStatus: Record<string, number>;
  successRate: number;
  queueDepth: number; // Current items with 'queued' or 'processing' status
} {
  const events = readSpecialistHandoffs();
  const today = new Date().toISOString().split('T')[0];

  const stats = {
    totalHandoffs: events.length,
    todayCount: 0,
    bySpecialist: {} as Record<string, { sent: number; received: number }>,
    byStatus: {} as Record<string, number>,
    successRate: 0,
    queueDepth: 0,
  };

  let completedCount = 0;
  let successCount = 0;

  for (const event of events) {
    // Count today's handoffs
    if (event.timestamp.startsWith(today)) {
      stats.todayCount++;
    }

    // Count by specialist (from)
    if (!stats.bySpecialist[event.fromSpecialist]) {
      stats.bySpecialist[event.fromSpecialist] = { sent: 0, received: 0 };
    }
    stats.bySpecialist[event.fromSpecialist].sent++;

    // Count by specialist (to)
    if (!stats.bySpecialist[event.toSpecialist]) {
      stats.bySpecialist[event.toSpecialist] = { sent: 0, received: 0 };
    }
    stats.bySpecialist[event.toSpecialist].received++;

    // Count by status
    stats.byStatus[event.status] = (stats.byStatus[event.status] || 0) + 1;

    // Count for success rate (only completed items)
    if (event.status === 'completed' || event.status === 'failed') {
      completedCount++;
      if (event.result === 'success') {
        successCount++;
      }
    }

    // Count queue depth (queued or processing)
    if (event.status === 'queued' || event.status === 'processing') {
      stats.queueDepth++;
    }
  }

  // Calculate success rate
  stats.successRate = completedCount > 0 ? successCount / completedCount : 0;

  return stats;
}

/**
 * Get handoffs from today
 *
 * @returns Array of specialist handoff events from today
 */
export function getTodaySpecialistHandoffs(): SpecialistHandoff[] {
  const events = readSpecialistHandoffs();
  const today = new Date().toISOString().split('T')[0];
  return events.filter(e => e.timestamp.startsWith(today));
}
