import { createContext, useContext } from 'react'

/**
 * StageDeckContext — lets components nested arbitrarily deep inside a Stage
 * pane (AgentPane → ConversationPanel → ChatMarkdown → MarkdownFileLink, PAN-3260)
 * open or focus an editor tab in their deck, without prop-threading `StageApi`/
 * `StageContext` (which are only handed to pane wrappers, not their descendants).
 *
 * `null` outside a Stage (e.g. popout conversation windows, ConversationDock,
 * issue-drawer transcripts) — consumers must treat that as "no deck available"
 * and fall back to their existing non-deck behavior.
 */
export interface StageDeckContextValue {
  /** The deck's pane-store key (the project key). */
  deckKey: string
  /** Open (or focus, if already open) an internal markdown editor tab for `filePath`. */
  openOrFocusEditorPane: (filePath: string, label: string) => void
}

const StageDeckContext = createContext<StageDeckContextValue | null>(null)

export const StageDeckProvider = StageDeckContext.Provider

/** Returns the enclosing Stage deck's context, or null when rendered outside a Stage. */
export function useStageDeck(): StageDeckContextValue | null {
  return useContext(StageDeckContext)
}
