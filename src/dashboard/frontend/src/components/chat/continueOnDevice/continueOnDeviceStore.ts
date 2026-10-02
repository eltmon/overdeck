import { create } from 'zustand';

/**
 * PAN-4455 D-1: the conversation the "Continue on another device" dialog is
 * open for. Both conversation menus call `openContinueOnDevice(target)`; one
 * host mounted at the app root renders the dialog, so it outlives the menu.
 */

export interface ContinueTarget {
  name: string;
  id: number;
  title: string;
  harness: string;
  sessionAlive: boolean;
  viewMode: 'conversation' | 'terminal';
}

interface ContinueOnDeviceStore {
  target: ContinueTarget | null;
  open: (target: ContinueTarget) => void;
  close: () => void;
}

export const useContinueOnDeviceStore = create<ContinueOnDeviceStore>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

export function openContinueOnDevice(target: ContinueTarget): void {
  useContinueOnDeviceStore.getState().open(target);
}

/**
 * The conversation fields a target needs. Structural, not `Conversation`, so this
 * store does not import ConversationList (which renders ConversationRow, which
 * imports this store).
 */
export interface ContinueSource {
  name: string;
  id: number;
  title?: string | null;
  harness?: string | null;
  sessionAlive: boolean;
}

export function continueTargetOf(conversation: ContinueSource, viewMode: 'conversation' | 'terminal' = 'conversation'): ContinueTarget {
  return {
    name: conversation.name,
    id: conversation.id,
    title: conversation.title ?? conversation.name,
    harness: conversation.harness ?? 'claude-code',
    sessionAlive: conversation.sessionAlive,
    viewMode,
  };
}

/** Harnesses whose transcripts the Session Vault settles (PAN-4455 D-2, FR-12). */
export const HANDOFF_HARNESSES = new Set(['claude-code', 'codex']);
