import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentPlatform, formatSpec, matchesSpec } from '../keys'

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('currentPlatform', () => {
  it('reads navigator.platform on every call', () => {
    const spy = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    expect(currentPlatform()).toBe('mac')
    spy.mockReturnValue('Linux x86_64')
    expect(currentPlatform()).toBe('other')
    spy.mockReturnValue('Win32')
    expect(currentPlatform()).toBe('other')
  })
})

describe('matchesSpec', () => {
  it('requires every named modifier and rejects every other one', () => {
    expect(matchesSpec(key({ key: 'k', metaKey: true }), 'Meta+K')).toBe(true)
    expect(matchesSpec(key({ key: 'k', ctrlKey: true }), 'Meta+K')).toBe(false)
    expect(matchesSpec(key({ key: 'k', metaKey: true, shiftKey: true }), 'Meta+K')).toBe(false)
    expect(matchesSpec(key({ key: '1', ctrlKey: true, altKey: true }), 'Ctrl+Alt+1')).toBe(true)
    expect(matchesSpec(key({ key: '1', ctrlKey: true }), 'Ctrl+Alt+1')).toBe(false)
    expect(matchesSpec(key({ key: 'n' }), 'N')).toBe(true)
    expect(matchesSpec(key({ key: 'n', ctrlKey: true }), 'N')).toBe(false)
    expect(matchesSpec(key({ key: 'N', shiftKey: true }), 'N')).toBe(false)
  })

  it('ignores Shift for characters that need it on a US layout', () => {
    expect(matchesSpec(key({ key: '?', shiftKey: true }), '?')).toBe(true)
    expect(matchesSpec(key({ key: '?' }), '?')).toBe(true)
    expect(matchesSpec(key({ key: '?', ctrlKey: true, shiftKey: true }), '?')).toBe(false)
  })

  it('matches a letter by key, case-insensitively, or by code (Alt changes key on macOS)', () => {
    expect(matchesSpec(key({ key: 'K', metaKey: true }), 'Meta+K')).toBe(true)
    expect(matchesSpec(key({ key: '∑', code: 'KeyW', ctrlKey: true, altKey: true }), 'Ctrl+Alt+W')).toBe(true)
    expect(matchesSpec(key({ key: 'x', code: 'KeyX', ctrlKey: true, altKey: true }), 'Ctrl+Alt+W')).toBe(false)
  })

  it('matches a digit by key or by code', () => {
    expect(matchesSpec(key({ key: '3', metaKey: true }), 'Meta+3')).toBe(true)
    expect(matchesSpec(key({ key: '£', code: 'Digit3', ctrlKey: true, altKey: true }), 'Ctrl+Alt+3')).toBe(true)
    expect(matchesSpec(key({ key: '4', code: 'Digit4', metaKey: true }), 'Meta+3')).toBe(false)
  })

  it('matches . by code Period or by key . or >', () => {
    expect(matchesSpec(key({ key: '>', code: 'Period', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+.')).toBe(true)
    expect(matchesSpec(key({ key: '.', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+.')).toBe(true)
    expect(matchesSpec(key({ key: '>', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+.')).toBe(true)
    expect(matchesSpec(key({ key: '.', ctrlKey: true }), 'Ctrl+Shift+.')).toBe(false)
  })

  it('compares any other key exactly', () => {
    expect(matchesSpec(key({ key: '/' }), '/')).toBe(true)
    expect(matchesSpec(key({ key: '[' }), '[')).toBe(true)
    expect(matchesSpec(key({ key: ']' }), '[')).toBe(false)
  })
})

describe('formatSpec', () => {
  it('prints mac symbols with no separators', () => {
    expect(formatSpec('Meta+Shift+.', 'mac')).toBe('⌘⇧.')
    expect(formatSpec('Meta+K', 'mac')).toBe('⌘K')
    expect(formatSpec('Ctrl+Alt+W', 'mac')).toBe('⌃⌥W')
  })

  it('prints words joined by spaces elsewhere', () => {
    expect(formatSpec('Ctrl+Shift+.', 'other')).toBe('Ctrl Shift .')
    expect(formatSpec('Ctrl+Alt+1', 'other')).toBe('Ctrl Alt 1')
    expect(formatSpec('n', 'other')).toBe('N')
  })

  it('prints a chord as "G then P"', () => {
    expect(formatSpec('G P', 'mac')).toBe('G then P')
    expect(formatSpec('G P', 'other')).toBe('G then P')
  })
})
