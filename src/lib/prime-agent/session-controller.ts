import type { PrimeAgentRpcClient, PrimeAgentRpcResponse } from './rpc-client.js';
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { AGENTS_DIR, getOverdeckHome } from '../paths.js';

export interface PrimeAgentManagedSession {
  client: Pick<PrimeAgentRpcClient, 'request'>;
  terminate: () => Promise<void>;
}

export interface PrimeAgentDeliveryReceipt {
  accepted: true;
  command: 'prompt' | 'steer' | 'follow_up';
}

const sessions = new Map<string, PrimeAgentManagedSession>();

export function hasPrimeAgentSession(agentId: string): boolean {
  return sessions.has(agentId);
}

export function registerPrimeAgentSession(agentId: string, session: PrimeAgentManagedSession): () => void {
  sessions.set(agentId, session);
  return () => {
    if (sessions.get(agentId) === session) sessions.delete(agentId);
  };
}

export function getPrimeAgentSession(agentId: string): PrimeAgentManagedSession {
  const session = sessions.get(agentId);
  if (!session) throw new Error(`MessageDeliveryFailed: Prime Agent RPC session is unavailable for ${agentId}`);
  return session;
}

export async function deliverPrimeAgentMessage(
  agentId: string,
  message: string,
  preferred: 'prompt' | 'steer' | 'follow_up' = 'steer',
): Promise<PrimeAgentDeliveryReceipt> {
  const session = sessions.get(agentId);
  if (!session) {
    const result = await postPrimeAgentHost(agentId, { op: 'message', message, preferred });
    return { accepted: true, command: result.command as PrimeAgentDeliveryReceipt['command'] };
  }
  const state = await session.client.request<{ isStreaming?: boolean }>({ type: 'get_state' });
  const command = state.data?.isStreaming
    ? preferred === 'follow_up' ? 'follow_up' : 'steer'
    : 'prompt';
  await session.client.request({ type: command, message });
  return { accepted: true, command };
}

export async function postPrimeAgentHost(agentId: string, body: unknown): Promise<Record<string, unknown>> {
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
    req.once('error', reject);
    req.end(JSON.stringify(body));
  });
}

export async function killPrimeAgentSession(agentId: string, graceMs = 1_000): Promise<void> {
  const session = getPrimeAgentSession(agentId);
  try {
    await session.client.request({ type: 'abort' });
  } finally {
    await new Promise(resolve => setTimeout(resolve, graceMs));
    await session.terminate();
    sessions.delete(agentId);
  }
}

export function clearPrimeAgentSessionsForTests(): void {
  sessions.clear();
}

export type { PrimeAgentRpcResponse };
