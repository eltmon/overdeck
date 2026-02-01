/**
 * Remote Workspace Module
 *
 * Provides support for running workspaces on remote VMs (exe.dev, etc.)
 * to offload Docker containers and Claude agents from local machine.
 */

export type {
  RemoteProvider,
  VmInfo,
  VmStatus,
  ExecResult,
  RemoteProviderConfig,
  RemoteWorkspaceMetadata,
} from './interface.js';

export { ExeProvider, createExeProvider } from './exe-provider.js';
export type { ExeProviderConfig } from './exe-provider.js';

// Remote agent management
export {
  spawnRemoteAgent,
  getRemoteAgentOutput,
  sendToRemoteAgent,
  isRemoteAgentRunning,
  killRemoteAgent,
  listRemoteAgents,
  pollRemoteAgentStatus,
  loadRemoteAgentState,
} from './remote-agents.js';
export type { RemoteAgentState, SpawnRemoteAgentOptions } from './remote-agents.js';

import { ExeProvider, createExeProvider } from './exe-provider.js';
import type { RemoteProvider, RemoteProviderConfig } from './interface.js';

export type ProviderType = 'exe';

/**
 * Get a remote provider by type
 */
export function getRemoteProvider(
  type: ProviderType,
  config?: RemoteProviderConfig
): RemoteProvider {
  switch (type) {
    case 'exe':
      return createExeProvider({
        infraVm: config?.infraVm,
      });
    default:
      throw new Error(`Unknown remote provider type: ${type}`);
  }
}

/**
 * Check if remote providers are available
 */
export async function isRemoteAvailable(): Promise<{ available: boolean; reason?: string }> {
  const exe = createExeProvider();

  try {
    const isAuth = await exe.isAuthenticated();
    if (!isAuth) {
      return {
        available: false,
        reason: 'Not authenticated with exe.dev. Run: exe auth login',
      };
    }
    return { available: true };
  } catch (error: any) {
    return {
      available: false,
      reason: `exe.dev CLI not installed or not working: ${error.message}`,
    };
  }
}
