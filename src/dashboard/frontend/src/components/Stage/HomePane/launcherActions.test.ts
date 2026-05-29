import { describe, it, expect, vi } from 'vitest'
import { dispatchLauncherIntent, webSearchUrl, type LauncherHandlers } from './launcherActions'
import type { LauncherIntent } from './Launcher'

function handlers(): LauncherHandlers & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {}
  return {
    calls,
    openAgent: (i, q) => (calls.openAgent = [i, q]),
    openTerminal: (q) => (calls.openTerminal = [q]),
    openWeb: (q, url) => (calls.openWeb = [q, url]),
    onAgentRun: (id) => (calls.onAgentRun = [id]),
  }
}

describe('dispatchLauncherIntent', () => {
  it('routes terminal intents to openTerminal', () => {
    const h = handlers()
    dispatchLauncherIntent({ id: 't', kind: 'terminal' }, 'ls', h)
    expect(h.calls.openTerminal).toEqual(['ls'])
  })

  it('routes web intents to openWeb with a built URL', () => {
    const h = handlers()
    dispatchLauncherIntent({ id: 'w', kind: 'web' }, 'docs', h)
    expect(h.calls.openWeb?.[1]).toContain('google.com/search')
  })

  it('routes agent intents to openAgent and records last-used', () => {
    const h = handlers()
    const intent: LauncherIntent = { id: 'codex', kind: 'agent', agentName: 'Codex' }
    dispatchLauncherIntent(intent, 'fix it', h)
    expect(h.calls.onAgentRun).toEqual(['codex'])
    expect(h.calls.openAgent).toEqual([intent, 'fix it'])
  })

  it('does not call openAgent for non-agent intents', () => {
    const openAgent = vi.fn()
    dispatchLauncherIntent({ id: 't', kind: 'terminal' }, 'x', {
      openAgent,
      openTerminal: () => {},
      openWeb: () => {},
    })
    expect(openAgent).not.toHaveBeenCalled()
  })
})

describe('webSearchUrl', () => {
  it('builds a search URL for prose', () => {
    expect(webSearchUrl('how to foo')).toBe('https://www.google.com/search?q=how%20to%20foo')
  })
  it('passes through an explicit URL', () => {
    expect(webSearchUrl('https://example.com/x')).toBe('https://example.com/x')
  })
  it('adds https:// to a bare domain', () => {
    expect(webSearchUrl('example.com')).toBe('https://example.com')
  })
})
