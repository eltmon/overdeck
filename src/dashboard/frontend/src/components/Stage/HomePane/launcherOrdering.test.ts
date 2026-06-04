import { describe, it, expect, beforeEach } from 'vitest'
import {
  orderIntents,
  isUrlLike,
  readLastUsedAgent,
  writeLastUsedAgent,
} from './launcherOrdering'
import { DEFAULT_INTENTS } from './Launcher'

const ids = (list: { id: string }[]) => list.map((i) => i.id)

describe('isUrlLike', () => {
  it('detects protocol, www, and bare domains', () => {
    expect(isUrlLike('https://example.com')).toBe(true)
    expect(isUrlLike('www.example.com')).toBe(true)
    expect(isUrlLike('example.com')).toBe(true)
    expect(isUrlLike('foo.io/bar?x=1')).toBe(true)
  })
  it('rejects plain prose and multi-word input', () => {
    expect(isUrlLike('fix the bug')).toBe(false)
    expect(isUrlLike('deploy')).toBe(false)
    expect(isUrlLike('')).toBe(false)
    expect(isUrlLike('example dot com')).toBe(false)
  })
})

describe('orderIntents', () => {
  it('keeps the default order for plain text', () => {
    expect(ids(orderIntents({ intents: DEFAULT_INTENTS, query: 'fix the bug' }))).toEqual([
      'claude-code',
      'terminal',
      'web',
      'codex',
    ])
  })

  it('floats web to position 1 for a URL-shaped query', () => {
    const out = orderIntents({ intents: DEFAULT_INTENTS, query: 'https://x.com' })
    expect(ids(out)[0]).toBe('web')
    expect(ids(out)).toEqual(['web', 'claude-code', 'terminal', 'codex'])
  })

  it('floats a last-used non-Claude agent to position 1', () => {
    const out = orderIntents({ intents: DEFAULT_INTENTS, query: 'do it', lastUsedAgentId: 'codex' })
    expect(ids(out)[0]).toBe('codex')
  })

  it('does not reorder when last-used is claude-code (already first)', () => {
    const out = orderIntents({
      intents: DEFAULT_INTENTS,
      query: 'do it',
      lastUsedAgentId: 'claude-code',
    })
    expect(ids(out)).toEqual(['claude-code', 'terminal', 'web', 'codex'])
  })

  it('URL detection takes precedence over last-used agent', () => {
    const out = orderIntents({
      intents: DEFAULT_INTENTS,
      query: 'github.com',
      lastUsedAgentId: 'codex',
    })
    expect(ids(out)[0]).toBe('web')
  })
})

describe('last-used-agent persistence', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips per workspace and degrades to null when absent', () => {
    expect(readLastUsedAgent('PAN-1549')).toBeNull()
    writeLastUsedAgent('PAN-1549', 'codex')
    expect(readLastUsedAgent('PAN-1549')).toBe('codex')
    expect(readLastUsedAgent('OTHER-1')).toBeNull()
  })
})
