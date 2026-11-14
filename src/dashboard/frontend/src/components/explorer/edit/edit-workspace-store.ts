/**
 * Edit-workspace client state (PAN-5191, WI-F9). Not persisted.
 *
 *   - `creating[projectKey]`: a beginEdit call is in flight for the project;
 *     the explorer and code panes show "Creating edit workspace…".
 *   - `active[projectKey]`: the edit root this session last switched the
 *     project to.
 *   - `pending[draftKey]`: a root switch moved a dirty draft here; the code
 *     pane for that key saves it once. It is store state, so a pane that is
 *     already mounted sees the key appear, a pane that mounts later sees it
 *     on mount, and a draft with no pane keeps the mark until one opens.
 */
import { create } from 'zustand'

export interface EditWorkspaceState {
  creating: Record<string, boolean>
  active: Record<string, string>
  pending: Record<string, true>
  setCreating(projectKey: string, on: boolean): void
  setActive(projectKey: string, rootId: string | null): void
  markPendingSave(draftKey: string): void
  /** Removes the mark and returns whether it was there. */
  consumePendingSave(draftKey: string): boolean
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}

export const useEditWorkspaceStore = create<EditWorkspaceState>((set, get) => ({
  creating: {},
  active: {},
  pending: {},
  setCreating: (projectKey, on) =>
    set((s) => (on ? { creating: { ...s.creating, [projectKey]: true } } : { creating: without(s.creating, projectKey) })),
  setActive: (projectKey, rootId) =>
    set((s) => (rootId ? { active: { ...s.active, [projectKey]: rootId } } : { active: without(s.active, projectKey) })),
  markPendingSave: (draftKey) => set((s) => ({ pending: { ...s.pending, [draftKey]: true } })),
  consumePendingSave: (draftKey) => {
    if (!get().pending[draftKey]) return false
    set((s) => ({ pending: without(s.pending, draftKey) }))
    return true
  },
}))
