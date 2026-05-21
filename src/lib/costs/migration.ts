/**
 * Historical Data Migration for Cost Tracking
 *
 * Migrates historical session data to the event-sourced format.
 * Includes both main session files and subagent session files.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import { encodeClaudeProjectDir } from '../paths.js';
import { appendCostEvent, CostEvent, eventsFileExists, getLastEventMetadata } from './events.js';
import { getPricing, calculateCost, TokenUsage } from '../cost.js';
import { FsError } from '../errors.js';

// ============== Types ==============

export interface MigrationStats {
  agentsProcessed: number;
  sessionFilesProcessed: number;
  subagentFilesProcessed: number;
  eventsCreated: number;
  errors: Array<{ file: string; error: string }>;
  warnings: Array<{ file: string; message: string }>;
  totalCost: number;
  totalTokens: number;
}

interface SessionUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  timestamp?: string;
}

interface AgentContext {
  agentId: string;
  issueId: string;
  sessionType: string;
  workspace: string;
}

// ============== Path Helpers ==============
// Use functions for paths to allow test mocking via process.env.HOME
function getAgentsDir(): string {
  return join(process.env.HOME || homedir(), '.panopticon', 'agents');
}

function getClaudeProjectsDir(): string {
  return join(process.env.HOME || homedir(), '.claude', 'projects');
}

function getProjectsYamlPath(): string {
  return join(process.env.HOME || homedir(), '.panopticon', 'projects.yaml');
}

// ============== Workspace Resolution ==============

/**
 * Infer issueId from agent directory name
 * e.g., 'agent-pan-105' -> 'PAN-105', 'agent-min-663' -> 'MIN-663'
 */
function inferIssueId(agentDir: string): string | null {
  // Strip 'agent-' or 'planning-' prefix
  const stripped = agentDir.replace(/^(agent|planning)-/, '');
  // Match pattern like 'pan-105' or 'min-663'
  const match = stripped.match(/^([a-z]+)-(\d+)$/i);
  if (match) {
    return `${match[1].toUpperCase()}-${match[2]}`;
  }
  return null;
}

/**
 * Load project paths from projects.yaml
 */
function getProjectPaths(): string[] {
  const paths: string[] = [];
  try {
    const yamlPath = getProjectsYamlPath();
    if (existsSync(yamlPath)) {
      const content = readFileSync(yamlPath, 'utf-8');
      // Simple YAML parsing for path: values
      const pathMatches = content.match(/^\s+path:\s+(.+)$/gm);
      if (pathMatches) {
        for (const m of pathMatches) {
          const pathMatch = m.match(/path:\s+(.+)/);
          if (pathMatch) {
            paths.push(pathMatch[1].trim());
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }
  return paths;
}

/**
 * Try to find workspace directory for an issue
 * Searches known project paths for workspaces/feature-{issue-id}
 */
function resolveWorkspace(issueId: string): string | null {
  const issueLower = issueId.toLowerCase();
  const projectPaths = getProjectPaths();

  for (const projectPath of projectPaths) {
    const wsPath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    if (existsSync(wsPath)) {
      return wsPath;
    }
  }

  return null;
}

/**
 * Find Claude session directories by scanning the Claude projects dir
 * This is a fallback when workspace path is not known
 */
function findSessionDirsByIssue(issueId: string): string[] {
  const dirs: string[] = [];
  const issueLower = issueId.toLowerCase();
  const claudeDir = getClaudeProjectsDir();

  try {
    const entries = readdirSync(claudeDir);
    for (const entry of entries) {
      // Match directories that contain the issue ID pattern
      if (entry.includes(`feature-${issueLower}`)) {
        const fullPath = join(claudeDir, entry);
        dirs.push(fullPath);
      }
    }
  } catch {
    // Ignore errors
  }

  return dirs;
}

// ============== Session Parsing ==============

/**
 * Parse a single session JSONL file and extract usage data
 */
function parseSessionFile(filePath: string): SessionUsage[] {
  const usages: SessionUsage[] = [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Extract timestamp
        const timestamp = entry.timestamp || entry.ts || entry.created_at;

        // Extract model
        const model = entry.message?.model || entry.model;

        // Extract usage - can be at top level or in message
        const usage = entry.usage || entry.message?.usage;

        if (usage && model) {
          usages.push({
            model,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            cacheReadTokens: usage.cache_read_input_tokens || 0,
            cacheWriteTokens: usage.cache_creation_input_tokens || 0,
            timestamp,
          });
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    throw new Error(`Failed to read file: ${err}`);
  }

  return usages;
}

/**
 * Convert session usage to cost events
 */
function usageToCostEvents(
  usages: SessionUsage[],
  context: AgentContext
): CostEvent[] {
  const events: CostEvent[] = [];

  for (const usage of usages) {
    // Determine provider from model name
    let provider = 'anthropic';
    if (usage.model.includes('gpt')) {
      provider = 'openai';
    } else if (usage.model.includes('gemini')) {
      provider = 'google';
    } else if (usage.model.includes('kimi')) {
      provider = 'custom';
    }

    // Get pricing and calculate cost
    const pricing = getPricing(provider as any, usage.model);
    if (!pricing) {
      continue; // Skip if no pricing found
    }

    const tokenUsage: TokenUsage = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      cacheTTL: '5m',
    };

    const cost = calculateCost(tokenUsage, pricing);

    events.push({
      ts: usage.timestamp || new Date().toISOString(),
      type: 'cost',
      agentId: context.agentId,
      issueId: context.issueId,
      sessionType: context.sessionType,
      provider,
      model: usage.model,
      input: usage.inputTokens,
      output: usage.outputTokens,
      cacheRead: usage.cacheReadTokens,
      cacheWrite: usage.cacheWriteTokens,
      cost,
    });
  }

  return events;
}

/**
 * Find session directory for a workspace
 */
function getSessionDir(workspacePath: string): string | null {
  // Claude Code session directory name format: path with leading / removed and / replaced by -
  // e.g., /home/user/projects/foo -> -home-user-projects-foo
  const sessionDirName = encodeClaudeProjectDir(workspacePath);
  const sessionDir = join(getClaudeProjectsDir(), sessionDirName);

  if (existsSync(sessionDir)) {
    return sessionDir;
  }

  return null;
}

/**
 * Migrate a single agent's session data
 */
function migrateAgent(agentDir: string, stats: MigrationStats): void {
  const stateFile = join(getAgentsDir(), agentDir, 'state.json');

  if (!existsSync(stateFile)) {
    stats.warnings.push({
      file: stateFile,
      message: 'No state.json found',
    });
    return;
  }

  // Read agent state
  let state: any;
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf-8'));
  } catch (err) {
    stats.errors.push({
      file: stateFile,
      error: `Failed to parse state.json: ${err}`,
    });
    return;
  }

  // Extract context - infer issueId and workspace when not in state.json
  const inferredIssueId = inferIssueId(agentDir);
  const context: AgentContext = {
    agentId: agentDir,
    issueId: state.issueId || inferredIssueId || 'UNKNOWN',
    sessionType: state.sessionType || (agentDir.startsWith('planning-') ? 'planning' : 'implementation'),
    workspace: state.workspace,
  };

  // Try to resolve workspace if not in state
  if (!context.workspace && context.issueId !== 'UNKNOWN') {
    context.workspace = resolveWorkspace(context.issueId) || '';
  }

  // Find session directory - try workspace path first, then scan by issue
  let sessionDir: string | null = null;

  if (context.workspace) {
    // GUARD: Reject broad parent directories that contain multiple projects.
    // Planning agents sometimes have workspace set to a parent dir like /home/user/Projects
    // instead of a specific workspace. Using such a path would attribute ALL sessions from
    // every project to a single issue, causing massive cost inflation.
    const isSpecificWorkspace = context.workspace.includes('workspaces/feature-') ||
      context.workspace.includes(`/${context.issueId.toLowerCase()}`) ||
      context.workspace.includes(`/${context.issueId.toUpperCase()}`);

    if (isSpecificWorkspace) {
      sessionDir = getSessionDir(context.workspace);
    } else {
      stats.warnings.push({
        file: stateFile,
        message: `Skipped broad workspace path "${context.workspace}" for ${context.issueId} (would attribute unrelated sessions)`,
      });
    }
  }

  // Fallback: scan Claude projects directory for matching session dirs
  if (!sessionDir && context.issueId !== 'UNKNOWN') {
    const sessionDirs = findSessionDirsByIssue(context.issueId);
    if (sessionDirs.length > 0) {
      sessionDir = sessionDirs[0];
    }
  }

  if (!sessionDir) {
    stats.warnings.push({
      file: stateFile,
      message: `No session directory found for ${context.issueId} (workspace: ${context.workspace || 'unknown'})`,
    });
    return;
  }

  // Process main session files
  try {
    const files = readdirSync(sessionDir).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = join(sessionDir, file);

      try {
        const usages = parseSessionFile(filePath);
        const events = usageToCostEvents(usages, context);

        for (const event of events) {
          appendCostEvent(event);
          stats.eventsCreated++;
          stats.totalCost += event.cost;
          stats.totalTokens += event.input + event.output + event.cacheRead + event.cacheWrite;
        }

        stats.sessionFilesProcessed++;
      } catch (err) {
        stats.errors.push({
          file: filePath,
          error: `${err}`,
        });
      }
    }
  } catch (err) {
    stats.errors.push({
      file: sessionDir,
      error: `Failed to read session directory: ${err}`,
    });
  }

  // Process subagent files (CRITICAL - this was missing in old code)
  const subagentsDir = join(sessionDir, 'subagents');
  if (existsSync(subagentsDir)) {
    try {
      const subagentFiles = readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'));

      for (const file of subagentFiles) {
        const filePath = join(subagentsDir, file);

        try {
          const usages = parseSessionFile(filePath);

          // Create subagent context
          const subagentContext: AgentContext = {
            ...context,
            agentId: `${context.agentId}-subagent-${file.replace('.jsonl', '')}`,
          };

          const events = usageToCostEvents(usages, subagentContext);

          for (const event of events) {
            appendCostEvent(event);
            stats.eventsCreated++;
            stats.totalCost += event.cost;
            stats.totalTokens += event.input + event.output + event.cacheRead + event.cacheWrite;
          }

          stats.subagentFilesProcessed++;
        } catch (err) {
          stats.errors.push({
            file: filePath,
            error: `${err}`,
          });
        }
      }
    } catch (err) {
      stats.warnings.push({
        file: subagentsDir,
        message: `Failed to read subagents directory: ${err}`,
      });
    }
  }

  stats.agentsProcessed++;
}

// ============== Migration Entry Points ==============

/**
 * Migrate all historical session data to events.jsonl
 */
export function migrateAllSessions(): MigrationStats {
  const stats: MigrationStats = {
    agentsProcessed: 0,
    sessionFilesProcessed: 0,
    subagentFilesProcessed: 0,
    eventsCreated: 0,
    errors: [],
    warnings: [],
    totalCost: 0,
    totalTokens: 0,
  };

  console.log('Starting migration of historical session data...');

  const agentsDir = getAgentsDir();

  // Check if agents directory exists
  if (!existsSync(agentsDir)) {
    console.log('No agents directory found - nothing to migrate');
    return stats;
  }

  // Get all agent directories
  const agentDirs = readdirSync(agentsDir).filter(
    name => name.startsWith('agent-') || name.startsWith('planning-')
  );

  console.log(`Found ${agentDirs.length} agent directories to process`);

  // Process each agent
  for (const agentDir of agentDirs) {
    try {
      migrateAgent(agentDir, stats);
    } catch (err) {
      stats.errors.push({
        file: agentDir,
        error: `Failed to migrate agent: ${err}`,
      });
    }
  }

  // Log summary
  console.log('\nMigration complete:');
  console.log(`  Agents processed: ${stats.agentsProcessed}`);
  console.log(`  Session files: ${stats.sessionFilesProcessed}`);
  console.log(`  Subagent files: ${stats.subagentFilesProcessed}`);
  console.log(`  Events created: ${stats.eventsCreated}`);
  console.log(`  Total cost: $${stats.totalCost.toFixed(4)}`);
  console.log(`  Total tokens: ${stats.totalTokens.toLocaleString()}`);
  console.log(`  Errors: ${stats.errors.length}`);
  console.log(`  Warnings: ${stats.warnings.length}`);

  return stats;
}

/**
 * Check if migration is needed
 */
export function needsMigration(): boolean {
  // If events file doesn't exist, we need migration
  if (!eventsFileExists()) {
    return true;
  }

  // If events file is empty, we need migration
  const metadata = getLastEventMetadata();
  if (metadata.totalEvents === 0) {
    return true;
  }

  return false;
}

/**
 * Migrate only if needed
 */
export function migrateIfNeeded(): MigrationStats | null {
  if (!needsMigration()) {
    console.log('Migration not needed - events file already exists with data');
    return null;
  }

  return migrateAllSessions();
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Effect variant of migrateAllSessions. Failures surface as FsError. */
export const migrateAllSessionsEffect = (): Effect.Effect<MigrationStats, FsError> =>
  Effect.try({
    try: () => migrateAllSessions(),
    catch: (cause) => new FsError({ path: '<all sessions>', operation: 'migrateAllSessions', cause }),
  });

/** Effect variant of needsMigration. */
export const needsMigrationEffect = (): Effect.Effect<boolean, FsError> =>
  Effect.try({
    try: () => needsMigration(),
    catch: (cause) => new FsError({ path: '<events>', operation: 'needsMigration', cause }),
  });

/** Effect variant of migrateIfNeeded. */
export const migrateIfNeededEffect = (): Effect.Effect<MigrationStats | null, FsError> =>
  Effect.try({
    try: () => migrateIfNeeded(),
    catch: (cause) => new FsError({ path: '<all sessions>', operation: 'migrateIfNeeded', cause }),
  });
