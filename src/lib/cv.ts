/**
 * Agent CV (Work History) System
 *
 * Tracks agent performance over time to enable capability-based routing.
 */

import { Effect } from 'effect';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { AGENTS_DIR } from './paths.js';
import { FsError } from './errors.js';

export interface WorkEntry {
  issueId: string;
  startedAt: string;
  completedAt?: string;
  outcome: 'success' | 'failed' | 'abandoned' | 'in_progress';
  duration?: number; // minutes
  skills?: string[];
  failureReason?: string;
  commits?: number;
  linesChanged?: number;
}

export interface AgentCV {
  agentId: string;
  createdAt: string;
  lastActive: string;
  runtime: string;
  model: string;
  stats: {
    totalIssues: number;
    successCount: number;
    failureCount: number;
    abandonedCount: number;
    avgDuration: number; // minutes
    successRate: number; // 0-1
  };
  skillsUsed: string[];
  recentWork: WorkEntry[];
}

function getCVFile(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'cv.json');
}

/**
 * Get or create an agent's CV
 */
export function getAgentCVSync(agentId: string): AgentCV {
  const cvFile = getCVFile(agentId);

  if (existsSync(cvFile)) {
    try {
      return JSON.parse(readFileSync(cvFile, 'utf-8'));
    } catch {}
  }

  // Create new CV
  const cv: AgentCV = {
    agentId,
    createdAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    runtime: 'claude',
    model: 'sonnet',
    stats: {
      totalIssues: 0,
      successCount: 0,
      failureCount: 0,
      abandonedCount: 0,
      avgDuration: 0,
      successRate: 0,
    },
    skillsUsed: [],
    recentWork: [],
  };

  saveAgentCVSync(cv);
  return cv;
}

/**
 * Save an agent's CV
 */
export function saveAgentCVSync(cv: AgentCV): void {
  const dir = join(AGENTS_DIR, cv.agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(getCVFile(cv.agentId), JSON.stringify(cv, null, 2));
}

/**
 * Start tracking work for an agent
 */
export function startWorkSync(agentId: string, issueId: string, skills?: string[]): void {
  const cv = getAgentCVSync(agentId);

  const entry: WorkEntry = {
    issueId,
    startedAt: new Date().toISOString(),
    outcome: 'in_progress',
    skills,
  };

  cv.recentWork.unshift(entry);
  cv.stats.totalIssues++;
  cv.lastActive = new Date().toISOString();

  // Track skills
  if (skills) {
    for (const skill of skills) {
      if (!cv.skillsUsed.includes(skill)) {
        cv.skillsUsed.push(skill);
      }
    }
  }

  // Keep only last 50 entries
  if (cv.recentWork.length > 50) {
    cv.recentWork = cv.recentWork.slice(0, 50);
  }

  saveAgentCVSync(cv);
}

/**
 * Complete work for an agent
 */
export function completeWorkSync(
  agentId: string,
  issueId: string,
  outcome: 'success' | 'failed' | 'abandoned',
  details?: { commits?: number; linesChanged?: number; failureReason?: string }
): void {
  const cv = getAgentCVSync(agentId);

  // Find the work entry
  const entry = cv.recentWork.find(
    (w) => w.issueId === issueId && w.outcome === 'in_progress'
  );

  if (entry) {
    entry.outcome = outcome;
    entry.completedAt = new Date().toISOString();
    entry.duration = Math.round(
      (new Date().getTime() - new Date(entry.startedAt).getTime()) / (1000 * 60)
    );
    if (details?.commits) entry.commits = details.commits;
    if (details?.linesChanged) entry.linesChanged = details.linesChanged;
    if (details?.failureReason) entry.failureReason = details.failureReason;
  }

  // Update stats
  if (outcome === 'success') {
    cv.stats.successCount++;
  } else if (outcome === 'failed') {
    cv.stats.failureCount++;
  } else if (outcome === 'abandoned') {
    cv.stats.abandonedCount++;
  }

  // Calculate success rate
  const completed = cv.stats.successCount + cv.stats.failureCount + cv.stats.abandonedCount;
  cv.stats.successRate = completed > 0 ? cv.stats.successCount / completed : 0;

  // Calculate average duration (only from completed work)
  const completedEntries = cv.recentWork.filter(
    (w) => w.duration !== undefined && w.outcome !== 'in_progress'
  );
  if (completedEntries.length > 0) {
    const totalDuration = completedEntries.reduce((sum, w) => sum + (w.duration || 0), 0);
    cv.stats.avgDuration = Math.round(totalDuration / completedEntries.length);
  }

  cv.lastActive = new Date().toISOString();
  saveAgentCVSync(cv);
}

/**
 * Get agent rankings by success rate
 */
export function getAgentRankingsSync(): Array<{
  agentId: string;
  successRate: number;
  totalIssues: number;
  avgDuration: number;
}> {
  const rankings: Array<{
    agentId: string;
    successRate: number;
    totalIssues: number;
    avgDuration: number;
  }> = [];

  if (!existsSync(AGENTS_DIR)) return rankings;

  const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true }).filter(
    (d) => d.isDirectory()
  );

  for (const dir of dirs) {
    const cv = getAgentCVSync(dir.name);
    if (cv.stats.totalIssues > 0) {
      rankings.push({
        agentId: dir.name,
        successRate: cv.stats.successRate,
        totalIssues: cv.stats.totalIssues,
        avgDuration: cv.stats.avgDuration,
      });
    }
  }

  // Sort by success rate, then by total issues
  rankings.sort((a, b) => {
    if (b.successRate !== a.successRate) {
      return b.successRate - a.successRate;
    }
    return b.totalIssues - a.totalIssues;
  });

  return rankings;
}

/**
 * Format CV for display
 */
export function formatCVSync(cv: AgentCV): string {
  const lines: string[] = [
    `# Agent CV: ${cv.agentId}`,
    '',
    `Runtime: ${cv.runtime} (${cv.model})`,
    `Created: ${cv.createdAt}`,
    `Last Active: ${cv.lastActive}`,
    '',
    '## Statistics',
    '',
    `- Total Issues: ${cv.stats.totalIssues}`,
    `- Success Rate: ${(cv.stats.successRate * 100).toFixed(1)}%`,
    `- Successes: ${cv.stats.successCount}`,
    `- Failures: ${cv.stats.failureCount}`,
    `- Abandoned: ${cv.stats.abandonedCount}`,
    `- Avg Duration: ${cv.stats.avgDuration} minutes`,
    '',
  ];

  if (cv.skillsUsed.length > 0) {
    lines.push('## Skills Used');
    lines.push('');
    lines.push(cv.skillsUsed.join(', '));
    lines.push('');
  }

  if (cv.recentWork.length > 0) {
    lines.push('## Recent Work');
    lines.push('');

    for (const work of cv.recentWork.slice(0, 10)) {
      const statusIcon = {
        success: '✓',
        failed: '✗',
        abandoned: '⊘',
        in_progress: '●',
      }[work.outcome];

      const duration = work.duration ? ` (${work.duration}m)` : '';
      lines.push(`${statusIcon} ${work.issueId}${duration}`);

      if (work.failureReason) {
        lines.push(`  Reason: ${work.failureReason}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// CV file IO is sync by design. Read paths return Effect.sync; write paths
// surface FsError.

/** Load (or create) the CV for an agent. Pure-ish. */
export const getAgentCV = (agentId: string): Effect.Effect<AgentCV> =>
  Effect.sync(() => getAgentCVSync(agentId));

/** Persist a CV to disk. */
export const saveAgentCV = (cv: AgentCV): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => saveAgentCVSync(cv),
    catch: (cause) =>
      new FsError({ path: cv.agentId, operation: 'save-agent-cv', cause }),
  });

/** Mark the start of a work item on an agent's CV. */
export const startWork = (
  agentId: string,
  issueId: string,
  skills?: string[],
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => startWorkSync(agentId, issueId, skills),
    catch: (cause) =>
      new FsError({ path: agentId, operation: 'cv-start-work', cause }),
  });

/** Mark completion (success / failure / abandoned). */
export const completeWork = (
  ...args: Parameters<typeof completeWorkSync>
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => completeWorkSync(...args),
    catch: (cause) =>
      new FsError({ path: args[0], operation: 'cv-complete-work', cause }),
  });

/** Aggregate rankings across all agents. Pure-ish. */
export const getAgentRankings = (): Effect.Effect<
  ReturnType<typeof getAgentRankingsSync>
> => Effect.sync(() => getAgentRankingsSync());

/** Render a CV as text. Pure. */
export const formatCV = (cv: AgentCV): Effect.Effect<string> =>
  Effect.sync(() => formatCVSync(cv));
