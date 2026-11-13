import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { KeyboardEvent } from 'react'
import { isContentSearchKey, isQuickOpenKey, useExplorerShortcuts } from '../useExplorerShortcuts'

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

describe('useExplorerShortcuts', () => {
  function event(k: ReturnType<typeof key>) {
    return { ...k, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent & {
      preventDefault: ReturnType<typeof vi.fn>
      stopPropagation: ReturnType<typeof vi.fn>
    }
  }

  it('calls the matching handler and stops the browser default', () => {
    const onQuickOpen = vi.fn()
    const onContentSearch = vi.fn()
    const { result } = renderHook(() => useExplorerShortcuts({ onQuickOpen, onContentSearch }))
    const p = event(key('p', { ctrlKey: true }))
    result.current(p)
    expect(onQuickOpen).toHaveBeenCalledTimes(1)
    expect(p.preventDefault).toHaveBeenCalled()
    expect(p.stopPropagation).toHaveBeenCalled()
    result.current(event(key('F', { metaKey: true, shiftKey: true })))
    expect(onContentSearch).toHaveBeenCalledTimes(1)
  })

  it('leaves other keys alone', () => {
    const onQuickOpen = vi.fn()
    const { result } = renderHook(() => useExplorerShortcuts({ onQuickOpen, onContentSearch: vi.fn() }))
    const other = event(key('k', { ctrlKey: true }))
    result.current(other)
    expect(onQuickOpen).not.toHaveBeenCalled()
    expect(other.preventDefault).not.toHaveBeenCalled()
  })
})
