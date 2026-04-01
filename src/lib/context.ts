/**
 * Context Engineering System
 *
 * Implements GSD-Plus patterns for structured context management:
 * - STATE.md: Agent state that survives compaction
 * - WORKSPACE.md: Project context
 * - SUMMARY.md: Work artifacts
 * - Queryable history files
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { AGENTS_DIR } from './paths.js';

export interface AgentStateContext {
  issueId: string;
  status: string;
  lastActivity: string;
  lastCheckpoint?: string;
  resumePoint?: string;
  contextRefs: {
    workspace?: string;
    prd?: string;
    beads?: string;
  };
}

export interface SummaryEntry {
  title: string;
  completedAt: string;
  duration?: number;
  whatWasDone: string[];
  keyInsights?: string[];
  filesModified?: string[];
}

// ============== STATE.md ==============

function getStateFile(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'STATE.md');
}

/**
 * Read current STATE.md for an agent
 */
export function readAgentState(agentId: string): AgentStateContext | null {
  const stateFile = getStateFile(agentId);
  if (!existsSync(stateFile)) return null;

  try {
    const content = readFileSync(stateFile, 'utf-8');
    return parseStateMd(content);
  } catch {
    return null;
  }
}

/**
 * Write STATE.md for an agent
 */
export function writeAgentState(agentId: string, state: AgentStateContext): void {
  const dir = join(AGENTS_DIR, agentId);
  mkdirSync(dir, { recursive: true });

  const content = generateStateMd(state);
  writeFileSync(getStateFile(agentId), content);
}

/**
 * Update checkpoint in STATE.md
 */
export function updateCheckpoint(agentId: string, checkpoint: string, resumePoint?: string): void {
  const state = readAgentState(agentId);
  if (!state) return;

  state.lastActivity = new Date().toISOString();
  state.lastCheckpoint = checkpoint;
  if (resumePoint) {
    state.resumePoint = resumePoint;
  }

  writeAgentState(agentId, state);
}

function generateStateMd(state: AgentStateContext): string {
  const lines: string[] = [
    `# Agent State: ${state.issueId}`,
    '',
    '## Current Position',
    '',
    `Issue: ${state.issueId}`,
    `Status: ${state.status}`,
    `Last activity: ${state.lastActivity}`,
    '',
  ];

  if (state.lastCheckpoint) {
    lines.push('## Session Continuity');
    lines.push('');
    lines.push(`Last checkpoint: "${state.lastCheckpoint}"`);
    if (state.resumePoint) {
      lines.push(`Resume point: "${state.resumePoint}"`);
    }
    lines.push('');
  }

  if (state.contextRefs.workspace || state.contextRefs.prd || state.contextRefs.beads) {
    lines.push('## Context References');
    lines.push('');
    if (state.contextRefs.workspace) {
      lines.push(`- Workspace: ${state.contextRefs.workspace}`);
    }
    if (state.contextRefs.prd) {
      lines.push(`- PRD: ${state.contextRefs.prd}`);
    }
    if (state.contextRefs.beads) {
      lines.push(`- Beads: ${state.contextRefs.beads}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function parseStateMd(content: string): AgentStateContext {
  const state: AgentStateContext = {
    issueId: '',
    status: '',
    lastActivity: '',
    contextRefs: {},
  };

  // Parse issue ID from title
  const titleMatch = content.match(/# Agent State: (.+)/);
  if (titleMatch) state.issueId = titleMatch[1].trim();

  // Parse status
  const statusMatch = content.match(/Status: (.+)/);
  if (statusMatch) state.status = statusMatch[1].trim();

  // Parse last activity
  const activityMatch = content.match(/Last activity: (.+)/);
  if (activityMatch) state.lastActivity = activityMatch[1].trim();

  // Parse checkpoint
  const checkpointMatch = content.match(/Last checkpoint: "(.+)"/);
  if (checkpointMatch) state.lastCheckpoint = checkpointMatch[1];

  // Parse resume point
  const resumeMatch = content.match(/Resume point: "(.+)"/);
  if (resumeMatch) state.resumePoint = resumeMatch[1];

  // Parse context refs
  const workspaceMatch = content.match(/- Workspace: (.+)/);
  if (workspaceMatch) state.contextRefs.workspace = workspaceMatch[1].trim();

  const prdMatch = content.match(/- PRD: (.+)/);
  if (prdMatch) state.contextRefs.prd = prdMatch[1].trim();

  const beadsMatch = content.match(/- Beads: (.+)/);
  if (beadsMatch) state.contextRefs.beads = beadsMatch[1].trim();

  return state;
}

// ============== SUMMARY.md ==============

function getSummaryFile(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'SUMMARY.md');
}

/**
 * Append a work summary to SUMMARY.md
 */
export function appendSummary(agentId: string, summary: SummaryEntry): void {
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
export function logHistory(
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
export function searchHistory(agentId: string, pattern: string): string[] {
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
export function getRecentHistory(agentId: string, limit: number = 20): string[] {
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
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if context budget allows adding more content
 */
export function checkContextBudget(
  budget: ContextBudget,
  newContent: string
): { allowed: boolean; warning: boolean; remaining: number } {
  const newTokens = estimateTokens(newContent);
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
export function createContextBudget(maxTokens: number = 100000): ContextBudget {
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
export function materializeOutput(
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
  logHistory(agentId, `materialized:${toolName}`, { file: filename });

  return filepath;
}

/**
 * List materialized outputs for an agent
 */
export function listMaterialized(agentId: string): Array<{
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
export function readMaterialized(filepath: string): string | null {
  if (!existsSync(filepath)) return null;
  return readFileSync(filepath, 'utf-8');
}
