/**
 * Historical Data Migration for Cost Tracking
 *
 * Migrates historical session data to the event-sourced format.
 * Includes both main session files and subagent session files.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { appendCostEvent, CostEvent, eventsFileExists, getLastEventMetadata } from './events.js';
import { getPricing, calculateCost, TokenUsage, AIProvider } from '../cost.js';

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

// ============== Constants ==============

const AGENTS_DIR = join(homedir(), '.panopticon', 'agents');
const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

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
    let provider: AIProvider = 'anthropic';
    if (usage.model.includes('gpt')) {
      provider = 'openai';
    } else if (usage.model.includes('gemini')) {
      provider = 'google';
    }

    // Get pricing and calculate cost
    const pricing = getPricing(provider, usage.model);
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
  const sessionDirName = `-${workspacePath.replace(/^\//, '').replace(/\//g, '-')}`;
  const sessionDir = join(CLAUDE_PROJECTS_DIR, sessionDirName);

  if (existsSync(sessionDir)) {
    return sessionDir;
  }

  return null;
}

/**
 * Migrate a single agent's session data
 */
function migrateAgent(agentDir: string, stats: MigrationStats): void {
  const stateFile = join(AGENTS_DIR, agentDir, 'state.json');

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

  // Extract context
  const context: AgentContext = {
    agentId: agentDir,
    issueId: state.issueId || 'UNKNOWN',
    sessionType: state.sessionType || (agentDir.startsWith('planning-') ? 'planning' : 'implementation'),
    workspace: state.workspace,
  };

  if (!context.workspace) {
    stats.warnings.push({
      file: stateFile,
      message: 'No workspace found in state',
    });
    return;
  }

  // Find session directory
  const sessionDir = getSessionDir(context.workspace);
  if (!sessionDir) {
    stats.warnings.push({
      file: context.workspace,
      message: 'Session directory not found',
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

  // Check if agents directory exists
  if (!existsSync(AGENTS_DIR)) {
    console.log('No agents directory found - nothing to migrate');
    return stats;
  }

  // Get all agent directories
  const agentDirs = readdirSync(AGENTS_DIR).filter(
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
