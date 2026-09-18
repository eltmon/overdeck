import type { PrimeAgentRpcResponse } from './rpc-client.js';
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { AGENTS_DIR, getOverdeckHome } from '../paths.js';

export interface PrimeAgentDeliveryReceipt {
  accepted: true;
  command: 'prompt' | 'steer' | 'follow_up';
}

/**
 * Grace period between `abort` and terminating the owned process tree, so a
 * Prime child that is mid-generation gets a chance to stop cleanly before its
 * tmux session is killed (runtime-adapter.ac3, message-delivery.ac3).
 */
export const PRIME_AGENT_KILL_GRACE_MS = 1_000;

/**
 * Deadline for one host request. `postPrimeAgentHost` talks to a host process
 * that is itself waiting on the Prime child, so a wedged child would otherwise
 * hang the caller forever — including `killAgent`, which must not be blocked by
 * the very process it is trying to kill.
 */
export const PRIME_AGENT_HOST_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The Prime child is owned by a separate host process (`src/lib/prime-agent/host.ts`)
 * and reached over its unix socket — never in-process. The host decides between
 * `prompt` and `steer`/`follow_up` from the child's own `get_state.isStreaming`,
 * so this is a thin pass-through rather than a second copy of that rule.
 */
export async function deliverPrimeAgentMessage(
  agentId: string,
  message: string,
  preferred: 'prompt' | 'steer' | 'follow_up' = 'steer',
): Promise<PrimeAgentDeliveryReceipt> {
  const result = await postPrimeAgentHost(agentId, { op: 'message', message, preferred });
  return { accepted: true, command: result.command as PrimeAgentDeliveryReceipt['command'] };
}

export async function postPrimeAgentHost(
  agentId: string,
  body: unknown,
  timeoutMs = PRIME_AGENT_HOST_REQUEST_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const socketPath = join(getOverdeckHome(), 'sockets', `prime-agent-${agentId}.sock`);
  const tokenPath = join(AGENTS_DIR, agentId, 'prime-agent-token');
  if (!existsSync(socketPath)) throw new Error(`MessageDeliveryFailed: Prime Agent host is unavailable for ${agentId}`);
  const token = readFileSync(tokenPath, 'utf8').trim();
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/', method: 'POST', headers: { 'content-type': 'application/json', 'x-overdeck-bridge-token': token } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode ?? 500) >= 300) reject(new Error(`Prime Agent host returned HTTP ${response.statusCode}: ${text}`));
        else resolve(text ? JSON.parse(text) as Record<string, unknown> : {});
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Prime Agent host request timed out after ${timeoutMs}ms for ${agentId}`));
    });
    req.once('error', reject);
    req.end(JSON.stringify(body));
  });
}

export type { PrimeAgentRpcResponse };
