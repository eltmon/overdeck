/**
 * Start-block recovery — one tiny store so any action surface (registry
 * actions, simple mode) can turn the server's 409 start blocks (resumable
 * session, troubled gate, paused gate) into a proper dialog with working
 * choices instead of a raw CLI-text alert.
 */
import { create } from 'zustand';

export type RecoveryKind = 'resumable' | 'troubled' | 'paused';

export interface RecoveryRequest {
  kind: RecoveryKind;
  agentId: string;
  issueId?: string;
  /** Server-provided context (e.g. "3 failures" / the pause reason). */
  detail?: string;
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
 * Inspect a failed action response's parsed body for a recoverable 409:
 * - resumable session (lifecycle.canResumeSession) → Resume / Start fresh
 * - troubled gate (troubled: true) → Clear gate & start
 * - paused gate (paused: true) → Unpause & start
 * Returns null for everything else (plain errors stay plain alerts).
 */
export function recoveryFromBody(body: unknown): RecoveryRequest | null {
  if (!body || typeof body !== 'object') return null;

  const lifecycle = (body as { lifecycle?: { agentId?: string; canResumeSession?: boolean } }).lifecycle;
  if (lifecycle?.canResumeSession === true && typeof lifecycle.agentId === 'string') {
    return { kind: 'resumable', agentId: lifecycle.agentId };
  }

  const gate = body as { troubled?: boolean; paused?: boolean; agentId?: string; error?: string; hint?: string };
  if (typeof gate.agentId !== 'string') return null;
  if (gate.troubled === true) {
    const match = /\((\d+ failures?)\)/.exec(gate.error ?? '');
    return { kind: 'troubled', agentId: gate.agentId, detail: match?.[1] };
  }
  if (gate.paused === true) {
    const match = /is paused \(([^)]+)\)/.exec(gate.error ?? '');
    return { kind: 'paused', agentId: gate.agentId, detail: match?.[1] };
  }
  return null;
}
