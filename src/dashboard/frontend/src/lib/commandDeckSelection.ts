/**
 * commandDeckSelection — per-issue selection slice for the unified Command Deck (PAN-830).
 *
 * Tracks which session (if any) is selected within each issue. `null` means
 * issue-selected mode (no session focused — Zone C shows the Overview tab strip).
 * The slice is a sibling Zustand store rather than part of `useDashboardStore`
 * so it doesn't entangle with the contracts-shared event reducers.
 */

import { create } from 'zustand'

export type IssueId = string
export type SessionId = string

export interface CommandDeckSelectionState {
  /** Map of issueId → selected sessionId. `null` (or absent) = issue-selected mode. */
  selectedSessionByIssue: Record<IssueId, SessionId | null>
}

export interface CommandDeckSelectionStore extends CommandDeckSelectionState {
  /** Set the selected session for an issue. Pass `null` to enter issue-selected mode. */
  selectSession(issueId: IssueId, sessionId: SessionId | null): void
  /** Remove all selection state for an issue (e.g. when the issue is closed/hidden). */
  clearIssue(issueId: IssueId): void
  /** Clear all per-issue selection state. */
  clearAll(): void
}

const initialState: CommandDeckSelectionState = {
  selectedSessionByIssue: {},
}

export const useCommandDeckSelection = create<CommandDeckSelectionStore>((set) => ({
  ...initialState,

  selectSession: (issueId, sessionId) =>
    set((state) => ({
      selectedSessionByIssue: { ...state.selectedSessionByIssue, [issueId]: sessionId },
    })),

  clearIssue: (issueId) =>
    set((state) => {
      if (!(issueId in state.selectedSessionByIssue)) return state
      const { [issueId]: _removed, ...rest } = state.selectedSessionByIssue
      return { selectedSessionByIssue: rest }
    }),

  clearAll: () => set({ selectedSessionByIssue: {} }),
}))

// ─── Selectors ────────────────────────────────────────────────────────────────

/**
 * Get the selected session for `issueId`, or `null` if the issue is in
 * issue-selected mode (or has never been visited).
 */
export const selectSelectedSessionForIssue =
  (issueId: IssueId) =>
  (s: CommandDeckSelectionState): SessionId | null =>
    s.selectedSessionByIssue[issueId] ?? null

/**
 * `true` when the issue has no session focused (issue-selected mode). Treats
 * "absent key" the same as `null` so a freshly visited issue starts in
 * issue-selected mode unless the caller chooses otherwise.
 */
export const selectIsIssueSelected =
  (issueId: IssueId) =>
  (s: CommandDeckSelectionState): boolean =>
    (s.selectedSessionByIssue[issueId] ?? null) === null
