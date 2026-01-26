/**
 * Claude Code JSONL Parser
 *
 * Parse token usage from Claude Code session files.
 * Session files are stored at: ~/.claude/projects/<project-path-hash>/<session-id>.jsonl
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { TokenUsage, calculateCost, getPricing, AIProvider, logCost, CostEntry } from '../cost.js';

// Claude Code JSONL message format
export interface ClaudeMessage {
  sessionId?: string;
  timestamp?: string;
  parentMessageId?: string;
  message?: {
    id?: string;
    role?: 'user' | 'assistant';
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  // Some messages have usage at top level
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  model?: string;
}

// Parsed session usage
export interface SessionUsage {
  sessionId: string;
  sessionFile: string;
  startTime: string;
  endTime: string;
  model: string;
  usage: TokenUsage;
  cost: number;
  messageCount: number;
}

// Claude projects directory
const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

/**
 * Get all Claude Code project directories
 */
export function getProjectDirs(): string[] {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) {
    return [];
  }

  return readdirSync(CLAUDE_PROJECTS_DIR)
    .map(name => join(CLAUDE_PROJECTS_DIR, name))
    .filter(path => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    });
}

/**
 * Get session JSONL files for a project directory
 */
export function getSessionFiles(projectDir: string): string[] {
  if (!existsSync(projectDir)) {
    return [];
  }

  return readdirSync(projectDir)
    .filter(name => name.endsWith('.jsonl'))
    .map(name => join(projectDir, name))
    .sort((a, b) => {
      try {
        return statSync(b).mtime.getTime() - statSync(a).mtime.getTime();
      } catch {
        return 0;
      }
    });
}

/**
 * Get all session files across all projects
 */
export function getAllSessionFiles(): string[] {
  const files: string[] = [];

  for (const projectDir of getProjectDirs()) {
    files.push(...getSessionFiles(projectDir));
  }

  return files.sort((a, b) => {
    try {
      return statSync(b).mtime.getTime() - statSync(a).mtime.getTime();
    } catch {
      return 0;
    }
  });
}

/**
 * Normalize model name for pricing lookup
 */
export function normalizeModelName(model: string): { provider: AIProvider; model: string } {
  // Claude models
  if (model.includes('claude')) {
    let normalizedModel = model;

    // Map full model IDs to pricing model names
    // Order matters - check more specific patterns first

    // Opus models
    if (model.includes('opus-4-5') || model.includes('opus-4.5')) {
      normalizedModel = 'claude-opus-4.5';
    } else if (model.includes('opus-4-1') || model.includes('opus-4.1')) {
      normalizedModel = 'claude-opus-4-1';
    } else if (model.includes('opus-4') || model.includes('opus')) {
      normalizedModel = 'claude-opus-4';
    }

    // Sonnet models
    if (model.includes('sonnet-4-5') || model.includes('sonnet-4.5')) {
      normalizedModel = 'claude-sonnet-4.5';
    } else if (model.includes('sonnet-4') || model.includes('sonnet')) {
      normalizedModel = 'claude-sonnet-4';
    }

    // Haiku models - default to 4.5 (current), support 3 for legacy
    if (model.includes('haiku-4-5') || model.includes('haiku-4.5')) {
      normalizedModel = 'claude-haiku-4.5';
    } else if (model.includes('haiku-3')) {
      normalizedModel = 'claude-haiku-3';
    } else if (model.includes('haiku')) {
      normalizedModel = 'claude-haiku-4.5';  // Default to current model
    }

    return { provider: 'anthropic', model: normalizedModel };
  }

  // OpenAI models
  if (model.includes('gpt')) {
    return { provider: 'openai', model };
  }

  // Google models
  if (model.includes('gemini')) {
    return { provider: 'google', model };
  }

  // Default to anthropic/claude
  return { provider: 'anthropic', model: 'claude-sonnet-4' };
}

/**
 * Parse a Claude Code session JSONL file and extract usage
 */
export function parseClaudeSession(sessionFile: string): SessionUsage | null {
  if (!existsSync(sessionFile)) {
    return null;
  }

  const content = readFileSync(sessionFile, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  let sessionId = '';
  let startTime = '';
  let endTime = '';
  let primaryModel = '';
  let messageCount = 0;

  const totalUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  for (const line of lines) {
    try {
      const msg: ClaudeMessage = JSON.parse(line);

      // Extract session ID from first message
      if (msg.sessionId && !sessionId) {
        sessionId = msg.sessionId;
      }

      // Track timestamps
      if (msg.timestamp) {
        if (!startTime || msg.timestamp < startTime) {
          startTime = msg.timestamp;
        }
        if (!endTime || msg.timestamp > endTime) {
          endTime = msg.timestamp;
        }
      }

      // Extract usage - can be in message.usage or top-level usage
      const usage = msg.message?.usage || msg.usage;
      const model = msg.message?.model || msg.model;

      if (usage) {
        totalUsage.inputTokens += usage.input_tokens || 0;
        totalUsage.outputTokens += usage.output_tokens || 0;
        totalUsage.cacheReadTokens = (totalUsage.cacheReadTokens || 0) + (usage.cache_read_input_tokens || 0);
        totalUsage.cacheWriteTokens = (totalUsage.cacheWriteTokens || 0) + (usage.cache_creation_input_tokens || 0);
        messageCount++;
      }

      // Track primary model (most frequently used)
      if (model && !primaryModel) {
        primaryModel = model;
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  // If no usage found, return null
  if (totalUsage.inputTokens === 0 && totalUsage.outputTokens === 0) {
    return null;
  }

  // Use filename as session ID if not found in messages
  if (!sessionId) {
    sessionId = basename(sessionFile, '.jsonl');
  }

  // Default model if not found
  if (!primaryModel) {
    primaryModel = 'claude-sonnet-4';
  }

  // Calculate cost
  const { provider, model } = normalizeModelName(primaryModel);
  const pricing = getPricing(provider, model);
  const cost = pricing ? calculateCost(totalUsage, pricing) : 0;

  return {
    sessionId,
    sessionFile,
    startTime: startTime || new Date().toISOString(),
    endTime: endTime || new Date().toISOString(),
    model: primaryModel,
    usage: totalUsage,
    cost,
    messageCount,
  };
}

/**
 * Parse all sessions and return usage summaries
 */
export function parseAllSessions(maxAge?: number): SessionUsage[] {
  const sessions: SessionUsage[] = [];
  const cutoffTime = maxAge ? Date.now() - maxAge : 0;

  for (const file of getAllSessionFiles()) {
    try {
      const stat = statSync(file);
      if (cutoffTime && stat.mtime.getTime() < cutoffTime) {
        continue;
      }

      const usage = parseClaudeSession(file);
      if (usage) {
        sessions.push(usage);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return sessions;
}

/**
 * Get recent sessions (last N days)
 */
export function getRecentSessions(days: number = 7): SessionUsage[] {
  const maxAge = days * 24 * 60 * 60 * 1000;
  return parseAllSessions(maxAge);
}

/**
 * Get the active session model for a workspace
 * Returns the full model ID (e.g., "claude-sonnet-4-5-20250929") from the most recent session file
 *
 * NOTE: Claude Max can auto-upgrade models mid-session (e.g., Sonnet → Opus).
 * We read from the END of the file to get the CURRENT model, not the initial one.
 */
export function getActiveSessionModel(workspacePath: string): string | null {
  try {
    // Convert workspace path to Claude project dir name
    // e.g., /home/user/projects/myn/workspaces/feature-min-664
    //    -> -home-user-projects-myn-workspaces-feature-min-664
    const projectDirName = workspacePath.replace(/\//g, '-').replace(/^-/, '');
    const projectDir = join(CLAUDE_PROJECTS_DIR, projectDirName);

    // Find most recently modified session file
    const sessions = getSessionFiles(projectDir);
    if (sessions.length === 0) {
      return null;
    }

    // Parse the most recent session file to find model
    const mostRecentSession = sessions[0]; // Already sorted by mtime
    const content = readFileSync(mostRecentSession, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    // Read from END of file to get CURRENT model (may have been auto-upgraded by Claude Max)
    // Look at last 100 lines to find the most recent model entry
    const searchLines = lines.slice(-100);
    for (let i = searchLines.length - 1; i >= 0; i--) {
      try {
        const msg: ClaudeMessage = JSON.parse(searchLines[i]);
        const model = msg.message?.model || msg.model;
        // Skip synthetic/placeholder model values
        if (model && model !== '<synthetic>') {
          return model; // Return full model ID
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    // Fallback: check first few lines if nothing found at end
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      try {
        const msg: ClaudeMessage = JSON.parse(lines[i]);
        const model = msg.message?.model || msg.model;
        if (model && model !== '<synthetic>') {
          return model;
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    return null;
  } catch (error) {
    console.warn('Failed to get active session model:', error);
    return null;
  }
}

/**
 * Import session usage to cost log
 */
export function importSessionToCostLog(
  session: SessionUsage,
  options: {
    issueId?: string;
    agentId?: string;
    operation?: string;
  } = {}
): CostEntry | null {
  const { provider, model } = normalizeModelName(session.model);
  const pricing = getPricing(provider, model);

  if (!pricing) {
    console.warn(`No pricing found for ${session.model}`);
    return null;
  }

  return logCost({
    provider,
    model,
    usage: session.usage,
    cost: session.cost,
    currency: 'USD',
    operation: options.operation || 'claude_session',
    issueId: options.issueId,
    agentId: options.agentId,
    metadata: {
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      startTime: session.startTime,
      endTime: session.endTime,
      messageCount: session.messageCount,
    },
  });
}
