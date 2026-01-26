/**
 * Historical Cost Migration
 *
 * One-time migration that parses ALL existing Claude Code session files
 * (including subagents/) and imports them into the event-sourced cost tracking system.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { COSTS_DIR, PANOPTICON_HOME } from '../paths.js';
import { CostEvent, MigrationState } from './types.js';
import { appendEvent } from './events.js';
import { rebuildFromEvents } from './aggregator.js';
import { normalizeModelName } from '../cost-parsers/jsonl-parser.js';

// Migration marker file
const MIGRATION_MARKER_FILE = join(COSTS_DIR, 'migration-complete.json');

/**
 * Check if migration has already been completed
 */
export function isMigrationComplete(): boolean {
  return existsSync(MIGRATION_MARKER_FILE);
}

/**
 * Get migration state
 */
export function getMigrationState(): MigrationState | null {
  if (!existsSync(MIGRATION_MARKER_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(MIGRATION_MARKER_FILE, 'utf-8');
    return JSON.parse(content) as MigrationState;
  } catch {
    return null;
  }
}

/**
 * Mark migration as complete
 */
function markMigrationComplete(workspaceCount: number, eventCount: number, errors: string[] = []): void {
  mkdirSync(COSTS_DIR, { recursive: true });

  const state: MigrationState = {
    completed: true,
    completedAt: new Date().toISOString(),
    workspaceCount,
    eventCount,
    errors: errors.length > 0 ? errors : undefined,
  };

  writeFileSync(MIGRATION_MARKER_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Get all agent workspaces from agent state files
 */
function getAllAgentWorkspaces(): Array<{ issueId: string; workspacePath: string; agentId: string }> {
  const agentsDir = join(PANOPTICON_HOME, 'agents');
  if (!existsSync(agentsDir)) {
    return [];
  }

  const workspaces: Array<{ issueId: string; workspacePath: string; agentId: string }> = [];

  try {
    const agentDirs = readdirSync(agentsDir).filter(
      name => name.startsWith('agent-') || name.startsWith('planning-')
    );

    for (const agentDir of agentDirs) {
      try {
        const stateFile = join(agentsDir, agentDir, 'state.json');
        if (!existsSync(stateFile)) continue;

        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        if (state.issueId && state.workspace) {
          workspaces.push({
            issueId: state.issueId,
            workspacePath: state.workspace,
            agentId: agentDir,
          });
        }
      } catch {
        // Skip invalid state files
      }
    }
  } catch {
    // Skip if agents directory is unreadable
  }

  return workspaces;
}

/**
 * Parse a single session file and extract usage by message
 *
 * Returns array of cost events (one per API response)
 */
async function parseSessionFileToEvents(
  sessionFilePath: string,
  agentId: string,
  issueId: string
): Promise<CostEvent[]> {
  const events: CostEvent[] = [];

  try {
    const content = await readFile(sessionFilePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Extract timestamp
        const timestamp = entry.timestamp || new Date().toISOString();

        // Extract model
        const modelStr = entry.message?.model || entry.model || 'claude-sonnet-4';
        const { model } = normalizeModelName(modelStr);

        // Extract usage - can be at top level or in message
        const usage = entry.usage || entry.message?.usage;
        if (usage) {
          const event: CostEvent = {
            ts: timestamp,
            agent: agentId,
            input: usage.input_tokens || 0,
            output: usage.output_tokens || 0,
            cache_read: usage.cache_read_input_tokens || 0,
            cache_write: usage.cache_creation_input_tokens || 0,
            model,
            issueId,
          };

          // Only add event if it has non-zero usage
          if (event.input > 0 || event.output > 0) {
            events.push(event);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Skip unreadable files
  }

  return events;
}

/**
 * Parse a workspace's session directory including subagents
 */
async function parseWorkspaceSessionsToEvents(
  workspacePath: string,
  agentId: string,
  issueId: string
): Promise<CostEvent[]> {
  // Claude Code session directory name format: path with leading / removed and / replaced by -
  // e.g., /home/eltmon/projects/foo -> -home-eltmon-projects-foo
  const sessionDirName = `-${workspacePath.replace(/^\//, '').replace(/\//g, '-')}`;
  const sessionDir = join(homedir(), '.claude', 'projects', sessionDirName);

  if (!existsSync(sessionDir)) {
    return [];
  }

  const allEvents: CostEvent[] = [];

  try {
    // Read all files in session directory
    const allFiles = await readdir(sessionDir);

    // Process top-level session files
    const sessionFiles = allFiles.filter(f => f.endsWith('.jsonl'));
    for (const file of sessionFiles) {
      const filePath = join(sessionDir, file);
      const events = await parseSessionFileToEvents(filePath, agentId, issueId);
      allEvents.push(...events);
    }

    // CRITICAL: Process subagent directories
    // Format: <session-id>/subagents/<subagent-session-id>.jsonl
    for (const item of allFiles) {
      const itemPath = join(sessionDir, item);
      try {
        const stat = statSync(itemPath);
        if (stat.isDirectory()) {
          // Check if this directory has a subagents/ subdirectory
          const subagentsDir = join(itemPath, 'subagents');
          if (existsSync(subagentsDir)) {
            const subagentFiles = await readdir(subagentsDir);
            const subagentSessions = subagentFiles.filter(f => f.endsWith('.jsonl'));

            for (const subfile of subagentSessions) {
              const subfilePath = join(subagentsDir, subfile);
              // Use a subagent ID format: agent-pan-74-subagent-aa82e20
              const subagentId = `${agentId}-subagent-${subfile.replace('.jsonl', '')}`;
              const events = await parseSessionFileToEvents(subfilePath, subagentId, issueId);
              allEvents.push(...events);
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    }
  } catch (error) {
    console.warn(`Error parsing workspace sessions for ${workspacePath}:`, error);
  }

  return allEvents;
}

/**
 * Run the historical cost migration
 *
 * Parses all existing session files (including subagents) and imports them
 * into the event log. This is a one-time operation that should run on first
 * dashboard startup.
 *
 * @returns Migration state with statistics
 */
export async function runMigration(): Promise<MigrationState> {
  console.log('Starting historical cost migration...');

  // Check if already completed
  if (isMigrationComplete()) {
    console.log('Migration already completed, skipping');
    return getMigrationState()!;
  }

  const errors: string[] = [];
  let totalEvents = 0;

  try {
    // Get all workspaces from agent state files
    const workspaces = getAllAgentWorkspaces();
    console.log(`Found ${workspaces.length} workspaces to migrate`);

    // Process each workspace
    for (const { issueId, workspacePath, agentId } of workspaces) {
      try {
        console.log(`Migrating workspace: ${issueId} (${agentId})`);

        // Parse all session files (including subagents)
        const events = await parseWorkspaceSessionsToEvents(workspacePath, agentId, issueId);

        // Append events to log
        for (const event of events) {
          await appendEvent(event);
          totalEvents++;
        }

        console.log(`  → Added ${events.length} events`);
      } catch (error: any) {
        const errorMsg = `Failed to migrate ${issueId}: ${error.message}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    // Rebuild aggregation cache from events
    console.log('Rebuilding aggregation cache...');
    rebuildFromEvents();

    // Mark migration as complete
    markMigrationComplete(workspaces.length, totalEvents, errors);

    console.log(`Migration complete! Processed ${workspaces.length} workspaces, created ${totalEvents} events`);

    if (errors.length > 0) {
      console.warn(`Migration completed with ${errors.length} errors`);
    }

    return {
      completed: true,
      completedAt: new Date().toISOString(),
      workspaceCount: workspaces.length,
      eventCount: totalEvents,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error: any) {
    const errorMsg = `Migration failed: ${error.message}`;
    console.error(errorMsg);
    errors.push(errorMsg);

    return {
      completed: false,
      completedAt: new Date().toISOString(),
      workspaceCount: 0,
      eventCount: totalEvents,
      errors,
    };
  }
}

/**
 * Reset migration (for testing)
 *
 * Deletes the migration marker so migration can run again.
 */
export function resetMigration(): void {
  if (existsSync(MIGRATION_MARKER_FILE)) {
    writeFileSync(MIGRATION_MARKER_FILE, '', 'utf-8');
  }
}
