/**
 * Runtime Architecture (Claude Code only)
 *
 * Export the Claude runtime adapter and provide a registry
 */

export * from './interface.js';
export { createClaudeAdapterSync, createClaudeAdapter } from './claude.js';

import { Effect } from 'effect';
import type {
  RuntimeAdapterLegacy,
  RuntimeType,
  RuntimeRegistry,
} from './interface.js';
import { createClaudeAdapterSync } from './claude.js';

/**
 * Create a runtime registry with the Claude adapter
 */
export function createRuntimeRegistry(): RuntimeRegistry {
  const adapters = new Map<RuntimeType, RuntimeAdapterLegacy>();

  const claude = createClaudeAdapterSync();
  adapters.set('claude', claude);

  return {
    register(adapter: RuntimeAdapterLegacy): void {
      adapters.set(adapter.type, adapter);
    },

    get(type: RuntimeType): RuntimeAdapterLegacy | undefined {
      return adapters.get(type);
    },

    getAll(): RuntimeAdapterLegacy[] {
      return Array.from(adapters.values());
    },

    async getAvailable(): Promise<RuntimeAdapterLegacy[]> {
      const available: RuntimeAdapterLegacy[] = [];

      for (const adapter of adapters.values()) {
        if (await adapter.isAvailable()) {
          available.push(adapter);
        }
      }

      return available;
    },

    async syncToAll(sourceDir: string, force?: boolean): Promise<Map<RuntimeType, number>> {
      const results = new Map<RuntimeType, number>();

      for (const adapter of adapters.values()) {
        try {
          const synced = await adapter.syncSkills(sourceDir, force);
          results.set(adapter.type, synced);
        } catch (error) {
          console.error(`Failed to sync to ${adapter.type}:`, error);
          results.set(adapter.type, 0);
        }
      }

      return results;
    },
  };
}

/**
 * Get a runtime adapter by type
 */
export function getRuntimeAdapter(type: RuntimeType): RuntimeAdapterLegacy {
  if (type !== 'claude') {
    throw new Error(`Unknown runtime type: ${type}. Only 'claude' is supported.`);
  }
  return createClaudeAdapterSync();
}

/**
 * Get all supported runtime types
 */
export function getSupportedRuntimes(): RuntimeType[] {
  return ['claude'];
}async function isRuntimeInstalledPromise(type: RuntimeType): Promise<boolean> {
  const adapter = getRuntimeAdapter(type);
  return adapter.isAvailable();
}async function getInstalledRuntimesPromise(): Promise<RuntimeType[]> {
  const installed: RuntimeType[] = [];

  for (const type of getSupportedRuntimes()) {
    if (await Effect.runPromise(isRuntimeInstalled(type))) {
      installed.push(type);
    }
  }

  return installed;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect-channel variants of the registry/install helpers. Sync and
// promise variants above remain the canonical API for existing callers.

/** Effect variant of {@link isRuntimeInstalled}. */
export const isRuntimeInstalled = (
  type: RuntimeType,
): Effect.Effect<boolean> =>
  Effect.promise(() => isRuntimeInstalledPromise(type));

/** Effect variant of {@link getInstalledRuntimes}. */
export const getInstalledRuntimes = (): Effect.Effect<RuntimeType[]> =>
  Effect.promise(() => getInstalledRuntimesPromise());

/** Effect variant of {@link RuntimeRegistry.getAvailable}. */
export const registryGetAvailable = (
  registry: RuntimeRegistry,
): Effect.Effect<RuntimeAdapterLegacy[]> =>
  Effect.promise(() => registry.getAvailable());

/** Effect variant of {@link RuntimeRegistry.syncToAll}. */
export const registrySyncToAll = (
  registry: RuntimeRegistry,
  sourceDir: string,
  force?: boolean,
): Effect.Effect<Map<RuntimeType, number>> =>
  Effect.promise(() => registry.syncToAll(sourceDir, force));
