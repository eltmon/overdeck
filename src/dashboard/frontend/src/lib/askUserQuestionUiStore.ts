/**
 * askUserQuestionUiStore — a sibling Zustand store (like `panesStore` and
 * `commandDeckSelection`) that carries transient AskUserQuestion UI state that
 * must be shared between App.tsx (which owns the dialog) and the "Needs you"
 * list in the Activity Feed / Project Activity sidebar.
 *
 * Three concerns live here:
 *
 *  1. A one-shot "re-open this AskUserQuestion" signal (`reopenId`/`reopenNonce`)
 *     from anywhere in the UI back to App.tsx. When the operator presses ESC on
 *     the dialog the subject is dismissed and only re-allowed when the AUQ clears
 *     server-side — so a still-pending question becomes unreachable. The "Needs
 *     you" entries call `requestReopen(subjectId)`; App watches `reopenNonce`
 *     and, when it changes, un-dismisses + focuses `reopenId`.
 *
 *  2. `answeredToolUseIds` — AUQs the operator has optimistically answered. The
 *     dialog hides immediately (before the next enrichment poll clears the
 *     field). Previously this lived in App-local state, so the "Needs you"
 *     sidebar card lingered after answering; sharing it here lets the sidebar
 *     drop the card the moment it's answered. (PAN-1563)
 *
 *  3. `dismissedSubjectIds` — subjects ESC-dismissed without answering. Shared
 *     for the same reason as (2). (PAN-1563)
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

  /** toolUseIds the operator optimistically answered — hide until server clears. */
  answeredToolUseIds: Set<string>
  /** subject ids (agent id / conv name) dismissed without answering. */
  dismissedSubjectIds: Set<string>

  markAnswered: (toolUseId: string) => void
  unmarkAnswered: (toolUseId: string) => void
  markDismissed: (subjectId: string) => void
  undismiss: (subjectId: string) => void
  /** Drop answered ids no longer live server-side (called from App's reconcile). */
  reconcileAnswered: (liveToolUseIds: Set<string>) => void
  /** Drop dismissed ids no longer live server-side (called from App's reconcile). */
  reconcileDismissed: (liveSubjectIds: Set<string>) => void
}

function withAdded(prev: Set<string>, id: string): Set<string> {
  if (prev.has(id)) return prev
  const next = new Set(prev)
  next.add(id)
  return next
}

function withRemoved(prev: Set<string>, id: string): Set<string> {
  if (!prev.has(id)) return prev
  const next = new Set(prev)
  next.delete(id)
  return next
}

function withIntersection(prev: Set<string>, live: Set<string>): Set<string> {
  let changed = false
  const next = new Set<string>()
  for (const id of prev) {
    if (live.has(id)) next.add(id)
    else changed = true
  }
  return changed ? next : prev
}

export const useAskUserQuestionUiStore = create<AskUserQuestionUiState>((set) => ({
  reopenId: null,
  reopenNonce: 0,
  requestReopen: (subjectId) =>
    set((s) => ({ reopenId: subjectId, reopenNonce: s.reopenNonce + 1 })),

  answeredToolUseIds: new Set<string>(),
  dismissedSubjectIds: new Set<string>(),

  markAnswered: (toolUseId) =>
    set((s) => ({ answeredToolUseIds: withAdded(s.answeredToolUseIds, toolUseId) })),
  unmarkAnswered: (toolUseId) =>
    set((s) => ({ answeredToolUseIds: withRemoved(s.answeredToolUseIds, toolUseId) })),
  markDismissed: (subjectId) =>
    set((s) => ({ dismissedSubjectIds: withAdded(s.dismissedSubjectIds, subjectId) })),
  undismiss: (subjectId) =>
    set((s) => ({ dismissedSubjectIds: withRemoved(s.dismissedSubjectIds, subjectId) })),
  reconcileAnswered: (liveToolUseIds) =>
    set((s) => ({ answeredToolUseIds: withIntersection(s.answeredToolUseIds, liveToolUseIds) })),
  reconcileDismissed: (liveSubjectIds) =>
    set((s) => ({ dismissedSubjectIds: withIntersection(s.dismissedSubjectIds, liveSubjectIds) })),
}))
