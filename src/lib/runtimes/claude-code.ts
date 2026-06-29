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
import { Effect } from 'effect';
import type {
  AgentRuntime,
  AgentRuntimeSync,
  AgentRuntimeError,
  HarnessBehavior,
  Heartbeat,
  TokenUsage,
  CostBreakdown,
  Session,
  SpawnConfig,
  Agent,
  ActivitySource,
} from './types.js';
import { CLAUDE_CODE_BEHAVIOR } from './behavior.js';
import { getAgentStateSync, getAgentDir, spawnAgent as spawnAgentImpl, saveAgentStateSync, saveAgentRuntimeState, determineModel } from '../agents.js';
import { sessionExistsSync, killSessionSync, sendKeys, getAgentSessionsSync } from '../tmux.js';
import { parseClaudeSessionSync, getSessionFilesSync, getProjectDirsSync } from '../cost-parsers/jsonl-parser.js';
import { ProcessSpawnError, TmuxError, FsError } from '../errors.js';

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
export class ClaudeCodeRuntimeSync implements AgentRuntimeSync {
  readonly name = 'claude-code' as const;

  getHarnessBehavior(): HarnessBehavior {
    return CLAUDE_CODE_BEHAVIOR;
  }

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
    const projectDirs = getProjectDirsSync();

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
    const files = getSessionFilesSync(projectDir);
    return files.length > 0 ? files[0] : null;
  }

  /**
   * Get the session path for an agent
   */
  getSessionPath(agentId: string): string | null {
    const state = getAgentStateSync(agentId);
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
    // Heartbeats are now in shared directory: ~/.overdeck/heartbeats/
    const heartbeatPath = join(homedir(), '.overdeck', 'heartbeats', `${agentId}.json`);
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

    const sessionUsage = parseClaudeSessionSync(sessionPath);
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

    const sessionUsage = parseClaudeSessionSync(sessionPath);
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
  async sendMessage(agentId: string, message: string): Promise<void> {
    if (!sessionExistsSync(agentId)) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    await Effect.runPromise(sendKeys(agentId, message));

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
    if (!sessionExistsSync(agentId)) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    killSessionSync(agentId);

    // Reset runtime state so deacon / merge-agent busy-wait don't see a phantom active session
    saveAgentRuntimeState(agentId, { state: 'idle', lastActivity: new Date().toISOString() });

    // Update agent state
    const state = getAgentStateSync(agentId);
    if (state) {
      state.status = 'stopped';
      saveAgentStateSync(state);
    }
  }

  /**
   * Spawn a new agent
   */
  async spawnAgent(config: SpawnConfig): Promise<Agent> {
    // Use the existing spawnAgent implementation from agents.ts
    const state = await spawnAgentImpl({
      issueId: config.agentId.replace(/^agent-/, ''),
      workspace: config.workspace,
      harness: 'claude-code',
      model: determineModel({ model: config.model, role: 'work', spawnKey: `work:${config.agentId.replace(/^agent-/, '')}` }),
      role: 'work',
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
        const files = getSessionFilesSync(projectDir);
        for (const file of files) {
          const session = this.parseSessionFile(file, workspace);
          if (session) {
            sessions.push(session);
          }
        }
      }
    } else {
      // Get all sessions
      const projectDirs = getProjectDirsSync();
      for (const projectDir of projectDirs) {
        const files = getSessionFilesSync(projectDir);
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
    const sessionUsage = parseClaudeSessionSync(file);
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
    return sessionExistsSync(agentId);
  }
}

/**
 * Create a Claude Code runtime instance
 */
export function createClaudeCodeRuntimeSync(): ClaudeCodeRuntimeSync {
  return new ClaudeCodeRuntimeSync();
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect-channel adapter wrapping the legacy ClaudeCodeRuntime. The
// promise/sync class above remains the canonical implementation used by
// Cloister and the dashboard; this adapter is for new Effect-native callers.

/**
 * Effect-channel variant of {@link ClaudeCodeRuntimeSync}. Lifts the async
 * send/kill/spawn methods into typed Effect channels (TmuxError /
 * ProcessSpawnError) while keeping sync introspection methods sync.
 */
export class ClaudeCodeRuntime implements AgentRuntime {
  readonly name = 'claude-code' as const;
  private readonly inner: ClaudeCodeRuntimeSync;

  constructor(inner: ClaudeCodeRuntimeSync = new ClaudeCodeRuntimeSync()) {
    this.inner = inner;
  }

  getSessionPath(agentId: string): string | null {
    return this.inner.getSessionPath(agentId);
  }
  getHarnessBehavior(): HarnessBehavior {
    return this.inner.getHarnessBehavior();
  }
  getLastActivity(agentId: string): Date | null {
    return this.inner.getLastActivity(agentId);
  }
  getHeartbeat(agentId: string): Heartbeat | null {
    return this.inner.getHeartbeat(agentId);
  }
  getTokenUsage(agentId: string): TokenUsage | null {
    return this.inner.getTokenUsage(agentId);
  }
  getSessionCost(agentId: string): CostBreakdown | null {
    return this.inner.getSessionCost(agentId);
  }
  listSessions(workspace?: string): Session[] {
    return this.inner.listSessions(workspace);
  }

  sendMessage(agentId: string, message: string): Effect.Effect<void, AgentRuntimeError> {
    return Effect.tryPromise({
      try: () => this.inner.sendMessage(agentId, message),
      catch: (cause) =>
        new TmuxError({
          command: 'send-keys',
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  }

  killAgent(agentId: string): Effect.Effect<void, AgentRuntimeError> {
    return Effect.try({
      try: () => this.inner.killAgent(agentId),
      catch: (cause) =>
        new TmuxError({
          command: 'kill-session',
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  }

  spawnAgent(config: SpawnConfig): Effect.Effect<Agent, AgentRuntimeError> {
    return Effect.tryPromise({
      try: () => this.inner.spawnAgent(config),
      catch: (cause) =>
        new ProcessSpawnError({
          command: 'claude',
          args: [],
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  }

  isRunning(agentId: string): Effect.Effect<boolean> {
    return Effect.sync(() => this.inner.isRunning(agentId));
  }
}

/** Effect-flavored constructor companion to {@link createClaudeCodeRuntimeSync}. */
export function createClaudeCodeRuntime(): ClaudeCodeRuntime {
  return new ClaudeCodeRuntime();
}
