/**
 * Resume-session recovery — one tiny store so any action surface (registry
 * actions, simple mode) can turn the server's 409 "has a resumable session"
 * into a proper dialog with working choices instead of a raw CLI-text alert.
 */
import { create } from 'zustand';

export interface RecoveryRequest {
  agentId: string;
  issueId?: string;
}

interface ResumeRecoveryState {
  request: RecoveryRequest | null;
  openRecovery: (request: RecoveryRequest) => void;
  closeRecovery: () => void;
}

export const useResumeRecovery = create<ResumeRecoveryState>((set) => ({
  request: null,
  openRecovery: (request) => set({ request }),
  closeRecovery: () => set({ request: null }),
}));

/**
 * Inspect a failed action response's parsed body: the start route's 409 for a
 * resumable session carries the full lifecycle object — that's the signal to
 * offer Resume / Start fresh rather than an alert with CLI instructions.
 */
export function resumableRecoveryFromBody(body: unknown): RecoveryRequest | null {
  if (!body || typeof body !== 'object') return null;
  const lifecycle = (body as { lifecycle?: { agentId?: string; canResumeSession?: boolean; recommendedAction?: string } }).lifecycle;
  if (lifecycle?.canResumeSession === true && typeof lifecycle.agentId === 'string') {
    return { agentId: lifecycle.agentId };
  }
  return null;
}
