import { isContextOverflowTail } from '../context-overflow.js';

export const COMPACTION_CONTINUE_MIN_SETTLE_MS = 30_000;

export const ORCHESTRATED_COMPACTION_CONTINUE_MESSAGE =
  'Compaction complete. Continue from the compacted summary now. ' +
  'Re-read your current xBRIEF item and latest feedback file if needed, then resume work; do not wait for further input.';

interface PendingCompactionContinuation {
  requestedAt: number;
  observedBusy: boolean;
}

export const orchestratedCompactionContinuations = new Map<string, PendingCompactionContinuation>();

export function scheduleOrchestratedCompactionContinuation(
  sessionName: string,
  requestedAt = Date.now(),
): void {
  orchestratedCompactionContinuations.set(sessionName, {
    requestedAt,
    observedBusy: false,
  });
}

export function cancelOrchestratedCompactionContinuation(sessionName: string): void {
  orchestratedCompactionContinuations.delete(sessionName);
}

export function hasOrchestratedCompactionContinuation(sessionName: string): boolean {
  return orchestratedCompactionContinuations.has(sessionName);
}

export async function deliverOrchestratedCompact(
  sessionName: string,
  deliver: () => Promise<void>,
): Promise<void> {
  scheduleOrchestratedCompactionContinuation(sessionName);
  try {
    await deliver();
  } catch (error) {
    cancelOrchestratedCompactionContinuation(sessionName);
    throw error;
  }
}

export async function maybeContinueOrchestratedCompaction(args: {
  sessionName: string;
  tmuxOutput: string;
  now?: number;
  send: (sessionName: string, message: string) => Promise<void>;
}): Promise<boolean> {
  const pending = orchestratedCompactionContinuations.get(args.sessionName);
  if (!pending) return false;

  const hasPrompt = args.tmuxOutput.includes('❯');
  if (!hasPrompt) {
    pending.observedBusy = true;
    return false;
  }
  if (isContextOverflowTail(args.tmuxOutput)) return false;

  const now = args.now ?? Date.now();
  if (!pending.observedBusy && (now - pending.requestedAt) < COMPACTION_CONTINUE_MIN_SETTLE_MS) {
    return false;
  }

  await args.send(args.sessionName, ORCHESTRATED_COMPACTION_CONTINUE_MESSAGE);
  orchestratedCompactionContinuations.delete(args.sessionName);
  return true;
}
