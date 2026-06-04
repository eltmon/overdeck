import type { LauncherIntent } from './Launcher'

/** Heuristic URL/domain detector for the launcher input. */
export function isUrlLike(query: string): boolean {
  const q = query.trim()
  if (!q || /\s/.test(q)) return false
  if (/^(https?:\/\/|www\.)/i.test(q)) return true
  // bare domain with a TLD, optionally with a path/query: example.com, foo.io/bar
  return /^[^\s/]+\.[a-z]{2,}([/?#].*)?$/i.test(q)
}

function floatToFront(
  intents: LauncherIntent[],
  predicate: (i: LauncherIntent) => boolean,
): LauncherIntent[] {
  const index = intents.findIndex(predicate)
  if (index <= 0) return intents // not found, or already first
  const copy = intents.slice()
  const [picked] = copy.splice(index, 1)
  copy.unshift(picked)
  return copy
}

export interface OrderIntentsInput {
  intents: LauncherIntent[]
  query: string
  /** Id of the agent the user last ran in this workspace (for "repeat last"). */
  lastUsedAgentId?: string | null
}

/**
 * Pure intent ordering (PAN-1549). Default order is the supplied list. A
 * URL-shaped query floats the `web` intent to position 1. Otherwise, a
 * last-used non-Claude agent floats to position 1 so ⌘↵ repeats it.
 */
export function orderIntents({ intents, query, lastUsedAgentId }: OrderIntentsInput): LauncherIntent[] {
  if (isUrlLike(query)) {
    return floatToFront(intents, (i) => i.kind === 'web')
  }
  if (lastUsedAgentId && lastUsedAgentId !== 'claude-code') {
    return floatToFront(intents, (i) => i.kind === 'agent' && i.id === lastUsedAgentId)
  }
  return intents
}

// ─── last-used-agent persistence (per workspace) ────────────────────────────────

const lastAgentKey = (workspaceId: string): string => `pan-launcher-agent:${workspaceId}`

export function readLastUsedAgent(workspaceId: string): string | null {
  try {
    return localStorage.getItem(lastAgentKey(workspaceId))
  } catch {
    return null
  }
}

export function writeLastUsedAgent(workspaceId: string, agentId: string): void {
  try {
    localStorage.setItem(lastAgentKey(workspaceId), agentId)
  } catch {
    /* ignore — best-effort */
  }
}
