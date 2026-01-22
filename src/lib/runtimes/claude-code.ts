/**
 * Claude Code Runtime Implementation
 *
 * Implements AgentRuntime for Claude Code CLI.
 *
 * Session storage: ~/.claude/projects/<workspace-hash>/<session-id>.jsonl
 * Session index: ~/.claude/projects/<workspace-hash>/sessions-index.json
 */

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type {
  AgentRuntime,
  Heartbeat,
  TokenUsage,
  CostBreakdown,
  Session,
  SpawnConfig,
  Agent,
  ActivitySource,
} from './types.js';
import { getAgentState, getAgentDir, spawnAgent as spawnAgentImpl, saveAgentState } from '../agents.js';
import { sessionExists, killSession, sendKeys, getAgentSessions } from '../tmux.js';
import { parseClaudeSession, getSessionFiles, getProjectDirs } from '../cost-parsers/jsonl-parser.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

/**
 * Claude Code session index entry
 */
interface SessionIndexEntry {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  filePath: string;
}

/**
 * Claude Code Runtime implementation
 */
export class ClaudeCodeRuntime implements AgentRuntime {
  readonly name = 'claude-code' as const;

  /**
   * Get the project directory for a workspace
   *
   * Claude Code hashes the workspace path to create project directories.
   * We need to find the project directory that contains sessions for this workspace.
   */
  private getProjectDirForWorkspace(workspace: string): string | null {
    if (!existsSync(CLAUDE_PROJECTS_DIR)) {
      return null;
    }

    // Get all project directories
    const projectDirs = getProjectDirs();

    for (const projectDir of projectDirs) {
      // Check if this project's sessions-index.json references the workspace
      const indexPath = join(projectDir, 'sessions-index.json');
      if (existsSync(indexPath)) {
        try {
          const indexContent = readFileSync(indexPath, 'utf-8');
          // Sessions index contains the workspace path
          if (indexContent.includes(workspace)) {
            return projectDir;
          }
        } catch {
          // Skip invalid index files
        }
      }
    }

    return null;
  }

  /**
   * Get the active session ID for an agent from the sessions index
   */
  private getActiveSessionId(projectDir: string): string | null {
    const indexPath = join(projectDir, 'sessions-index.json');
    if (!existsSync(indexPath)) {
      return null;
    }

    try {
      const indexContent = readFileSync(indexPath, 'utf-8');
      const index = JSON.parse(indexContent);

      // The sessions-index.json has a structure like:
      // { "sessions": [{ "sessionId": "...", "filePath": "...", ... }] }
      // Find the most recent session
      if (index.sessions && Array.isArray(index.sessions)) {
        const sessions = index.sessions as SessionIndexEntry[];
        if (sessions.length === 0) return null;

        // Sort by updatedAt and get the most recent
        const sorted = sessions.sort((a, b) => {
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });

        return sorted[0].sessionId;
      }
    } catch {
      // Skip invalid index files
    }

    return null;
  }

  /**
   * Get the most recent JSONL file for a project
   */
  private getMostRecentJSONL(projectDir: string): string | null {
    const files = getSessionFiles(projectDir);
    return files.length > 0 ? files[0] : null;
  }

  /**
   * Get the session path for an agent
   */
  getSessionPath(agentId: string): string | null {
    const state = getAgentState(agentId);
    if (!state) {
      return null;
    }

    const projectDir = this.getProjectDirForWorkspace(state.workspace);
    if (!projectDir) {
      return null;
    }

    // Try to get active session from index
    const sessionId = this.getActiveSessionId(projectDir);
    if (sessionId) {
      const sessionPath = join(projectDir, `${sessionId}.jsonl`);
      if (existsSync(sessionPath)) {
        return sessionPath;
      }
    }

    // Fall back to most recent JSONL file
    return this.getMostRecentJSONL(projectDir);
  }

  /**
   * Get last activity timestamp for an agent
   *
   * Uses passive detection via JSONL file modification time.
   */
  getLastActivity(agentId: string): Date | null {
    const sessionPath = this.getSessionPath(agentId);
    if (!sessionPath || !existsSync(sessionPath)) {
      return null;
    }

    try {
      const stat = statSync(sessionPath);
      return stat.mtime;
    } catch {
      return null;
    }
  }

  /**
   * Read active heartbeat file if it exists
   */
  private getActiveHeartbeat(agentId: string): Heartbeat | null {
    // Heartbeats are now in shared directory: ~/.panopticon/heartbeats/
    const heartbeatPath = join(homedir(), '.panopticon', 'heartbeats', `${agentId}.json`);
    if (!existsSync(heartbeatPath)) {
      return null;
    }

    try {
      const content = readFileSync(heartbeatPath, 'utf-8');
      const data = JSON.parse(content);

      // Check if heartbeat is recent (within 5 minutes)
      const timestamp = new Date(data.timestamp);
      const now = new Date();
      const ageMs = now.getTime() - timestamp.getTime();
      if (ageMs > 5 * 60 * 1000) {
        // Heartbeat is stale
        return null;
      }

      return {
        timestamp,
        agentId: data.agent_id || agentId,
        source: 'active-heartbeat',
        confidence: 'high',
        toolName: data.tool_name,
        lastAction: data.last_action,
        currentTask: data.current_task,
        gitBranch: data.git_branch,
        workspace: data.workspace,
        pid: data.pid,
        sessionId: data.session_id,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get passive heartbeat from file timestamps
   */
  private getPassiveHeartbeat(agentId: string): Heartbeat | null {
    const lastActivity = this.getLastActivity(agentId);
    if (!lastActivity) {
      return null;
    }

    return {
      timestamp: lastActivity,
      agentId,
      source: 'jsonl',
      confidence: 'medium',
    };
  }

  /**
   * Get heartbeat for an agent
   *
   * Tries active heartbeat first (if hooks configured), falls back to passive.
   */
  getHeartbeat(agentId: string): Heartbeat | null {
    // Try active heartbeat first
    const activeHeartbeat = this.getActiveHeartbeat(agentId);
    if (activeHeartbeat) {
      return activeHeartbeat;
    }

    // Fall back to passive detection
    return this.getPassiveHeartbeat(agentId);
  }

  /**
   * Get token usage for an agent's current session
   */
  getTokenUsage(agentId: string): TokenUsage | null {
    const sessionPath = this.getSessionPath(agentId);
    if (!sessionPath) {
      return null;
    }

    const sessionUsage = parseClaudeSession(sessionPath);
    if (!sessionUsage) {
      return null;
    }

    return sessionUsage.usage;
  }

  /**
   * Get cost breakdown for an agent's current session
   */
  getSessionCost(agentId: string): CostBreakdown | null {
    const sessionPath = this.getSessionPath(agentId);
    if (!sessionPath) {
      return null;
    }

    const sessionUsage = parseClaudeSession(sessionPath);
    if (!sessionUsage) {
      return null;
    }

    // Calculate breakdown based on token usage
    // Prices for Claude Sonnet 4 (most common)
    // TODO: Use actual model pricing from session
    const inputPrice = 3.0 / 1_000_000; // $3 per 1M input tokens
    const outputPrice = 15.0 / 1_000_000; // $15 per 1M output tokens
    const cacheReadPrice = 0.3 / 1_000_000; // $0.30 per 1M cache read tokens
    const cacheWritePrice = 3.75 / 1_000_000; // $3.75 per 1M cache write tokens

    const usage = sessionUsage.usage;
    const inputCost = usage.inputTokens * inputPrice;
    const outputCost = usage.outputTokens * outputPrice;
    const cacheReadCost = (usage.cacheReadTokens || 0) * cacheReadPrice;
    const cacheWriteCost = (usage.cacheWriteTokens || 0) * cacheWritePrice;

    return {
      inputCost,
      outputCost,
      cacheReadCost,
      cacheWriteCost,
      totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
      currency: 'USD',
    };
  }

  /**
   * Send a message to a running agent
   */
  sendMessage(agentId: string, message: string): void {
    if (!sessionExists(agentId)) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    sendKeys(agentId, message);

    // Also save to mail queue for persistence
    const mailDir = join(getAgentDir(agentId), 'mail');
    mkdirSync(mailDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(
      join(mailDir, `${timestamp}.md`),
      `# Message\n\n${message}\n`
    );
  }

  /**
   * Kill an agent
   */
  killAgent(agentId: string): void {
    if (!sessionExists(agentId)) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    killSession(agentId);

    // Update agent state
    const state = getAgentState(agentId);
    if (state) {
      state.status = 'stopped';
      saveAgentState(state);
    }
  }

  /**
   * Spawn a new agent
   */
  spawnAgent(config: SpawnConfig): Agent {
    // Use the existing spawnAgent implementation from agents.ts
    const state = spawnAgentImpl({
      issueId: config.agentId.replace(/^agent-/, ''),
      workspace: config.workspace,
      runtime: 'claude',
      model: config.model || 'sonnet',
      prompt: config.prompt,
    });

    // Get the session ID (we'll need to look it up from the workspace)
    const projectDir = this.getProjectDirForWorkspace(config.workspace);
    const sessionId = projectDir ? this.getActiveSessionId(projectDir) : undefined;

    return {
      id: state.id,
      sessionId: sessionId || 'unknown',
      runtime: 'claude-code',
      model: state.model,
      workspace: state.workspace,
      startedAt: new Date(state.startedAt),
    };
  }

  /**
   * List all sessions for this runtime
   */
  listSessions(workspace?: string): Session[] {
    const sessions: Session[] = [];

    if (workspace) {
      // Get sessions for specific workspace
      const projectDir = this.getProjectDirForWorkspace(workspace);
      if (projectDir) {
        const files = getSessionFiles(projectDir);
        for (const file of files) {
          const session = this.parseSessionFile(file, workspace);
          if (session) {
            sessions.push(session);
          }
        }
      }
    } else {
      // Get all sessions
      const projectDirs = getProjectDirs();
      for (const projectDir of projectDirs) {
        const files = getSessionFiles(projectDir);
        for (const file of files) {
          const session = this.parseSessionFile(file);
          if (session) {
            sessions.push(session);
          }
        }
      }
    }

    return sessions;
  }

  /**
   * Parse a session file into a Session object
   */
  private parseSessionFile(file: string, workspace?: string): Session | null {
    const sessionUsage = parseClaudeSession(file);
    if (!sessionUsage) {
      return null;
    }

    const stat = statSync(file);

    return {
      id: sessionUsage.sessionId,
      agentId: 'unknown', // We'd need to reverse-lookup from agent state
      workspace: workspace || 'unknown',
      model: sessionUsage.model,
      startedAt: new Date(sessionUsage.startTime),
      lastActivity: stat.mtime,
      tokenUsage: sessionUsage.usage,
    };
  }

  /**
   * Check if an agent is running
   */
  isRunning(agentId: string): boolean {
    return sessionExists(agentId);
  }
}

/**
 * Create a Claude Code runtime instance
 */
export function createClaudeCodeRuntime(): ClaudeCodeRuntime {
  return new ClaudeCodeRuntime();
}
