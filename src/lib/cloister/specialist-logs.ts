/**
 * Specialist Log Management
 *
 * Manages persistent log files for specialist agent runs.
 * Each run produces a structured log file with metadata, context, and full transcript.
 *
 * Directory structure:
 *   ~/.panopticon/specialists/{projectKey}/{specialistType}/runs/{timestamp}-{issueId}.log
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { Data, Effect } from 'effect';
import { getPanopticonHome } from '../paths.js';

/** Get specialists directory (lazy to support test env overrides) */
function getSpecialistsDir(): string {
  return join(getPanopticonHome(), 'specialists');
}

/**
 * Log file metadata
 */
export interface RunLogMetadata {
  runId: string;
  project: string;
  specialistType: string;
  issueId: string;
  startedAt: string;
  finishedAt?: string;
  status?: 'passed' | 'failed' | 'blocked' | 'incomplete';
  duration?: number; // in milliseconds
  notes?: string;
}

/**
 * Run log entry for listing
 */
export interface RunLogEntry {
  runId: string;
  filePath: string;
  metadata: RunLogMetadata;
  fileSize: number;
  createdAt: Date;
}

/**
 * Get the runs directory for a project's specialist
 */
export function getRunsDirectory(projectKey: string, specialistType: string): string {
  return join(getSpecialistsDir(), projectKey, specialistType, 'runs');
}

/**
 * Generate a run ID from timestamp and issue ID
 */
export function generateRunId(issueId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  return `${timestamp}-${issueId}`;
}

/**
 * Get the log file path for a run
 */
export function getRunLogPath(projectKey: string, specialistType: string, runId: string): string {
  const runsDir = getRunsDirectory(projectKey, specialistType);
  return join(runsDir, `${runId}.log`);
}

/**
 * Ensure runs directory exists for a project's specialist
 */
function ensureRunsDirectory(projectKey: string, specialistType: string): void {
  const runsDir = getRunsDirectory(projectKey, specialistType);
  if (!existsSync(runsDir)) {
    mkdirSync(runsDir, { recursive: true });
  }
}

/**
 * Create a new run log file
 *
 * Initializes a log file with metadata header.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type (review-agent, test-agent, merge-agent)
 * @param issueId - Issue ID being worked on
 * @param contextSeed - Optional context digest that was provided to the specialist
 * @returns Run ID and file path
 */
export function createRunLogSync(
  projectKey: string,
  specialistType: string,
  issueId: string,
  contextSeed?: string
): { runId: string; filePath: string } {
  ensureRunsDirectory(projectKey, specialistType);

  const runId = generateRunId(issueId);
  const filePath = getRunLogPath(projectKey, specialistType, runId);
  const startedAt = new Date().toISOString();

  // Create log header
  const header = `# ${specialistType} Run - ${issueId}
Project: ${projectKey}
Started: ${startedAt}
Issue: ${issueId}
Run ID: ${runId}

## Context Seed
${contextSeed ? contextSeed : '[No context digest available]'}

## Session Transcript
`;

  writeFileSync(filePath, header, 'utf-8');

  return { runId, filePath };
}

/**
 * Append content to a run log
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param runId - Run identifier
 * @param content - Content to append
 */
export function appendToRunLogSync(
  projectKey: string,
  specialistType: string,
  runId: string,
  content: string
): void {
  const filePath = getRunLogPath(projectKey, specialistType, runId);

  if (!existsSync(filePath)) {
    throw new Error(`Run log not found: ${filePath}`);
  }

  appendFileSync(filePath, content, 'utf-8');
}

/**
 * Finalize a run log with result metadata
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param runId - Run identifier
 * @param result - Run result
 */
export function finalizeRunLogSync(
  projectKey: string,
  specialistType: string,
  runId: string,
  result: {
    status: 'passed' | 'failed' | 'blocked' | 'incomplete';
    notes?: string;
  }
): void {
  const filePath = getRunLogPath(projectKey, specialistType, runId);

  if (!existsSync(filePath)) {
    throw new Error(`Run log not found: ${filePath}`);
  }

  // Read the log to extract start time
  const content = readFileSync(filePath, 'utf-8');
  const startMatch = content.match(/^Started: (.+)$/m);
  const startedAt = startMatch ? new Date(startMatch[1]) : new Date();
  const finishedAt = new Date();
  const duration = finishedAt.getTime() - startedAt.getTime();

  // Format duration
  const durationSeconds = Math.floor(duration / 1000);
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const durationStr = `${minutes}m ${seconds}s`;

  // Append result section
  const resultSection = `

## Result
Status: ${result.status}
${result.notes ? `Notes: ${result.notes}` : ''}
Duration: ${durationStr}
Finished: ${finishedAt.toISOString()}
`;

  appendFileSync(filePath, resultSection, 'utf-8');
}

/**
 * Read a run log file
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param runId - Run identifier
 * @returns Log content or null if not found
 */
export function getRunLogSync(
  projectKey: string,
  specialistType: string,
  runId: string
): string | null {
  const filePath = getRunLogPath(projectKey, specialistType, runId);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.error(`Failed to read run log ${runId}:`, error);
    return null;
  }
}

/**
 * Parse metadata from a log file
 *
 * @param logContent - Log file content
 * @returns Parsed metadata
 */
export function parseLogMetadata(logContent: string): Partial<RunLogMetadata> {
  const metadata: Partial<RunLogMetadata> = {};

  // Extract metadata from header
  const projectMatch = logContent.match(/^Project: (.+)$/m);
  const startedMatch = logContent.match(/^Started: (.+)$/m);
  const issueMatch = logContent.match(/^Issue: (.+)$/m);
  const runIdMatch = logContent.match(/^Run ID: (.+)$/m);
  const statusMatch = logContent.match(/^Status: (.+)$/m);
  const notesMatch = logContent.match(/^Notes: (.+)$/m);
  const finishedMatch = logContent.match(/^Finished: (.+)$/m);
  const durationMatch = logContent.match(/^Duration: (.+)$/m);

  if (projectMatch) metadata.project = projectMatch[1].trim();
  if (startedMatch) metadata.startedAt = startedMatch[1].trim();
  if (issueMatch) metadata.issueId = issueMatch[1].trim();
  if (runIdMatch) metadata.runId = runIdMatch[1].trim();
  if (statusMatch) metadata.status = statusMatch[1].trim() as RunLogMetadata['status'];
  if (notesMatch) metadata.notes = notesMatch[1].trim();
  if (finishedMatch) metadata.finishedAt = finishedMatch[1].trim();

  // Parse duration if available
  if (durationMatch) {
    const durationStr = durationMatch[1].trim();
    const minutesMatch = durationStr.match(/(\d+)m/);
    const secondsMatch = durationStr.match(/(\d+)s/);
    const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
    const seconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;
    metadata.duration = (minutes * 60 + seconds) * 1000;
  }

  return metadata;
}

/**
 * List all run logs for a project's specialist
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param options - Listing options
 * @returns Array of run log entries, sorted by most recent first
 */
export function listRunLogsSync(
  projectKey: string,
  specialistType: string,
  options: {
    limit?: number;
    offset?: number;
  } = {}
): RunLogEntry[] {
  const runsDir = getRunsDirectory(projectKey, specialistType);

  if (!existsSync(runsDir)) {
    return [];
  }

  try {
    const files = readdirSync(runsDir)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const filePath = join(runsDir, f);
        const stats = statSync(filePath);
        const runId = basename(f, '.log');

        // Read file to extract metadata
        const content = readFileSync(filePath, 'utf-8');
        const metadata = parseLogMetadata(content);

        return {
          runId,
          filePath,
          metadata: {
            runId,
            project: projectKey,
            specialistType,
            issueId: metadata.issueId || 'unknown',
            startedAt: metadata.startedAt || stats.birthtime.toISOString(),
            finishedAt: metadata.finishedAt,
            status: metadata.status,
            duration: metadata.duration,
            notes: metadata.notes,
          },
          fileSize: stats.size,
          createdAt: stats.birthtime,
        };
      });

    // Sort by most recent first, with runId as tiebreaker for stable ordering
    files.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.runId.localeCompare(a.runId);
    });

    // Apply pagination
    const { limit, offset = 0 } = options;
    if (limit !== undefined) {
      return files.slice(offset, offset + limit);
    }

    return files.slice(offset);
  } catch (error) {
    console.error(`Failed to list run logs for ${projectKey}/${specialistType}:`, error);
    return [];
  }
}

/**
 * Get the most recent N run logs
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param count - Number of recent runs to retrieve
 * @returns Array of recent run log entries
 */
export function getRecentRunLogs(
  projectKey: string,
  specialistType: string,
  count: number
): RunLogEntry[] {
  return listRunLogsSync(projectKey, specialistType, { limit: count });
}

/**
 * Clean up old run logs based on retention policy
 *
 * Keeps logs that match either criteria (whichever is more permissive):
 * - Within maxDays
 * - Within the last maxRuns count
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param retention - Retention policy
 * @returns Number of logs deleted
 */
export function cleanupOldLogsSync(
  projectKey: string,
  specialistType: string,
  retention: { maxDays: number; maxRuns: number }
): number {
  const { maxDays, maxRuns } = retention;

  // Compute cutoff BEFORE reading file stats. This ensures all files that existed
  // when cleanup was invoked have birthtimes <= cutoffDate when maxDays=0, avoiding
  // a race where a file created in the same millisecond as cutoffDate would be
  // incorrectly retained by a >= comparison.
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);

  const allLogs = listRunLogsSync(projectKey, specialistType);

  if (allLogs.length === 0) {
    return 0;
  }

  let deletedCount = 0;

  allLogs.forEach((log, index) => {
    // Keep if within maxRuns (most recent N runs)
    if (index < maxRuns) {
      return;
    }

    // Keep if within maxDays. Skip the age check entirely when maxDays=0, because
    // "within 0 days" means no age-based protection — only maxRuns applies.
    // This avoids a timing/rounding issue: Node.js converts nanosecond birthtime
    // to milliseconds using standard rounding, so a file created at 431.6ms gets
    // birthtime 432ms. If cutoff is 431ms (same wall-clock millisecond), the file
    // incorrectly appears newer than the cutoff and gets retained.
    if (maxDays > 0 && log.createdAt >= cutoffDate) {
      return;
    }

    // Delete this log
    try {
      unlinkSync(log.filePath);
      deletedCount++;
      console.log(`[specialist-logs] Deleted old log: ${log.runId}`);
    } catch (error) {
      console.error(`[specialist-logs] Failed to delete ${log.runId}:`, error);
    }
  });

  return deletedCount;
}

/**
 * Check if a run log is still active (not finalized)
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param runId - Run identifier
 * @returns True if log exists but has no result section yet
 */
export function isRunLogActive(
  projectKey: string,
  specialistType: string,
  runId: string
): boolean {
  const content = getRunLogSync(projectKey, specialistType, runId);

  if (!content) {
    return false;
  }

  // Check if Result section exists
  return !content.includes('## Result');
}

/**
 * Get file size of a run log (useful for truncation check)
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param runId - Run identifier
 * @returns File size in bytes or null if not found
 */
export function getRunLogSize(
  projectKey: string,
  specialistType: string,
  runId: string
): number | null {
  const filePath = getRunLogPath(projectKey, specialistType, runId);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const stats = statSync(filePath);
    return stats.size;
  } catch (error) {
    return null;
  }
}

/**
 * Maximum log file size (10MB) before truncation warning
 */
export const MAX_LOG_SIZE = 10 * 1024 * 1024;

/**
 * Check if a log file is approaching or exceeding size limits
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param runId - Run identifier
 * @returns Warning info or null if size is OK
 */
export function checkLogSizeLimit(
  projectKey: string,
  specialistType: string,
  runId: string
): { exceeded: boolean; size: number; limit: number } | null {
  const size = getRunLogSize(projectKey, specialistType, runId);

  if (size === null) {
    return null;
  }

  if (size >= MAX_LOG_SIZE) {
    return {
      exceeded: true,
      size,
      limit: MAX_LOG_SIZE,
    };
  }

  return null;
}

/**
 * Clean up old logs for all projects and specialists
 *
 * Runs cleanup based on retention policies configured in projects.yaml.
 * This should be called periodically (e.g., daily cron job).
 *
 * @returns Summary of cleanup results
 */
export function cleanupAllLogsSync(): {
  totalDeleted: number;
  byProject: Record<string, Record<string, number>>;
} {
  const { listProjectsWithSpecialists } = require('./specialists.js');
  const { getSpecialistRetention } = require('../projects.js');

  const results = {
    totalDeleted: 0,
    byProject: {} as Record<string, Record<string, number>>,
  };

  const projects = listProjectsWithSpecialists();

  for (const projectKey of projects) {
    results.byProject[projectKey] = {};

    // Get retention policy for this project
    const retention = getSpecialistRetention(projectKey);

    // Clean up each specialist type
    const specialistTypes = ['review-agent', 'test-agent', 'merge-agent'];

    for (const specialistType of specialistTypes) {
      const deleted = cleanupOldLogsSync(projectKey, specialistType, retention);

      if (deleted > 0) {
        results.byProject[projectKey][specialistType] = deleted;
        results.totalDeleted += deleted;
      }
    }
  }

  console.log(`[specialist-logs] Cleanup complete: deleted ${results.totalDeleted} old logs`);

  return results;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect wrappers around the existing sync APIs. The underlying file
// I/O is sync (CLI-callable); these variants lift thrown exceptions into a
// typed error channel so callers can compose specialist-log operations with
// other Effect-native code. Migrate callers individually.

/** Tagged error for specialist-log Effect variants. */
export class SpecialistLogError extends Data.TaggedError('SpecialistLogError')<{
  readonly projectKey: string;
  readonly specialistType: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

const liftLogError = (
  projectKey: string,
  specialistType: string,
  operation: string,
  cause: unknown,
): SpecialistLogError =>
  new SpecialistLogError({
    projectKey,
    specialistType,
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** Effect variant of `createRunLog`. */
export const createRunLog = (
  projectKey: string,
  specialistType: string,
  issueId: string,
  contextSeed?: string,
): Effect.Effect<{ runId: string; filePath: string }, SpecialistLogError> =>
  Effect.try({
    try: () => createRunLogSync(projectKey, specialistType, issueId, contextSeed),
    catch: (cause) => liftLogError(projectKey, specialistType, 'createRunLog', cause),
  });

/** Effect variant of `appendToRunLog`. */
export const appendToRunLog = (
  projectKey: string,
  specialistType: string,
  runId: string,
  content: string,
): Effect.Effect<void, SpecialistLogError> =>
  Effect.try({
    try: () => appendToRunLogSync(projectKey, specialistType, runId, content),
    catch: (cause) => liftLogError(projectKey, specialistType, 'appendToRunLog', cause),
  });

/** Effect variant of `finalizeRunLog`. */
export const finalizeRunLog = (
  projectKey: string,
  specialistType: string,
  runId: string,
  result: { status: 'passed' | 'failed' | 'blocked' | 'incomplete'; notes?: string },
): Effect.Effect<void, SpecialistLogError> =>
  Effect.try({
    try: () => finalizeRunLogSync(projectKey, specialistType, runId, result),
    catch: (cause) => liftLogError(projectKey, specialistType, 'finalizeRunLog', cause),
  });

/** Effect variant of `getRunLog`. */
export const getRunLog = (
  projectKey: string,
  specialistType: string,
  runId: string,
): Effect.Effect<string | null, SpecialistLogError> =>
  Effect.try({
    try: () => getRunLogSync(projectKey, specialistType, runId),
    catch: (cause) => liftLogError(projectKey, specialistType, 'getRunLog', cause),
  });

/** Effect variant of `listRunLogs`. */
export const listRunLogs = (
  projectKey: string,
  specialistType: string,
  options: { limit?: number; offset?: number } = {},
): Effect.Effect<RunLogEntry[], SpecialistLogError> =>
  Effect.try({
    try: () => listRunLogsSync(projectKey, specialistType, options),
    catch: (cause) => liftLogError(projectKey, specialistType, 'listRunLogs', cause),
  });

/** Effect variant of `cleanupOldLogs`. */
export const cleanupOldLogs = (
  projectKey: string,
  specialistType: string,
  retention: { maxDays: number; maxRuns: number },
): Effect.Effect<number, SpecialistLogError> =>
  Effect.try({
    try: () => cleanupOldLogsSync(projectKey, specialistType, retention),
    catch: (cause) => liftLogError(projectKey, specialistType, 'cleanupOldLogs', cause),
  });

/** Effect variant of `cleanupAllLogs`. */
export const cleanupAllLogs = (): Effect.Effect<
  { totalDeleted: number; byProject: Record<string, Record<string, number>> },
  SpecialistLogError
> =>
  Effect.try({
    try: () => cleanupAllLogsSync(),
    catch: (cause) => liftLogError('*', '*', 'cleanupAllLogs', cause),
  });
