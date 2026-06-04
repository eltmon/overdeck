import type { LauncherIntent } from './Launcher'
import { isUrlLike } from './launcherOrdering'

/**
 * Concrete action handlers a launcher consumer supplies. The Stage mount point
 * (mount-stage, per D10) wires these to the real flows: `openAgent` to the
 * existing new-conversation path + an `agent` pane, `openTerminal` to a
 * `terminal` pane, and `openWeb` to a `browser` pane (or external open).
 */
export interface LauncherHandlers {
  openAgent: (intent: LauncherIntent, query: string) => void
  openTerminal: (query: string) => void
  openWeb: (query: string, url: string) => void
  /** Record the agent the user just ran (feeds last-used ordering). */
  onAgentRun?: (agentId: string) => void
}

/** Pure dispatch from a chosen intent to its handler. Agent intents also fire
 * onAgentRun so the consumer can persist the last-used agent. */
export function dispatchLauncherIntent(
  intent: LauncherIntent,
  query: string,
  handlers: LauncherHandlers,
): void {
  switch (intent.kind) {
    case 'terminal':
      handlers.openTerminal(query)
      return
    case 'web':
      handlers.openWeb(query, webSearchUrl(query))
      return
    case 'agent':
      handlers.onAgentRun?.(intent.id)
      handlers.openAgent(intent, query)
  }
}

/** Build a navigation target for the web intent: a direct URL when the query
 * looks like one, else a web search. */
export function webSearchUrl(query: string): string {
  const q = query.trim()
  if (isUrlLike(q)) return /^https?:\/\//i.test(q) ? q : `https://${q}`
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}
