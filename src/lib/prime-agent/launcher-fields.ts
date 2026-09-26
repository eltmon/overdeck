/**
 * Launcher fields for a Prime Agent host launch (PAN-3668 WI-12, FR-3, FR-5, FR-14).
 *
 * Resolves the Prime provider and credential (D12) and the private daemon socket
 * (NFR-9) before any pane exists, so a missing credential or an over-long socket path
 * fails the launch early. It materializes the harness-rendered context into
 * `<agentDir>/prime-agent-context.md` (D8). `paneEnv` carries credential values for the
 * terminal-backend launch env; they never enter the launcher script.
 */
import { join } from 'node:path';

import { getAgentDir } from '../agents/agent-state.js';
import { getProviderAuthMode } from '../agents/runtime-command.js';
import { materializeManagedLaunchContext } from '../context-layers/materialize.js';
import { PRIME_AGENT_CONTEXT_FILE, primeAgentDaemonSocketPath } from '../runtimes/storage/prime-agent.js';
import { PRIME_AGENT_THINKING_LEVELS } from './compat.js';
import { resolvePrimeAgentCredential } from './provider-map.js';

export interface PrimeAgentLauncherFields {
  harness: 'prime-agent';
  primeAgent: {
    agentId: string;
    binaryPath: string;
    provider: string;
    workspace: string;
    contextFile: string;
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
  options: { effort?: string; resumeSessionFile?: string } = {},
): Promise<{ fields: PrimeAgentLauncherFields; paneEnv: Record<string, string> }> {
  const credential = await resolvePrimeAgentCredential(model, await getProviderAuthMode(model));
  primeAgentDaemonSocketPath(agentId);
  const contextFile = materializeManagedLaunchContext(join(getAgentDir(agentId), PRIME_AGENT_CONTEXT_FILE), workspace, 'prime-agent');
  const thinking = options.effort && (PRIME_AGENT_THINKING_LEVELS as readonly string[]).includes(options.effort) ? options.effort : undefined;
  return {
    fields: {
      harness: 'prime-agent',
      primeAgent: {
        agentId,
        binaryPath,
        provider: credential.provider,
        workspace,
        contextFile,
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
