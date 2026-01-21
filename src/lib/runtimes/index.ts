/**
 * Cloister Runtime Abstraction
 *
 * Export all runtime types and provide a unified registry for managing
 * multiple AI coding assistant runtimes.
 */

export * from './types.js';
export { ClaudeCodeRuntime, createClaudeCodeRuntime } from './claude-code.js';

import type {
  AgentRuntime,
  RuntimeName,
  RuntimeRegistry as RuntimeRegistryInterface,
} from './types.js';
import { getAgentState } from '../agents.js';
import { createClaudeCodeRuntime } from './claude-code.js';

/**
 * Runtime registry implementation
 *
 * Manages multiple runtime adapters and provides lookup by agent ID.
 */
export class RuntimeRegistry implements RuntimeRegistryInterface {
  private runtimes: Map<RuntimeName, AgentRuntime> = new Map();

  /**
   * Register a runtime adapter
   */
  register(runtime: AgentRuntime): void {
    this.runtimes.set(runtime.name, runtime);
  }

  /**
   * Get a runtime by name
   */
  get(name: RuntimeName): AgentRuntime | undefined {
    return this.runtimes.get(name);
  }

  /**
   * Get all registered runtimes
   */
  getAll(): AgentRuntime[] {
    return Array.from(this.runtimes.values());
  }

  /**
   * Get the runtime for a specific agent
   *
   * Looks up the agent's state file to determine which runtime it's using.
   */
  getRuntimeForAgent(agentId: string): AgentRuntime | null {
    const state = getAgentState(agentId);
    if (!state) {
      return null;
    }

    // Map the state.runtime to a RuntimeName
    // The state.runtime may be 'claude', 'opencode', etc.
    let runtimeName: RuntimeName;

    switch (state.runtime) {
      case 'claude':
      case 'claude-code':
        runtimeName = 'claude-code';
        break;
      case 'opencode':
        runtimeName = 'opencode';
        break;
      case 'codex':
        runtimeName = 'codex';
        break;
      default:
        // Default to claude-code if unknown
        runtimeName = 'claude-code';
    }

    return this.get(runtimeName) || null;
  }
}

/**
 * Global runtime registry instance
 */
let globalRegistry: RuntimeRegistry | null = null;

/**
 * Get the global runtime registry
 *
 * Creates a new registry if one doesn't exist.
 * Registers Claude Code runtime by default.
 */
export function getGlobalRegistry(): RuntimeRegistry {
  if (!globalRegistry) {
    globalRegistry = new RuntimeRegistry();

    // Register Claude Code runtime by default
    globalRegistry.register(createClaudeCodeRuntime());

    // TODO: Register other runtimes (OpenCode, Codex) when implemented
  }
  return globalRegistry;
}

/**
 * Set the global runtime registry
 *
 * Useful for testing or custom configurations.
 */
export function setGlobalRegistry(registry: RuntimeRegistry): void {
  globalRegistry = registry;
}

/**
 * Helper to get a runtime by name from the global registry
 */
export function getRuntime(name: RuntimeName): AgentRuntime | undefined {
  return getGlobalRegistry().get(name);
}

/**
 * Helper to get the runtime for an agent from the global registry
 */
export function getRuntimeForAgent(agentId: string): AgentRuntime | null {
  return getGlobalRegistry().getRuntimeForAgent(agentId);
}
