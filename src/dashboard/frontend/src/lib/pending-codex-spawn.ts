import type { StartAgentResponse } from '../types';

interface PendingSpawn {
  requestBody?: Record<string, unknown>;
  timestamp: number;
  reauthSessionName?: string;
  reauthStatusToken?: string;
}

let pendingSpawn: PendingSpawn | null = null;

const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const STORAGE_KEY = 'panopticon.codex.pendingSpawn';

function readStoredPendingSpawn(): PendingSpawn | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as PendingSpawn : null;
  } catch {
    return null;
  }
}

function writeStoredPendingSpawn(value: PendingSpawn | null) {
  pendingSpawn = value;
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // In-memory state still works when sessionStorage is unavailable.
  }
}

function currentPendingSpawn(): PendingSpawn | null {
  return pendingSpawn ?? readStoredPendingSpawn();
}

export function setPendingCodexSpawn(requestBody: Record<string, unknown>) {
  const existing = currentPendingSpawn();
  writeStoredPendingSpawn({
    ...existing,
    requestBody,
    timestamp: Date.now(),
  });
}

export function setReauthSession(sessionName: string, statusToken: string) {
  const existing = currentPendingSpawn();
  writeStoredPendingSpawn({
    ...existing,
    timestamp: existing?.timestamp ?? Date.now(),
    reauthSessionName: sessionName,
    reauthStatusToken: statusToken,
  });
}

export function getPendingCodexSpawn(): PendingSpawn | null {
  const current = currentPendingSpawn();
  if (!current) return null;
  if (Date.now() - current.timestamp > MAX_AGE_MS) {
    writeStoredPendingSpawn(null);
    return null;
  }
  pendingSpawn = current;
  return current;
}

export function clearPendingCodexSpawn() {
  writeStoredPendingSpawn(null);
}

export function clearPendingCodexReauthSession() {
  const existing = currentPendingSpawn();
  if (!existing?.requestBody) {
    writeStoredPendingSpawn(null);
    return;
  }
  writeStoredPendingSpawn({
    requestBody: existing.requestBody,
    timestamp: Date.now(),
  });
}

export function hasPendingCodexSpawn(): boolean {
  return !!getPendingCodexSpawn()?.requestBody;
}

export function isCodexBlockedResponse(
  res: Response,
  data: StartAgentResponse | Record<string, unknown>,
): boolean {
  const response = data as StartAgentResponse;
  return res.status === 429
    && response.blocked === true
    && typeof response.error === 'string'
    && response.error.startsWith('Codex authentication ');
}
