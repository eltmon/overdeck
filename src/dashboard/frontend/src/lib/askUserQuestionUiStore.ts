/**
 * askUserQuestionUiStore — a sibling Zustand store (like `panesStore` and
 * `commandDeckSelection`) that carries a one-shot "re-open this AskUserQuestion"
 * signal from anywhere in the UI back to App.tsx, which owns the
 * AskUserQuestion dialog and the dismissed-subject state.
 *
 * Why this exists: when the operator presses ESC on the AskUserQuestion dialog
 * the subject is added to App's `dismissedAskUserQuestionAgentIds` and is only
 * re-allowed when the underlying AUQ clears server-side — so a still-pending
 * question becomes unreachable. The Activity Feed / Project Activity "Needs
 * you" entries call `requestReopen(subjectId)`; App watches `reopenNonce` and,
 * when it changes, un-dismisses + focuses `reopenId` so the dialog re-opens.
 *
 * Kept out of the event-sourced `lib/store.ts` so this transient UI signal
 * never entangles with the contracts-shared event reducers.
 */
import { create } from 'zustand'

interface AskUserQuestionUiState {
  /** Subject id (agent id / conversation name) the operator asked to re-open. */
  reopenId: string | null
  /** Bumped on every requestReopen so App's effect fires even for the same id. */
  reopenNonce: number
  requestReopen: (subjectId: string) => void
}

export const useAskUserQuestionUiStore = create<AskUserQuestionUiState>((set) => ({
  reopenId: null,
  reopenNonce: 0,
  requestReopen: (subjectId) =>
    set((s) => ({ reopenId: subjectId, reopenNonce: s.reopenNonce + 1 })),
}))
