/**
 * Remote Workspace Module
 *
 * Provides support for running workspaces on remote Fly.io Machines
 * to offload Claude agents from the local machine.
 */

export type {
  RemoteProvider,
  VmInfo,
  VmStatus,
  ExecResult,
  RemoteProviderConfig,
  RemoteWorkspaceMetadata,
} from './interface.js';

export { FlyProvider, createFlyProvider } from './fly-provider.js';
export type { FlyProviderConfig } from './fly-provider.js';

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

// Workspace metadata management
export {
  saveWorkspaceMetadataSync,
  loadWorkspaceMetadataSync,
  listWorkspaceMetadataSync,
  deleteWorkspaceMetadataSync,
  findRemoteWorkspaceMetadataSync,
  WORKSPACES_DIR,
} from './workspace-metadata.js';

import { Effect } from 'effect';
import { FlyProvider, createFlyProvider } from './fly-provider.js';
import type { RemoteProvider, RemoteProviderConfig } from './interface.js';

export type ProviderType = 'fly';

/**
 * Get a remote provider by type
 */
export function getRemoteProvider(
  type: ProviderType,
  config?: RemoteProviderConfig
): RemoteProvider {
  switch (type) {
    case 'fly':
      return createFlyProvider();
    default:
      throw new Error(`Unknown remote provider type: ${type}`);
  }
}

/**
 * Check if remote providers are available
 */
export async function isRemoteAvailable(): Promise<{ available: boolean; reason?: string }> {
  const fly = createFlyProvider();

  try {
    const isAuth = await Effect.runPromise(fly.isAuthenticated());
    if (!isAuth) {
      return {
        available: false,
        reason: 'Not authenticated with Fly.io. Set FLY_API_TOKEN or run: fly auth login',
      };
    }
    return { available: true };
  } catch (error: any) {
    return {
      available: false,
      reason: `Fly.io not available: ${error.message}`,
    };
  }
}

/**
 * Create a FlyProvider from config settings
 */
export function createFlyProviderFromConfig(remoteConfig?: {
  fly?: {
    app?: string;
    org?: string;
    region?: string;
    vm_size?: string;
    vm_memory?: number;
    image?: string;
    api_token_env?: string;
  };
}): FlyProvider {
  const fly = remoteConfig?.fly;
  const tokenEnv = fly?.api_token_env ?? 'FLY_API_TOKEN';
  return createFlyProvider({
    app: fly?.app,
    org: fly?.org,
    region: fly?.region,
    vmSize: fly?.vm_size,
    vmMemory: fly?.vm_memory,
    image: fly?.image,
    apiToken: process.env[tokenEnv],
  });
}
