/**
 * Live code editors by draft key, so a root switch keeps the cursor, scroll
 * and focus (PAN-5290 C-D12).
 *
 * A root switch (`switchRoot`, `leaveEditWorkspace`) remounts every code pane
 * on the new root, because CodePaneSlot keys the pane by root and path. Before
 * the panes are retargeted, `carryViewStates` saves the view state and focus
 * of every live editor on the old root under the same path on the new root;
 * the remounted pane takes it with `takeViewState` and restores it.
 */
import { draftKey } from './code-drafts'
import type { CodeEditorInstance } from './MonacoCodeEditor'

type ViewEditor = Pick<CodeEditorInstance, 'saveViewState' | 'restoreViewState' | 'hasTextFocus' | 'focus'>

const live = new Map<string, ViewEditor[]>()
const carried = new Map<string, { viewState: unknown; focused: boolean }>()

/** Registers a mounted editor under its draft key; returns the unregister function. */
export function registerCodeEditor(key: string, editor: ViewEditor): () => void {
  live.set(key, [...(live.get(key) ?? []), editor])
  return () => {
    const rest = (live.get(key) ?? []).filter((e) => e !== editor)
    if (rest.length > 0) live.set(key, rest)
    else live.delete(key)
  }
}

/** Saves every live editor on fromRootId under the same path on toRootId. */
export function carryViewStates(fromRootId: string, toRootId: string): void {
  const prefix = draftKey(fromRootId, '')
  for (const [key, editors] of live) {
    if (!key.startsWith(prefix)) continue
    // Two panes on one file: the focused one wins, else the latest.
    const editor = editors.find((e) => e.hasTextFocus()) ?? editors[editors.length - 1]
    if (!editor) continue
    carried.set(draftKey(toRootId, key.slice(prefix.length)), { viewState: editor.saveViewState(), focused: editor.hasTextFocus() })
  }
}

/** Returns and forgets the carried state for key. */
export function takeViewState(key: string): { viewState: unknown; focused: boolean } | null {
  const state = carried.get(key) ?? null
  carried.delete(key)
  return state
}

export function resetViewStateRegistryForTests(): void {
  live.clear()
  carried.clear()
}
