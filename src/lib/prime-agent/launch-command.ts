import { mkdir } from 'fs/promises';
import { join } from 'path';
import type { AuthMode } from '../subscription-types.js';
import { getAgentDir } from '../agents/agent-state.js';
import { PRIME_AGENT_MANAGED_POLICY } from './policy.js';
import { resolvePrimeAgentModelRoute } from './provider-map.js';
import { primeAgentGlobalContextFile, resolveWorkspaceContextFile } from '../context-layers/layers.js';
import { existsSync, readFileSync } from 'fs';
import { packageRoot } from '../paths.js';
import { resolveHarnessBinary } from '../harness-binary.js';
import { loadConfigSync } from '../config-yaml.js';

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface PrimeAgentLaunchCommandOptions {
  agentId: string;
  model: string;
  workspace: string;
  authMode: AuthMode;
  rpcStartupTimeoutMs?: number;
}

export async function buildPrimeAgentBaseCommand(options: PrimeAgentLaunchCommandOptions): Promise<string> {
  const route = resolvePrimeAgentModelRoute(options.model, options.authMode);
  const sessionDir = join(getAgentDir(options.agentId), 'prime-sessions');
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  const context = [primeAgentGlobalContextFile(), resolveWorkspaceContextFile(options.workspace)]
    .filter(existsSync)
    .map(file => readFileSync(file, 'utf8'))
    .join('\n\n');
  const binary = await resolveHarnessBinary('prime-agent');
  if (!binary) throw new Error('Prime Agent executable is unavailable');
  const startupTimeoutMs = options.rpcStartupTimeoutMs ?? loadConfigSync().config.primeAgent.rpcStartupTimeoutMs;
  return [
    `node ${quoteShell(join(packageRoot, 'dist', 'prime-agent-host.js'))}`,
    `--agent ${quoteShell(options.agentId)}`,
    `--binary ${quoteShell(binary)}`,
    `--workspace ${quoteShell(options.workspace)}`,
    `--provider ${quoteShell(route.provider)}`,
    `--model ${quoteShell(route.model)}`,
    `--session-dir ${quoteShell(sessionDir)}`,
    `--append-system-prompt ${quoteShell([PRIME_AGENT_MANAGED_POLICY, context].filter(Boolean).join('\n\n'))}`,
    `--startup-timeout-ms ${startupTimeoutMs}`,
  ].join(' ');
}
