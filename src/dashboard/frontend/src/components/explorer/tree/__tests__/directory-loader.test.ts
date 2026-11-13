import { describe, it, expect, vi } from 'vitest'
import type { ExplorerEntry, ExplorerListDirResult } from '@overdeck/contracts'
import { createDirectoryLoader, expandAll } from '../directory-loader'

interface Deferred {
  path: string
  resolve(result: ExplorerListDirResult): void
  reject(error: unknown): void
}

function harness(maxConcurrent?: number) {
  const calls: Deferred[] = []
  const listDir = vi.fn(
    (_rootId: string, path: string) =>
      new Promise<ExplorerListDirResult>((resolve, reject) => {
        calls.push({ path, resolve, reject })
      }),
  )
  const onLoading = vi.fn()
  const onResult = vi.fn()
  const onError = vi.fn()
  const loader = createDirectoryLoader({ rootId: 'issue:PAN-1', listDir, onLoading, onResult, onError, maxConcurrent })
  return { calls, listDir, onLoading, onResult, onError, loader }
}

const result = (absPath = '/r'): ExplorerListDirResult => ({ entries: [], truncated: false, absPath })
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('createDirectoryLoader', () => {
  it('runs at most four listings; a fifth starts after one settles', async () => {
    const h = harness()
    for (const p of ['a', 'b', 'c', 'd', 'e']) h.loader.ensure(p)
    expect(h.listDir).toHaveBeenCalledTimes(4)
    expect(h.calls.map((c) => c.path)).toEqual(['a', 'b', 'c', 'd'])

    h.calls[1].resolve(result())
    await flush()
    expect(h.listDir).toHaveBeenCalledTimes(5)
    expect(h.calls[4].path).toBe('e')
  })

  it('makes no call for a loaded or in-flight path', async () => {
    const h = harness()
    h.loader.ensure('src')
    h.loader.ensure('src')
    expect(h.listDir).toHaveBeenCalledTimes(1)
    h.calls[0].resolve(result())
    await flush()
    expect(h.onResult).toHaveBeenCalledWith('src', result())
    h.loader.ensure('src')
    expect(h.listDir).toHaveBeenCalledTimes(1)
  })

  it('reloads an in-flight path once more after it settles', async () => {
    const h = harness()
    h.loader.ensure('src')
    h.loader.reload(['src'])
    h.loader.reload(['src'])
    expect(h.listDir).toHaveBeenCalledTimes(1)
    h.calls[0].resolve(result('/old'))
    await flush()
    expect(h.listDir).toHaveBeenCalledTimes(2)
    h.calls[1].resolve(result('/new'))
    await flush()
    expect(h.listDir).toHaveBeenCalledTimes(2)
    expect(h.onResult).toHaveBeenLastCalledWith('src', result('/new'))
  })

  it('reloads a loaded path', async () => {
    const h = harness()
    h.loader.ensure('src')
    h.calls[0].resolve(result())
    await flush()
    h.loader.reload(['src'])
    expect(h.listDir).toHaveBeenCalledTimes(2)
  })

  it('delivers no result after dispose', async () => {
    const h = harness()
    h.loader.ensure('src')
    h.loader.dispose()
    h.calls[0].resolve(result())
    await flush()
    expect(h.onResult).not.toHaveBeenCalled()
  })

  it('reports an error with its code and lets a later ensure retry', async () => {
    const h = harness()
    h.loader.ensure('gone')
    h.calls[0].reject(new Error('boom'))
    await flush()
    expect(h.onError).toHaveBeenCalledWith('gone', undefined, 'boom')
    h.loader.ensure('gone')
    expect(h.listDir).toHaveBeenCalledTimes(2)
  })
})

function dirEntry(path: string, ignored = false): ExplorerEntry {
  return { name: path.split('/').pop() ?? path, path, kind: 'dir', mtimeMs: 0, ignored }
}

describe('expandAll', () => {
  it('walks breadth-first and skips ignored folders', async () => {
    const tree: Record<string, ExplorerEntry[]> = {
      '': [dirEntry('src'), dirEntry('node_modules', true)],
      src: [dirEntry('src/lib')],
      'src/lib': [],
      node_modules: [dirEntry('node_modules/x')],
    }
    const load = vi.fn(async (path: string) => tree[path] ?? [])
    const out = await expandAll({ start: '', load, showDotfiles: true })
    expect(out).toEqual({ expanded: ['src', 'src/lib'], capped: false })
    expect(load).not.toHaveBeenCalledWith('node_modules')
  })

  it('skips dot folders when dotfiles are hidden', async () => {
    const load = async (path: string) => (path === '' ? [dirEntry('.git'), dirEntry('a')] : [])
    expect((await expandAll({ start: '', load, showDotfiles: false })).expanded).toEqual(['a'])
  })

  it('keeps at most four listings in flight', async () => {
    let inFlight = 0
    let peak = 0
    const load = async (path: string) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise<void>((resolve) => setImmediate(resolve))
      inFlight -= 1
      return path === '' ? Array.from({ length: 10 }, (_, i) => dirEntry(`d${i}`)) : []
    }
    const out = await expandAll({ start: '', load, showDotfiles: true })
    expect(out.expanded).toHaveLength(10)
    expect(peak).toBe(4)
  })

  it('stops at the cap with capped: true', async () => {
    const load = async (path: string) => (path === '' ? [dirEntry('a'), dirEntry('b'), dirEntry('c')] : [])
    expect(await expandAll({ start: '', load, showDotfiles: true, cap: 2 })).toEqual({ expanded: ['a', 'b'], capped: true })
  })
})
