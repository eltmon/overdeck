/**
 * Launcher fields for a Prime Agent host launch (PAN-3668 WI-12, FR-3, FR-5, FR-14).
 *
 * Resolves the Prime provider and credential (D12) and the private daemon socket
 * (NFR-9) before any pane exists, so a missing credential or an over-long socket path
 * fails the launch early. It materializes the harness-rendered context into
 * `<agentDir>/prime-agent-context.md` (D8). `paneEnv` carries credential values for the
 * terminal-backend launch env; they never enter the launcher script.
 *
 * It imports nothing from src/lib/agents/ (callers pass the provider auth mode), so
 * the spawn modules that import it form no import cycle.
 */
import { materializeManagedLaunchContext } from '../context-layers/materialize.js';
import { primeAgentContextFilePath, primeAgentDaemonSocketPath } from '../runtimes/storage/prime-agent.js';
import type { AuthMode } from '../subscription-types.js';
import { PRIME_AGENT_THINKING_LEVELS } from './compat.js';
import { resolvePrimeAgentCredential } from './provider-map.js';

export interface PrimeAgentLauncherFields {
  harness: 'prime-agent';
  primeAgent: {
    agentId: string;
    binaryPath: string;
    provider: string;
    workspace: string;
    /** Absent for a bare-context conversation. */
    contextFile?: string;
    thinking?: string;
    resumeSessionFile?: string;
  };
  model: string;
  unsetProviderEnv: true;
  /** Credential env names the launcher must not unset: their values arrive in the pane env. */
  preserveProviderEnv: string[];
}

export async function getPrimeAgentLauncherFields(
  agentId: string,
  model: string,
  workspace: string,
  binaryPath: string,
  options: { authMode: AuthMode | undefined; effort?: string; resumeSessionFile?: string; withContext?: boolean },
): Promise<{ fields: PrimeAgentLauncherFields; paneEnv: Record<string, string> }> {
  const credential = await resolvePrimeAgentCredential(model, options.authMode);
  primeAgentDaemonSocketPath(agentId);
  const contextFile = options.withContext === false
    ? undefined
    : materializeManagedLaunchContext(primeAgentContextFilePath(agentId), workspace, 'prime-agent');
  const thinking = options.effort && (PRIME_AGENT_THINKING_LEVELS as readonly string[]).includes(options.effort) ? options.effort : undefined;
  return {
    fields: {
      harness: 'prime-agent',
      primeAgent: {
        agentId,
        binaryPath,
        provider: credential.provider,
        workspace,
        ...(contextFile ? { contextFile } : {}),
        ...(thinking ? { thinking } : {}),
        ...(options.resumeSessionFile ? { resumeSessionFile: options.resumeSessionFile } : {}),
      },
      model,
      unsetProviderEnv: true,
      preserveProviderEnv: Object.keys(credential.envExports),
    },
    paneEnv: credential.envExports,
  };
}
