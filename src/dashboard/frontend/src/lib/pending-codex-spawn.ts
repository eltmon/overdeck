import type { StartAgentResponse } from '../types';

interface PendingSpawn {
  requestBody: Record<string, unknown>;
  timestamp: number;
}

let pendingSpawn: PendingSpawn | null = null;

const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

export function setPendingCodexSpawn(requestBody: Record<string, unknown>) {
  pendingSpawn = { requestBody, timestamp: Date.now() };
}

export function getPendingCodexSpawn(): PendingSpawn | null {
  if (!pendingSpawn) return null;
  if (Date.now() - pendingSpawn.timestamp > MAX_AGE_MS) {
    pendingSpawn = null;
    return null;
  }
  return pendingSpawn;
}

export function clearPendingCodexSpawn() {
  pendingSpawn = null;
}

export function hasPendingCodexSpawn(): boolean {
  return getPendingCodexSpawn() !== null;
}

export function isCodexBlockedResponse(
  res: Response,
  data: StartAgentResponse | Record<string, unknown>,
): boolean {
  return res.status === 429 && (data as StartAgentResponse).blocked === true;
}
