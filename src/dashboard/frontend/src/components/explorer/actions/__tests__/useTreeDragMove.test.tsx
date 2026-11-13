import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))

import { EXPLORER_MOVE_MIME, EXPLORER_PATHS_MIME } from '../../../../lib/explorer-drag-paths'
import {
  FOREIGN_ROOT_MESSAGE,
  HOVER_EXPAND_MS,
  dragPathsFor,
  getDragEdgeScrollTarget,
  resolveDropDir,
  startRowDrag,
  useTreeDropZone,
  type TreeDropZoneOptions,
} from '../useTreeDragMove'

function fakeDataTransfer(initial: Record<string, string> = {}, extraTypes: string[] = []): DataTransfer {
  const data = new Map(Object.entries(initial))
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return [...data.keys(), ...extraTypes]
    },
  } as unknown as DataTransfer
}

const ROWS: Record<string, { kind: 'file' | 'dir'; expanded: boolean }> = {
  src: { kind: 'dir', expanded: false },
  lib: { kind: 'dir', expanded: false },
  'src/a.ts': { kind: 'file', expanded: false },
}

function Zone(props: { opts: TreeDropZoneOptions }) {
  const { dropDir, zoneProps } = useTreeDropZone(props.opts)
  return (
    <div data-testid="zone" data-drop-dir={dropDir ?? 'none'} {...zoneProps}>
      <div role="tree">
        {Object.keys(ROWS).map((path) => (
          <div key={path} data-path={path}>
            {path}
          </div>
        ))}
      </div>
    </div>
  )
}

function setup(over: Partial<TreeDropZoneOptions> = {}) {
  const opts: TreeDropZoneOptions = {
    rootId: 'issue:PAN-1',
    writable: true,
    changedOnly: false,
    getRow: (path) => ROWS[path],
    expand: vi.fn(),
    onMove: vi.fn(),
    ...over,
  }
  render(<Zone opts={opts} />)
  return opts
}

const moveData = (rootId = 'issue:PAN-1', paths = ['src/a.ts']) =>
  fakeDataTransfer({ [EXPLORER_PATHS_MIME]: paths.join('\n'), [EXPLORER_MOVE_MIME]: JSON.stringify({ rootId, paths }) })

/** fireEvent.dragOver returns false when the handler called preventDefault. */
const dragOver = (name: string, dataTransfer: DataTransfer) => fireEvent.dragOver(screen.getByText(name), { dataTransfer })

beforeEach(() => {
  vi.useFakeTimers()
  toastMock.error.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('drag paths', () => {
  it('drags the top-level selection when the row is selected, else the row alone', () => {
    expect(dragPathsFor('a', ['a', 'a/b', 'c'])).toEqual(['a', 'c'])
    expect(dragPathsFor('x', ['a', 'a/b', 'c'])).toEqual(['x'])
  })

  it('startRowDrag sets both drag types', () => {
    const dt = fakeDataTransfer()
    startRowDrag(dt, 'issue:PAN-1', 'a', ['a', 'c'])
    expect(dt.getData(EXPLORER_PATHS_MIME)).toBe('a\nc')
    expect(JSON.parse(dt.getData(EXPLORER_MOVE_MIME))).toEqual({ rootId: 'issue:PAN-1', paths: ['a', 'c'] })
    expect(dt.effectAllowed).toBe('copyMove')
  })
})

describe('getDragEdgeScrollTarget and resolveDropDir', () => {
  const base = { scrollTop: 100, scrollHeight: 1000, clientHeight: 300, edgeZonePx: 24 }

  it('scrolls up near the top, down near the bottom, and not in the middle', () => {
    expect(getDragEdgeScrollTarget({ ...base, localY: 5 })).toBeLessThan(100)
    expect(getDragEdgeScrollTarget({ ...base, localY: 295 })).toBeGreaterThan(100)
    expect(getDragEdgeScrollTarget({ ...base, localY: 150 })).toBeNull()
  })

  it('returns null when already at the edge of the scroll range', () => {
    expect(getDragEdgeScrollTarget({ ...base, scrollTop: 0, localY: 5 })).toBeNull()
  })

  it('resolves a folder row, a file row and blank space', () => {
    expect(resolveDropDir('src', 'dir')).toBe('src')
    expect(resolveDropDir('src/a.ts', 'file')).toBe('src')
    expect(resolveDropDir(null, null)).toBe('')
  })
})

describe('useTreeDropZone', () => {
  it('expands a hovered collapsed folder after 600 ms, and restarts the timer on another row', () => {
    const opts = setup()
    dragOver('src', moveData())
    vi.advanceTimersByTime(HOVER_EXPAND_MS - 1)
    expect(opts.expand).not.toHaveBeenCalled()

    dragOver('lib', moveData())
    vi.advanceTimersByTime(HOVER_EXPAND_MS - 1)
    expect(opts.expand).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(opts.expand).toHaveBeenCalledTimes(1)
    expect(opts.expand).toHaveBeenCalledWith('lib')
  })

  it('keeps the timer while the same row is hovered', () => {
    const opts = setup()
    dragOver('src', moveData())
    vi.advanceTimersByTime(300)
    dragOver('src', moveData())
    vi.advanceTimersByTime(300)
    expect(opts.expand).toHaveBeenCalledWith('src')
  })

  it('shows the drop folder while dragging over it', () => {
    setup()
    expect(dragOver('src/a.ts', moveData())).toBe(false)
    expect(screen.getByTestId('zone')).toHaveAttribute('data-drop-dir', 'src')
  })

  it('moves the dragged paths into the folder they are dropped on', () => {
    const opts = setup()
    fireEvent.drop(screen.getByText('lib'), { dataTransfer: moveData() })
    expect(opts.onMove).toHaveBeenCalledWith(['src/a.ts'], 'lib')
    expect(screen.getByTestId('zone')).toHaveAttribute('data-drop-dir', 'none')
  })

  it('refuses a drop from another root with a toast', () => {
    const opts = setup()
    fireEvent.drop(screen.getByText('lib'), { dataTransfer: moveData('issue:PAN-2') })
    expect(opts.onMove).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith(FOREIGN_ROOT_MESSAGE)
  })

  it('does not accept an internal move in a read-only zone', () => {
    const opts = setup({ writable: false })
    expect(dragOver('lib', moveData())).toBe(true)
    fireEvent.drop(screen.getByText('lib'), { dataTransfer: moveData() })
    expect(opts.onMove).not.toHaveBeenCalled()
  })

  it('refuses OS files without onFiles', () => {
    setup()
    expect(dragOver('lib', fakeDataTransfer({}, ['Files']))).toBe(true)
  })

  it('hands OS files to onFiles with the drop folder, even in a read-only zone', () => {
    const onFiles = vi.fn()
    setup({ onFiles, writable: false })
    expect(dragOver('src/a.ts', fakeDataTransfer({}, ['Files']))).toBe(false)
    fireEvent.drop(screen.getByText('src/a.ts'), { dataTransfer: fakeDataTransfer({}, ['Files']) })
    expect(onFiles).toHaveBeenCalledWith(expect.anything(), 'src')
  })

  it('does not hover-expand under the Changed filter', () => {
    const opts = setup({ changedOnly: true })
    dragOver('src', moveData())
    vi.advanceTimersByTime(HOVER_EXPAND_MS)
    expect(opts.expand).not.toHaveBeenCalled()
  })

  it('clears the drop folder when the drag leaves the zone', () => {
    setup()
    dragOver('src', moveData())
    fireEvent.dragLeave(screen.getByTestId('zone'), { relatedTarget: document.body })
    expect(screen.getByTestId('zone')).toHaveAttribute('data-drop-dir', 'none')
    vi.advanceTimersByTime(HOVER_EXPAND_MS)
  })
})
