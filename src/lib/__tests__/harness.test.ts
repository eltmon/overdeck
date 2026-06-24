import { describe, expect, it } from 'vitest'
import { getHarness } from '@overdeck/contracts'

describe('getHarness', () => {
  it('returns claude-code when runtime is the canonical literal', () => {
    expect(getHarness({ runtime: 'claude-code' })).toBe('claude-code')
  })

  it('normalizes legacy pi to ohmypi (PAN-1989)', () => {
    expect(getHarness({ runtime: 'pi' })).toBe('ohmypi')
  })

  it('returns ohmypi when runtime is ohmypi', () => {
    expect(getHarness({ runtime: 'ohmypi' })).toBe('ohmypi')
  })

  it('returns codex when runtime is the canonical literal', () => {
    expect(getHarness({ runtime: 'codex' })).toBe('codex')
  })

  it('falls back to claude-code for the legacy "claude" wire value', () => {
    expect(getHarness({ runtime: 'claude' })).toBe('claude-code')
  })

  it('falls back to claude-code for unknown runtime values', () => {
    expect(getHarness({ runtime: 'cursor' })).toBe('claude-code')
    expect(getHarness({ runtime: 'gemini' })).toBe('claude-code')
    expect(getHarness({ runtime: '' })).toBe('claude-code')
  })

  it('falls back to claude-code when runtime is missing', () => {
    expect(getHarness({})).toBe('claude-code')
    expect(getHarness({ runtime: undefined })).toBe('claude-code')
  })

  it('falls back to claude-code for null/undefined snapshots', () => {
    expect(getHarness(null)).toBe('claude-code')
    expect(getHarness(undefined)).toBe('claude-code')
  })
})
