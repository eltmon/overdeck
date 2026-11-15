import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { isContentSearchKey, isQuickOpenKey, useExplorerShortcuts } from '../useExplorerShortcuts'
import { installShortcutListener, resetShortcutsForTests, useShortcutList } from '../../../../lib/shortcuts/registry'

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

describe('useExplorerShortcuts (global dock shortcuts, PAN-5289)', () => {
  let uninstall: () => void
  let textarea: HTMLTextAreaElement
  let monacoHost: HTMLDivElement

  beforeEach(() => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
    uninstall = installShortcutListener()
    textarea = document.createElement('textarea')
    monacoHost = document.createElement('div')
    monacoHost.className = 'monaco-editor'
    const inner = document.createElement('textarea')
    monacoHost.appendChild(inner)
    document.body.append(textarea, monacoHost)
  })

  afterEach(() => {
    uninstall()
    resetShortcutsForTests()
    textarea.remove()
    monacoHost.remove()
    vi.restoreAllMocks()
  })

  function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(e)
    return e
  }

  function handlers() {
    return { onFiles: vi.fn(), onChanges: vi.fn(), onSearch: vi.fn(), onQuickOpen: vi.fn() }
  }

  it('runs each handler once from a textarea and stops the browser default', () => {
    const h = handlers()
    renderHook(() => useExplorerShortcuts(h))
    textarea.focus()
    const events = [
      press(textarea, { key: 'E', ctrlKey: true, shiftKey: true }),
      press(textarea, { key: 'G', ctrlKey: true, shiftKey: true }),
      press(textarea, { key: 'F', ctrlKey: true, shiftKey: true }),
      press(textarea, { key: 'p', ctrlKey: true }),
    ]
    expect(h.onFiles).toHaveBeenCalledTimes(1)
    expect(h.onChanges).toHaveBeenCalledTimes(1)
    expect(h.onSearch).toHaveBeenCalledTimes(1)
    expect(h.onQuickOpen).toHaveBeenCalledTimes(1)
    for (const e of events) expect(e.defaultPrevented).toBe(true)
  })

  it('runs Go to file with focus inside Monaco and on the body', () => {
    const h = handlers()
    renderHook(() => useExplorerShortcuts(h))
    const inner = monacoHost.querySelector('textarea') as HTMLTextAreaElement
    inner.focus()
    press(inner, { key: 'p', ctrlKey: true })
    expect(h.onQuickOpen).toHaveBeenCalledTimes(1)
    inner.blur()
    press(document.body, { key: 'p', ctrlKey: true })
    expect(h.onQuickOpen).toHaveBeenCalledTimes(2)
  })

  it('follows the platform modifier: Meta+P does nothing on Linux', () => {
    const h = handlers()
    renderHook(() => useExplorerShortcuts(h))
    const e = press(document.body, { key: 'p', metaKey: true })
    expect(h.onQuickOpen).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  it('uses the latest handlers without re-registering', () => {
    const first = handlers()
    const second = handlers()
    const { rerender, result } = renderHook(
      ({ h }) => {
        useExplorerShortcuts(h)
        return useShortcutList()
      },
      { initialProps: { h: first } },
    )
    const before = result.current
    rerender({ h: second })
    expect(result.current).toBe(before)
    press(document.body, { key: 'E', ctrlKey: true, shiftKey: true })
    expect(first.onFiles).not.toHaveBeenCalled()
    expect(second.onFiles).toHaveBeenCalledTimes(1)
  })

  it('registers nothing for null handlers', () => {
    const { result } = renderHook(() => {
      useExplorerShortcuts(null)
      return useShortcutList()
    })
    const ids = result.current.map((d) => d.id)
    for (const id of ['dock.files', 'dock.changes', 'explorer.content-search', 'explorer.quick-open']) {
      expect(ids).not.toContain(id)
    }
  })
})
