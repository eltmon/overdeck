import { describe, expect, it } from 'vitest'

import {
  EXPLORER_MOVE_MIME,
  EXPLORER_PATHS_MIME,
  hasDragPaths,
  hasExplorerMove,
  readDragPaths,
  readExplorerMove,
  setExplorerDragData,
} from '../explorer-drag-paths'

function fakeDataTransfer(initial: Record<string, string> = {}): DataTransfer {
  const data = new Map(Object.entries(initial))
  return {
    effectAllowed: 'uninitialized',
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return [...data.keys()]
    },
  } as unknown as DataTransfer
}

describe('explorer drag payload', () => {
  it('round-trips both types and allows copy and move', () => {
    const dt = fakeDataTransfer()
    setExplorerDragData(dt, 'issue:X', ['a', 'b/c'])
    expect(readDragPaths(dt)).toEqual(['a', 'b/c'])
    expect(readExplorerMove(dt)).toEqual({ rootId: 'issue:X', paths: ['a', 'b/c'] })
    expect(dt.effectAllowed).toBe('copyMove')
    expect(dt.types).not.toContain('text/plain')
    expect(hasDragPaths(dt.types)).toBe(true)
    expect(hasExplorerMove(dt.types)).toBe(true)
  })

  it('drops empty lines and returns null when no paths are present', () => {
    expect(readDragPaths(fakeDataTransfer({ [EXPLORER_PATHS_MIME]: 'a\n\nb\n' }))).toEqual(['a', 'b'])
    expect(readDragPaths(fakeDataTransfer())).toBeNull()
  })

  it.each([
    ['malformed JSON', '{rootId:'],
    ['a non-object', '"x"'],
    ['a missing rootId', JSON.stringify({ paths: ['a'] })],
    ['a non-array paths', JSON.stringify({ rootId: 'issue:X', paths: 'a' })],
    ['a non-string path', JSON.stringify({ rootId: 'issue:X', paths: ['a', 2] })],
  ])('readExplorerMove returns null for %s', (_label, raw) => {
    expect(readExplorerMove(fakeDataTransfer({ [EXPLORER_MOVE_MIME]: raw }))).toBeNull()
  })

  it('returns null for a missing move payload', () => {
    expect(readExplorerMove(fakeDataTransfer())).toBeNull()
  })

  it('checks the lowercase type list', () => {
    expect(hasDragPaths(['Files', 'application/x-overdeck-paths'])).toBe(true)
    expect(hasDragPaths(['Files'])).toBe(false)
    expect(hasExplorerMove(['application/x-overdeck-explorer'])).toBe(true)
    expect(hasExplorerMove(['application/json'])).toBe(false)
  })
})
