/**
 * Runtime Architecture
 *
 * Provides a unified interface for interacting with Claude Code,
 * the sole supported AI coding assistant runtime.
 */

export type RuntimeType = 'claude';

/**
 * Configuration for a runtime
 */
export interface RuntimeConfig {
  type: RuntimeType;
  name: string;
  version?: string;
  configDir: string;
  skillsDir: string;
  commandsDir?: string;
  executable?: string;
  apiKeyEnv?: string;
  features: RuntimeFeatures;
}

/**
 * Features supported by a runtime
 */
export interface RuntimeFeatures {
  skills: boolean;
  commands: boolean;
  mcpServers: boolean;
  hooks: boolean;
  multiModel: boolean;
  backgroundAgents: boolean;
  planMode: boolean;
  webSearch: boolean;
  codeExecution: boolean;
}

/**
 * Agent spawn options
 */
export interface AgentSpawnOptions {
  workingDir: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * Agent status
 */
export interface AgentStatus {
  id: string;
  runtime: RuntimeType;
  status: 'running' | 'stopped' | 'error' | 'completed';
  pid?: number;
  startedAt: string;
  lastActivity?: string;
  error?: string;
}

/**
 * Message to send to an agent
 */
export interface AgentMessage {
  content: string;
  type?: 'user' | 'system' | 'error';
}

/**
 * Runtime adapter interface
 */
export interface RuntimeAdapterLegacy {
  readonly type: RuntimeType;
  readonly config: RuntimeConfig;

  /**
   * Check if the runtime is installed and available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the version of the runtime
   */
  getVersion(): Promise<string | null>;

  /**
   * Initialize the runtime (create config dirs, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Spawn an agent in this runtime
   */
  spawnAgent(id: string, options: AgentSpawnOptions): Promise<boolean>;

  /**
   * Send a message to a running agent
   */
  sendMessage(id: string, message: AgentMessage): Promise<boolean>;

  /**
   * Get the status of an agent
   */
  getAgentStatus(id: string): Promise<AgentStatus | null>;

  /**
   * Stop an agent
   */
  stopAgent(id: string): Promise<boolean>;

  /**
   * List all running agents
   */
  listAgents(): Promise<AgentStatus[]>;

  /**
   * Sync skills to this runtime
   */
  syncSkills(sourceDir: string, force?: boolean): Promise<number>;

  /**
   * Sync commands to this runtime
   */
  syncCommands?(sourceDir: string, force?: boolean): Promise<number>;

  /**
   * Get the skills directory for this runtime
   */
  getSkillsDir(): string;

  /**
   * Get the commands directory for this runtime
   */
  getCommandsDir?(): string;
}

/**
 * Runtime registry for managing multiple runtimes
 */
export interface RuntimeRegistry {
  /**
   * Register a runtime adapter
   */
  register(adapter: RuntimeAdapterLegacy): void;

  /**
   * Get a runtime adapter by type
   */
  get(type: RuntimeType): RuntimeAdapterLegacy | undefined;

  /**
   * Get all registered runtimes
   */
  getAll(): RuntimeAdapterLegacy[];

  /**
   * Get all available (installed) runtimes
   */
  getAvailable(): Promise<RuntimeAdapterLegacy[]>;

  /**
   * Sync skills to all registered runtimes
   */
  syncToAll(sourceDir: string, force?: boolean): Promise<Map<RuntimeType, number>>;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Effect-channel runtime adapter interface. The legacy Promise-based
// RuntimeAdapterLegacy shape above is preserved for existing dashboard and CLI
// callers while new consumers compose through the canonical Effect API.

import type { Effect } from 'effect';
import type {
  ProcessSpawnError,
  ProcessTimeoutError,
  FsError,
} from '../errors.js';

/** Tagged-error union the Effect runtime methods can fail with. */
export type RuntimeAdapterError =
  | ProcessSpawnError
  | ProcessTimeoutError
  | FsError;

/**
 * Runtime adapter whose methods return Effects; failure channels carry tagged
 * errors for typed `Effect.catchTag` branching.
 */
export interface RuntimeAdapter {
  readonly type: RuntimeType;
  readonly config: RuntimeConfig;

  isAvailable(): Effect.Effect<boolean>;
  getVersion(): Effect.Effect<string | null>;
  initialize(): Effect.Effect<void, FsError>;
  spawnAgent(id: string, options: AgentSpawnOptions): Effect.Effect<boolean>;
  sendMessage(id: string, message: AgentMessage): Effect.Effect<boolean>;
  getAgentStatus(id: string): Effect.Effect<AgentStatus | null>;
  stopAgent(id: string): Effect.Effect<boolean>;
  listAgents(): Effect.Effect<AgentStatus[]>;
  syncSkills(sourceDir: string, force?: boolean): Effect.Effect<number, FsError>;
  syncCommands?(sourceDir: string, force?: boolean): Effect.Effect<number, FsError>;
  getSkillsDir(): string;
  getCommandsDir?(): string;
}

/**
 * Default feature set for runtimes
 */
export const DEFAULT_FEATURES: RuntimeFeatures = {
  skills: true,
  commands: false,
  mcpServers: false,
  hooks: false,
  multiModel: false,
  backgroundAgents: false,
  planMode: false,
  webSearch: false,
  codeExecution: true,
};

/**
 * Claude Code feature set
 */
export const CLAUDE_FEATURES: RuntimeFeatures = {
  skills: true,
  commands: true,
  mcpServers: true,
  hooks: true,
  multiModel: true,
  backgroundAgents: true,
  planMode: true,
  webSearch: true,
  codeExecution: true,
};

