/**
 * Client for the Pull here job (PAN-4650 WI-14, D-4650-12):
 * `POST /api/linked-conversations/pull` starts it, `GET …/pull/:pullId` reports it.
 */
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';

export type PullStep = 'release' | 'transfer' | 'adopt' | 'finish';
export const PULL_STEPS: readonly PullStep[] = ['release', 'transfer', 'adopt', 'finish'];
export const PULL_POLL_MS = 1_000;

export interface PullStatus {
  step: PullStep;
  state: 'running' | 'done' | 'failed';
  mode?: 'online' | 'offline';
  error?: string;
  code?: string;
  conversation?: { id: number; name: string };
}

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `HTTP ${response.status}`;
}

export async function startPull(conversation: string, whenTurnRunning: 'wait' | 'stop'): Promise<string> {
  const response = await fetch('/api/linked-conversations/pull', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ conversation, whenTurnRunning }),
  });
  if (response.status !== 202) throw new Error(await errorOf(response));
  return ((await response.json()) as { pullId: string }).pullId;
}

export async function getPull(pullId: string): Promise<PullStatus> {
  const response = await fetch(`/api/linked-conversations/pull/${encodeURIComponent(pullId)}`);
  if (!response.ok) throw new Error(await errorOf(response));
  return (await response.json()) as PullStatus;
}
