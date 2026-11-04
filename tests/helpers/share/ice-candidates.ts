/**
 * Reads ICE candidate types out of signaling (PRD PAN-4482 WI-5). The forced-relay checkpoint proves
 * relay-only connectivity from the candidates both sides signaled, never from werift's stats (D-7).
 */
import type { SignalData } from '@overdeck/contracts';

export interface SignaledCandidate {
  readonly type: string;
  readonly source: 'candidate' | 'sdp';
}

/** `type` is the token after ` typ `; `unknown` when there is none. */
export function candidateType(candidateLine: string): string {
  return / typ (\S+)/.exec(candidateLine)?.[1] ?? 'unknown';
}

/** Every candidate in the signals: `data.candidate.candidate`, and each `a=candidate:` line of `data.sdp.sdp`. */
export function signaledCandidates(signals: readonly SignalData[]): SignaledCandidate[] {
  const found: SignaledCandidate[] = [];
  for (const signal of signals) {
    for (const line of signal.sdp?.sdp.split(/\r?\n/) ?? []) {
      if (line.startsWith('a=candidate:')) found.push({ type: candidateType(line), source: 'sdp' });
    }
    const candidate = signal.candidate?.candidate;
    if (candidate) found.push({ type: candidateType(candidate), source: 'candidate' });
  }
  return found;
}
