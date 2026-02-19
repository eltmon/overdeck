/**
 * Runtime Architecture (Claude Code only)
 *
 * Export the Claude runtime adapter and provide a registry
 */

export * from './interface.js';
export { createClaudeAdapter } from './claude.js';

import type { RuntimeAdapter, RuntimeType, RuntimeRegistry } from './interface.js';
import { createClaudeAdapter } from './claude.js';

/**
 * Create a runtime registry with the Claude adapter
 */
export function createRuntimeRegistry(): RuntimeRegistry {
  const adapters = new Map<RuntimeType, RuntimeAdapter>();

  const claude = createClaudeAdapter();
  adapters.set('claude', claude);

  return {
    register(adapter: RuntimeAdapter): void {
      adapters.set(adapter.type, adapter);
    },

    get(type: RuntimeType): RuntimeAdapter | undefined {
      return adapters.get(type);
    },

    getAll(): RuntimeAdapter[] {
      return Array.from(adapters.values());
    },

    async getAvailable(): Promise<RuntimeAdapter[]> {
      const available: RuntimeAdapter[] = [];

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
export function getRuntimeAdapter(type: RuntimeType): RuntimeAdapter {
  if (type !== 'claude') {
    throw new Error(`Unknown runtime type: ${type}. Only 'claude' is supported.`);
  }
  return createClaudeAdapter();
}

/**
 * Get all supported runtime types
 */
export function getSupportedRuntimes(): RuntimeType[] {
  return ['claude'];
}

/**
 * Check if a runtime is installed
 */
export async function isRuntimeInstalled(type: RuntimeType): Promise<boolean> {
  const adapter = getRuntimeAdapter(type);
  return adapter.isAvailable();
}

/**
 * Get installed runtimes
 */
export async function getInstalledRuntimes(): Promise<RuntimeType[]> {
  const installed: RuntimeType[] = [];

  for (const type of getSupportedRuntimes()) {
    if (await isRuntimeInstalled(type)) {
      installed.push(type);
    }
  }

  return installed;
}
