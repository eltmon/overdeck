/**
 * Context Engineering System
 *
 * Implements GSD-Plus patterns for structured context management:
 * - WORKSPACE.md: Project context
 * - SUMMARY.md: Work artifacts
 * - Queryable history files
 *
 * Workspace-level orchestration state lives in `<workspace>/.pan/continue.json`,
 * not here.
 */

import { Effect } from 'effect';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { AGENTS_DIR } from './paths.js';
import { FsError } from './errors.js';

export interface SummaryEntry {
  title: string;
  completedAt: string;
  duration?: number;
  whatWasDone: string[];
  keyInsights?: string[];
  filesModified?: string[];
}

// ============== SUMMARY.md ==============

function getSummaryFile(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'SUMMARY.md');
}

/**
 * Append a work summary to SUMMARY.md
 */
export function appendSummarySync(agentId: string, summary: SummaryEntry): void {
  const dir = join(AGENTS_DIR, agentId);
  mkdirSync(dir, { recursive: true });

  const summaryFile = getSummaryFile(agentId);
  const content = generateSummaryEntry(summary);

  if (existsSync(summaryFile)) {
    appendFileSync(summaryFile, '\n---\n\n' + content);
  } else {
    writeFileSync(summaryFile, '# Work Summaries\n\n' + content);
  }
}

function generateSummaryEntry(summary: SummaryEntry): string {
  const lines: string[] = [
    `## ${summary.title}`,
    '',
    `**Completed:** ${summary.completedAt}`,
  ];

  if (summary.duration) {
    lines.push(`**Duration:** ${summary.duration} minutes`);
  }

  lines.push('');
  lines.push('### What Was Done');
  lines.push('');

  for (let i = 0; i < summary.whatWasDone.length; i++) {
    lines.push(`${i + 1}. ${summary.whatWasDone[i]}`);
  }

  if (summary.keyInsights && summary.keyInsights.length > 0) {
    lines.push('');
    lines.push('### Key Insights');
    lines.push('');
    for (let i = 0; i < summary.keyInsights.length; i++) {
      lines.push(`${i + 1}. ${summary.keyInsights[i]}`);
    }
  }

  if (summary.filesModified && summary.filesModified.length > 0) {
    lines.push('');
    lines.push('### Files Modified');
    lines.push('');
    for (const file of summary.filesModified) {
      lines.push(`- ${file}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ============== History Files ==============

function getHistoryDir(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'history');
}

/**
 * Log an action to queryable history
 */
export function logHistorySync(
  agentId: string,
  action: string,
  details?: Record<string, any>
): void {
  const historyDir = getHistoryDir(agentId);
  mkdirSync(historyDir, { recursive: true });

  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  const historyFile = join(historyDir, `${dateStr}.log`);

  const timestamp = date.toISOString();
  const detailsStr = details ? ` ${JSON.stringify(details)}` : '';
  const logLine = `[${timestamp}] ${action}${detailsStr}\n`;

  appendFileSync(historyFile, logLine);
}

/**
 * Search history files for a pattern
 */
export function searchHistorySync(agentId: string, pattern: string): string[] {
  const historyDir = getHistoryDir(agentId);
  if (!existsSync(historyDir)) return [];

  const results: string[] = [];
  const regex = new RegExp(pattern, 'i');

  const files = readdirSync(historyDir).filter((f) => f.endsWith('.log'));
  files.sort().reverse(); // Most recent first

  for (const file of files) {
    const content = readFileSync(join(historyDir, file), 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (regex.test(line)) {
        results.push(line);
      }
    }
  }

  return results;
}

/**
 * Get recent history entries
 */
export function getRecentHistorySync(agentId: string, limit: number = 20): string[] {
  const historyDir = getHistoryDir(agentId);
  if (!existsSync(historyDir)) return [];

  const results: string[] = [];

  const files = readdirSync(historyDir).filter((f) => f.endsWith('.log'));
  files.sort().reverse(); // Most recent first

  for (const file of files) {
    if (results.length >= limit) break;

    const content = readFileSync(join(historyDir, file), 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());

    for (const line of lines.reverse()) {
      if (results.length >= limit) break;
      results.push(line);
    }
  }

  return results;
}

// ============== Context Budget ==============

export interface ContextBudget {
  maxTokens: number;
  usedTokens: number;
  warningThreshold: number; // e.g., 0.8 = warn at 80%
}

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
export function estimateTokensSync(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if context budget allows adding more content
 */
export function checkContextBudgetSync(
  budget: ContextBudget,
  newContent: string
): { allowed: boolean; warning: boolean; remaining: number } {
  const newTokens = estimateTokensSync(newContent);
  const totalUsed = budget.usedTokens + newTokens;
  const remaining = budget.maxTokens - totalUsed;
  const usageRatio = totalUsed / budget.maxTokens;

  return {
    allowed: totalUsed <= budget.maxTokens,
    warning: usageRatio >= budget.warningThreshold,
    remaining,
  };
}

/**
 * Create a context budget for a session
 */
export function createContextBudgetSync(maxTokens: number = 100000): ContextBudget {
  return {
    maxTokens,
    usedTokens: 0,
    warningThreshold: 0.8,
  };
}

// ============== Context Materialization ==============

function getMaterializedDir(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'materialized');
}

/**
 * Materialize tool output for later retrieval
 */
export function materializeOutputSync(
  agentId: string,
  toolName: string,
  output: string,
  metadata?: Record<string, any>
): string {
  const dir = getMaterializedDir(agentId);
  mkdirSync(dir, { recursive: true });

  const timestamp = Date.now();
  const filename = `${toolName}-${timestamp}.md`;
  const filepath = join(dir, filename);

  const lines: string[] = [
    `# Tool Output: ${toolName}`,
    '',
    `**Timestamp:** ${new Date(timestamp).toISOString()}`,
  ];

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      lines.push(`**${key}:** ${value}`);
    }
  }

  lines.push('');
  lines.push('## Output');
  lines.push('');
  lines.push('```');
  lines.push(output);
  lines.push('```');
  lines.push('');

  writeFileSync(filepath, lines.join('\n'));

  // Log to history
  logHistorySync(agentId, `materialized:${toolName}`, { file: filename });

  return filepath;
}

/**
 * List materialized outputs for an agent
 */
export function listMaterializedSync(agentId: string): Array<{
  tool: string;
  timestamp: number;
  file: string;
}> {
  const dir = getMaterializedDir(agentId);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const match = f.match(/^(.+)-(\d+)\.md$/);
      if (!match) return null;
      return {
        tool: match[1],
        timestamp: parseInt(match[2], 10),
        file: join(dir, f),
      };
    })
    .filter(Boolean) as Array<{ tool: string; timestamp: number; file: string }>;
}

/**
 * Read materialized output
 */
export function readMaterializedSync(filepath: string): string | null {
  if (!existsSync(filepath)) return null;
  return readFileSync(filepath, 'utf-8');
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Context-engineering helpers — sync FS by design (CLI / agent-local), wrapped
// for callers in Effect graphs. FsError surfaces only on write paths.

/** Append a work-summary entry for an agent. */
export const appendSummary = (
  agentId: string,
  summary: SummaryEntry,
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => appendSummarySync(agentId, summary),
    catch: (cause) =>
      new FsError({ path: agentId, operation: 'append-summary', cause }),
  });

/** Append a history entry for an agent. */
export const logHistory = (
  ...args: Parameters<typeof logHistorySync>
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => logHistorySync(...args),
    catch: (cause) =>
      new FsError({ path: args[0], operation: 'log-history', cause }),
  });

/** Search agent history for a regex pattern. Pure-ish (logs on error). */
export const searchHistory = (
  agentId: string,
  pattern: string,
): Effect.Effect<string[]> => Effect.sync(() => searchHistorySync(agentId, pattern));

/** Return the most recent history entries for an agent. Pure-ish. */
export const getRecentHistory = (
  agentId: string,
  limit: number = 20,
): Effect.Effect<string[]> => Effect.sync(() => getRecentHistorySync(agentId, limit));

/** Estimate token count from text. Pure. */
export const estimateTokens = (text: string): Effect.Effect<number> =>
  Effect.sync(() => estimateTokensSync(text));

/** Check a context budget against a token estimate. Pure. */
export const checkContextBudget = (
  ...args: Parameters<typeof checkContextBudgetSync>
): Effect.Effect<ReturnType<typeof checkContextBudgetSync>> =>
  Effect.sync(() => checkContextBudgetSync(...args));

/** Construct a new context budget. Pure. */
export const createContextBudget = (
  maxTokens: number = 100000,
): Effect.Effect<ContextBudget> => Effect.sync(() => createContextBudgetSync(maxTokens));

/** Materialize agent output to a file (returns filepath). */
export const materializeOutput = (
  ...args: Parameters<typeof materializeOutputSync>
): Effect.Effect<ReturnType<typeof materializeOutputSync>, FsError> =>
  Effect.try({
    try: () => materializeOutputSync(...args),
    catch: (cause) =>
      new FsError({ path: args[0], operation: 'materialize-output', cause }),
  });

/** Enumerate materialized files for an agent. Pure-ish. */
export const listMaterialized = (
  agentId: string,
): Effect.Effect<ReturnType<typeof listMaterializedSync>> =>
  Effect.sync(() => listMaterializedSync(agentId));

/** Read a materialized file's contents (null when missing). Pure-ish. */
export const readMaterialized = (
  filepath: string,
): Effect.Effect<string | null> => Effect.sync(() => readMaterializedSync(filepath));
