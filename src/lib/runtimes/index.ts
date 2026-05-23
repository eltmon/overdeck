/**
 * Cloister Runtime Abstraction
 *
 * Export all runtime types and provide a unified registry for managing
 * multiple AI coding assistant runtimes.
 */

export * from './types.js';
export {
  ClaudeCodeRuntimeSync,
  ClaudeCodeRuntime,
  createClaudeCodeRuntimeSync,
  createClaudeCodeRuntime,
} from './claude-code.js';
export {
  PiRuntimeSync,
  PiRuntime,
  createPiRuntimeSync,
  createPiRuntime,
  PiSpawnTimeout,
} from './pi.js';

import type {
  AgentRuntimeSync,
  RuntimeName,
  RuntimeRegistry as RuntimeRegistryInterface,
} from './types.js';
import { getAgentStateSync } from '../agents.js';
import { createClaudeCodeRuntimeSync } from './claude-code.js';
import { createPiRuntimeSync } from './pi.js';

/**
 * Runtime registry implementation
 *
 * Manages multiple runtime adapters and provides lookup by agent ID.
 */
export class RuntimeRegistry implements RuntimeRegistryInterface {
  private runtimes: Map<RuntimeName, AgentRuntimeSync> = new Map();

  /**
   * Register a runtime adapter
   */
  register(runtime: AgentRuntimeSync): void {
    this.runtimes.set(runtime.name, runtime);
  }

  /**
   * Get a runtime by name
   */
  get(name: RuntimeName): AgentRuntimeSync | undefined {
    return this.runtimes.get(name);
  }

  /**
   * Get all registered runtimes
   */
  getAll(): AgentRuntimeSync[] {
    return Array.from(this.runtimes.values());
  }

  /**
   * Get the runtime for a specific agent.
   *
   * Reads the agent's state file and dispatches by `state.harness`. When
   * the harness field is missing or carries a legacy value (e.g. 'claude'
   * from pre-PAN-636 wire format), we fall back to the claude-code runtime
   * to preserve back-compat (PAN-636 ac2).
   */
  getRuntimeForAgent(agentId: string): AgentRuntimeSync | null {
    const state = getAgentStateSync(agentId);
    if (!state) {
      return null;
    }
    const harness = (state as { harness?: RuntimeName }).harness;
    if (harness === 'pi') {
      return this.get('pi') ?? null;
    }
    return this.get('claude-code') ?? null;
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

    // Register Claude Code (default) and Pi runtimes (PAN-636).
    globalRegistry.register(createClaudeCodeRuntimeSync());
    globalRegistry.register(createPiRuntimeSync());
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
export function getRuntime(name: RuntimeName): AgentRuntimeSync | undefined {
  return getGlobalRegistry().get(name);
}

/**
 * Helper to get the runtime for an agent from the global registry
 */
export function getRuntimeForAgent(agentId: string): AgentRuntimeSync | null {
  return getGlobalRegistry().getRuntimeForAgent(agentId);
}
