import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { KeyboardEvent } from 'react'

import { useTreeActionKeys, type TreeActionKeyOptions } from '../useTreeActionKeys'

const tree = document.createElement('div')
const input = document.createElement('input')

function key(init: Partial<KeyboardEvent<HTMLElement>> & { key: string }, target: EventTarget = tree) {
  const preventDefault = vi.fn()
  const event = {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target,
    currentTarget: tree,
    preventDefault,
    ...init,
  } as unknown as KeyboardEvent<HTMLElement>
  return { event, preventDefault }
}

function setup(over: Partial<TreeActionKeyOptions> = {}) {
  const options: TreeActionKeyOptions = {
    writable: true,
    isProjectRoot: false,
    getSelection: () => ['src/a.ts'],
    startRename: vi.fn(),
    requestDelete: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...over,
  }
  const { result } = renderHook(() => useTreeActionKeys(options))
  return { options, onKeyDown: result.current }
}

describe('useTreeActionKeys', () => {
  it('F2 renames the single selected path', () => {
    const { options, onKeyDown } = setup()
    const { event, preventDefault } = key({ key: 'F2' })
    onKeyDown(event)
    expect(options.startRename).toHaveBeenCalledWith('src/a.ts')
    expect(preventDefault).toHaveBeenCalled()
  })

  it('F2 does nothing with two selected paths', () => {
    const { options, onKeyDown } = setup({ getSelection: () => ['a', 'b'] })
    onKeyDown(key({ key: 'F2' }).event)
    expect(options.startRename).not.toHaveBeenCalled()
  })

  it('Delete and Meta+Backspace delete the selection', () => {
    const { options, onKeyDown } = setup({ getSelection: () => ['a', 'b'] })
    const del = key({ key: 'Delete' })
    onKeyDown(del.event)
    onKeyDown(key({ key: 'Backspace', metaKey: true }).event)
    expect(options.requestDelete).toHaveBeenCalledTimes(2)
    expect(options.requestDelete).toHaveBeenCalledWith(['a', 'b'])
    expect(del.preventDefault).toHaveBeenCalled()
  })

  it('plain Backspace does not delete', () => {
    const { options, onKeyDown } = setup()
    onKeyDown(key({ key: 'Backspace' }).event)
    expect(options.requestDelete).not.toHaveBeenCalled()
  })

  it('F2 and Delete do nothing when the tree is not writable', () => {
    const { options, onKeyDown } = setup({ writable: false })
    const f2 = key({ key: 'F2' })
    onKeyDown(f2.event)
    onKeyDown(key({ key: 'Delete' }).event)
    expect(options.startRename).not.toHaveBeenCalled()
    expect(options.requestDelete).not.toHaveBeenCalled()
    expect(f2.preventDefault).not.toHaveBeenCalled()
  })

  it('Ctrl+Z undoes and Ctrl+Shift+Z redoes, Meta too, with any letter case', () => {
    const { options, onKeyDown } = setup({ writable: false })
    const undo = key({ key: 'z', ctrlKey: true })
    onKeyDown(undo.event)
    onKeyDown(key({ key: 'Z', ctrlKey: true, shiftKey: true }).event)
    onKeyDown(key({ key: 'z', metaKey: true }).event)
    expect(options.undo).toHaveBeenCalledTimes(2)
    expect(options.redo).toHaveBeenCalledTimes(1)
    expect(undo.preventDefault).toHaveBeenCalled()
  })

  it('undo and redo do nothing on a project root', () => {
    const { options, onKeyDown } = setup({ isProjectRoot: true, writable: false })
    const undo = key({ key: 'z', ctrlKey: true })
    onKeyDown(undo.event)
    onKeyDown(key({ key: 'z', ctrlKey: true, shiftKey: true }).event)
    expect(options.undo).not.toHaveBeenCalled()
    expect(options.redo).not.toHaveBeenCalled()
    expect(undo.preventDefault).not.toHaveBeenCalled()
  })

  it('ignores a key from a child element and an already-handled key', () => {
    const { options, onKeyDown } = setup()
    onKeyDown(key({ key: 'F2' }, input).event)
    onKeyDown(key({ key: 'Delete' }, input).event)
    onKeyDown(key({ key: 'z', ctrlKey: true, defaultPrevented: true }).event)
    expect(options.startRename).not.toHaveBeenCalled()
    expect(options.requestDelete).not.toHaveBeenCalled()
    expect(options.undo).not.toHaveBeenCalled()
  })
})
