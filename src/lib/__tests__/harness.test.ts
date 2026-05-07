import { describe, expect, it } from 'vitest'
import { getHarness } from '@panctl/contracts'

describe('getHarness', () => {
  it('returns claude-code when runtime is the canonical literal', () => {
    expect(getHarness({ runtime: 'claude-code' })).toBe('claude-code')
  })

  it('returns pi when runtime is the canonical literal', () => {
    expect(getHarness({ runtime: 'pi' })).toBe('pi')
  })

  it('falls back to claude-code for the legacy "claude" wire value', () => {
    expect(getHarness({ runtime: 'claude' })).toBe('claude-code')
  })

  it('falls back to claude-code for unknown runtime values', () => {
    expect(getHarness({ runtime: 'codex' })).toBe('claude-code')
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
