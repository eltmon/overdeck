/**
 * Cloister Runtime Abstraction
 *
 * Types for agent health monitoring for Claude Code.
 *
 * Cloister's runtime abstraction focuses on:
 * - Health monitoring (heartbeats, activity detection)
 * - Session management (finding sessions, reading session data)
 * - Cost tracking (token usage, estimated costs)
 * - Agent lifecycle (spawn, kill, message)
 */

/**
 * Supported runtime types for agent execution.
 *
 * PAN-636 widened this union to include 'pi' alongside Claude Code. Reads of
 * AgentSnapshot.runtime should go through getHarness() from @panctl/contracts
 * so unknown or legacy values normalize to 'claude-code'.
 */
export type RuntimeName = 'claude-code' | 'pi';

/**
 * Health state of an agent
 */
export type HealthState = 'active' | 'stale' | 'warning' | 'stuck';

/**
 * Source of activity detection
 */
export type ActivitySource = 'jsonl' | 'tmux' | 'git' | 'active-heartbeat';

/**
 * Heartbeat data from an agent
 */
export interface Heartbeat {
  timestamp: Date;
  agentId: string;
  source: ActivitySource;
  confidence: 'high' | 'medium' | 'low';
  toolName?: string;
  lastAction?: string;
  currentTask?: string;
  gitBranch?: string;
  workspace?: string;
  pid?: number;
  sessionId?: string;
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Cost breakdown for a session
 */
export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
  currency: 'USD';
}

/**
 * Agent session information
 */
export interface Session {
  id: string;
  agentId: string;
  workspace: string;
  model: string;
  startedAt: Date;
  lastActivity: Date;
  tokenUsage: TokenUsage;
}

/**
 * Configuration for spawning an agent
 */
export interface SpawnConfig {
  agentId: string;
  workspace: string;
  prompt?: string;
  model?: string;
  sessionId?: string; // For resuming existing sessions
  runtime?: RuntimeName;
  env?: Record<string, string>;
}

/**
 * Agent information
 */
export interface Agent {
  id: string;
  sessionId: string;
  runtime: RuntimeName;
  model: string;
  workspace: string;
  startedAt: Date;
}

/**
 * Runtime abstraction for agent health monitoring
 *
 * Claude Code implements this interface
 * to provide Cloister with health monitoring capabilities.
 */
export interface AgentRuntimeSync {
  /**
   * Runtime identifier
   */
  readonly name: RuntimeName;

  /**
   * Get the path to the session file/directory for an agent
   *
   * @param agentId - The agent identifier (e.g., "agent-pan-18")
   * @returns Path to the session storage
   *
   * @example
   * // Claude Code
   * "/home/user/.claude/projects/workspace-123/sessions/abc123.jsonl"
   */
  getSessionPath(agentId: string): string | null;

  /**
   * Get the last activity timestamp for an agent
   *
   * This is used for passive heartbeat detection (no agent modification needed).
   * Common sources:
   * - JSONL file modification time
   * - Tmux window activity
   * - Git commits in workspace
   *
   * @param agentId - The agent identifier
   * @returns Last activity timestamp, or null if agent not found
   */
  getLastActivity(agentId: string): Date | null;

  /**
   * Get a heartbeat from an agent
   *
   * Attempts to read an active heartbeat (if hooks configured), falls back
   * to passive detection via file timestamps.
   *
   * @param agentId - The agent identifier
   * @returns Heartbeat data, or null if agent not found
   */
  getHeartbeat(agentId: string): Heartbeat | null;

  /**
   * Get token usage for an agent's current session
   *
   * @param agentId - The agent identifier
   * @returns Token usage statistics, or null if not available
   */
  getTokenUsage(agentId: string): TokenUsage | null;

  /**
   * Get cost breakdown for an agent's current session
   *
   * @param agentId - The agent identifier
   * @returns Cost breakdown, or null if not available
   */
  getSessionCost(agentId: string): CostBreakdown | null;

  /**
   * Send a message to a running agent
   *
   * This typically uses tmux send-keys to inject a message into the agent's
   * terminal session.
   *
   * @param agentId - The agent identifier
   * @param message - The message to send
   * @throws Error if agent is not running
   */
  sendMessage(agentId: string, message: string): void | Promise<void>;

  /**
   * Kill an agent (terminate the session)
   *
   * This typically kills the tmux session and cleans up any state files.
   * May be sync or async depending on the runtime; new runtimes should
   * prefer async to avoid blocking the dashboard event loop.
   *
   * @param agentId - The agent identifier
   * @throws Error if agent cannot be killed
   */
  killAgent(agentId: string): void | Promise<void>;

  /**
   * Spawn a new agent
   *
   * Creates a tmux session and starts the runtime with the given configuration.
   *
   * @param config - Spawn configuration
   * @returns Agent information
   * @throws Error if spawn fails
   */
  spawnAgent(config: SpawnConfig): Agent | Promise<Agent>;

  /**
   * List all sessions for this runtime
   *
   * @param workspace - Optional workspace filter
   * @returns Array of session information
   */
  listSessions(workspace?: string): Session[];

  /**
   * Check if an agent is running.
   *
   * May be sync or async depending on the runtime; new runtimes should
   * prefer async to avoid blocking the dashboard event loop.
   *
   * @param agentId - The agent identifier
   * @returns True if agent has an active tmux session
   */
  isRunning(agentId: string): boolean | Promise<boolean>;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Effect-channel runtime interface. The legacy sync/promise AgentRuntimeSync
// shape above is preserved for the existing registry while new callers compose
// through the canonical Effect API.

import type { Effect } from 'effect';
import type {
  ProcessSpawnError,
  ProcessTimeoutError,
  TmuxError,
  FsError,
} from '../errors.js';

/** Tagged-error union the Effect runtime methods can fail with. */
export type AgentRuntimeError =
  | ProcessSpawnError
  | ProcessTimeoutError
  | TmuxError
  | FsError;

/**
 * Runtime interface whose side-effecting methods return typed Effects. Pure-sync
 * introspection methods stay sync because they read in-memory state.
 */
export interface AgentRuntime {
  readonly name: RuntimeName;
  getSessionPath(agentId: string): string | null;
  getLastActivity(agentId: string): Date | null;
  getHeartbeat(agentId: string): Heartbeat | null;
  getTokenUsage(agentId: string): TokenUsage | null;
  getSessionCost(agentId: string): CostBreakdown | null;
  sendMessage(agentId: string, message: string): Effect.Effect<void, AgentRuntimeError>;
  killAgent(agentId: string): Effect.Effect<void, AgentRuntimeError>;
  spawnAgent(config: SpawnConfig): Effect.Effect<Agent, AgentRuntimeError>;
  listSessions(workspace?: string): Session[];
  isRunning(agentId: string): Effect.Effect<boolean>;
}

/**
 * Registry for managing multiple runtimes
 */
export interface RuntimeRegistry {
  /**
   * Register a runtime
   */
  register(runtime: AgentRuntimeSync): void;

  /**
   * Get a runtime by name
   */
  get(name: RuntimeName): AgentRuntimeSync | undefined;

  /**
   * Get all registered runtimes
   */
  getAll(): AgentRuntimeSync[];

  /**
   * Get the runtime for a specific agent
   *
   * Looks up the agent's state file to determine which runtime it's using.
   */
  getRuntimeForAgent(agentId: string): AgentRuntimeSync | null;
}
