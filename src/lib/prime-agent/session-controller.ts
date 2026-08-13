import type { PrimeAgentRpcClient, PrimeAgentRpcResponse } from './rpc-client.js';

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
  const session = getPrimeAgentSession(agentId);
  const state = await session.client.request<{ isStreaming?: boolean }>({ type: 'get_state' });
  const command = state.data?.isStreaming
    ? preferred === 'follow_up' ? 'follow_up' : 'steer'
    : 'prompt';
  await session.client.request({ type: command, message });
  return { accepted: true, command };
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
