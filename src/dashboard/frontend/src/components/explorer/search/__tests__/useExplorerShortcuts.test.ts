import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { isContentSearchKey, isQuickOpenKey, useExplorerShortcuts } from '../useExplorerShortcuts'
import { installShortcutListener, resetShortcutsForTests } from '../../../../lib/shortcuts/registry'

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
})

describe('shortcut predicates', () => {
  it('isQuickOpenKey matches Ctrl+P and Meta+P, not Ctrl+Shift+P', () => {
    expect(isQuickOpenKey(key('p', { ctrlKey: true }))).toBe(true)
    expect(isQuickOpenKey(key('p', { metaKey: true }))).toBe(true)
    expect(isQuickOpenKey(key('P', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isQuickOpenKey(key('p'))).toBe(false)
  })

  it('isContentSearchKey matches Ctrl+Shift+F and Meta+Shift+F', () => {
    expect(isContentSearchKey(key('F', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isContentSearchKey(key('f', { metaKey: true, shiftKey: true }))).toBe(true)
    expect(isContentSearchKey(key('f', { ctrlKey: true }))).toBe(false)
  })
})

describe('useExplorerShortcuts (registry, PAN-5287)', () => {
  let root: HTMLDivElement
  let outside: HTMLInputElement

  beforeEach(() => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
    installShortcutListener()
    root = document.createElement('div')
    root.appendChild(document.createElement('button'))
    outside = document.createElement('input')
    document.body.append(root, outside)
  })

  afterEach(() => {
    resetShortcutsForTests()
    root.remove()
    outside.remove()
    vi.restoreAllMocks()
  })

  function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(e)
    return e
  }

  it('runs the matching handler while focus is inside the root, and stops the browser default', () => {
    const onQuickOpen = vi.fn()
    const onContentSearch = vi.fn()
    renderHook(() => useExplorerShortcuts({ rootRef: { current: root }, onQuickOpen, onContentSearch }))
    const button = root.querySelector('button') as HTMLButtonElement
    button.focus()
    const p = press(button, { key: 'p', ctrlKey: true })
    expect(onQuickOpen).toHaveBeenCalledTimes(1)
    expect(p.defaultPrevented).toBe(true)
    press(button, { key: 'F', ctrlKey: true, shiftKey: true })
    expect(onContentSearch).toHaveBeenCalledTimes(1)
  })

  it('leaves the keys untouched while focus is outside the root', () => {
    const onQuickOpen = vi.fn()
    const onContentSearch = vi.fn()
    renderHook(() => useExplorerShortcuts({ rootRef: { current: root }, onQuickOpen, onContentSearch }))
    outside.focus()
    const p = press(outside, { key: 'p', ctrlKey: true })
    expect(onQuickOpen).not.toHaveBeenCalled()
    expect(p.defaultPrevented).toBe(false)
  })

  it('follows the platform modifier: Meta+P does nothing on Linux', () => {
    const onQuickOpen = vi.fn()
    renderHook(() => useExplorerShortcuts({ rootRef: { current: root }, onQuickOpen, onContentSearch: vi.fn() }))
    const button = root.querySelector('button') as HTMLButtonElement
    button.focus()
    press(button, { key: 'p', metaKey: true })
    expect(onQuickOpen).not.toHaveBeenCalled()
  })
})
