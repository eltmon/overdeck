import { mkdir } from 'fs/promises';
import { join } from 'path';
import type { AuthMode } from '../subscription-types.js';
import { getAgentDir } from '../agents/agent-state.js';
import { PRIME_AGENT_MANAGED_POLICY } from './policy.js';
import { resolvePrimeAgentModelRoute } from './provider-map.js';

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface PrimeAgentLaunchCommandOptions {
  agentId: string;
  model: string;
  workspace: string;
  authMode: AuthMode;
}

export async function buildPrimeAgentBaseCommand(options: PrimeAgentLaunchCommandOptions): Promise<string> {
  const route = resolvePrimeAgentModelRoute(options.model, options.authMode);
  const sessionDir = join(getAgentDir(options.agentId), 'prime-sessions');
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  return [
    'prime-agent --mode rpc',
    `--provider ${quoteShell(route.provider)}`,
    `--model ${quoteShell(route.model)}`,
    `--session-dir ${quoteShell(sessionDir)}`,
    `--append-system-prompt ${quoteShell(PRIME_AGENT_MANAGED_POLICY)}`,
  ].join(' ');
}
